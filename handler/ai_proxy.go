package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/service"
)

// 上游接口超时：图片生成可能较慢，给到 5 分钟。
const upstreamTimeout = 5 * time.Minute

// AIImageGenerations 反代 OpenAI 兼容的 /v1/images/generations，并按返回图片张数扣额度。
func AIImageGenerations(w http.ResponseWriter, r *http.Request) {
	user, ok := requireUser(w, r)
	if !ok {
		return
	}
	cfg, ok := requireEnabledConfig(w)
	if !ok {
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		Fail(w, "请求体读取失败")
		return
	}
	payload := map[string]any{}
	if len(bytes.TrimSpace(body)) > 0 {
		if err := json.Unmarshal(body, &payload); err != nil {
			Fail(w, "请求体格式错误")
			return
		}
	}
	payload["model"] = cfg.ImageModel
	payload["response_format"] = "b64_json"

	if user.Role != model.UserRoleAdmin && user.Credits <= 0 {
		Fail(w, "额度不足，请联系管理员")
		return
	}

	raw, status, err := postUpstreamJSON(cfg, "/v1/images/generations", payload)
	if err != nil {
		Fail(w, err.Error())
		return
	}
	if status < 200 || status >= 300 {
		Fail(w, parseUpstreamMessage(raw, status))
		return
	}

	count := countImagePayload(raw)
	if count == 0 {
		Fail(w, "上游未返回图片")
		return
	}
	remaining := -1
	if user.Role != model.UserRoleAdmin {
		balance, _, err := service.ConsumeCredits(user.ID, count)
		if err != nil {
			log.Printf("consume credits failed user=%s amount=%d err=%v", user.ID, count, err)
		}
		remaining = balance
		logImageConsume(user.ID, count, balance, cfg.ImageModel, "文生图")
	}

	OK(w, wrapImageResult(raw, remaining))
}

// AIImageEdits 反代 /v1/images/edits（multipart），按返回图片张数扣额度。
//
// 同时支持两种入参方式：
//   - application/json：{ prompt, n, size?, quality?, references: ["img-xxx", ...] }
//     references 是已经上传过的 images.id；后端按 owner 校验后从磁盘读取，
//     再自己拼 multipart 转发到上游。请求体只有 KB 级。
//   - multipart/form-data：保留原始路径，兼容画布里截屏/裁剪后还没存盘的瞬时图。
func AIImageEdits(w http.ResponseWriter, r *http.Request) {
	user, ok := requireUser(w, r)
	if !ok {
		return
	}
	cfg, ok := requireEnabledConfig(w)
	if !ok {
		return
	}
	if user.Role != model.UserRoleAdmin && user.Credits <= 0 {
		Fail(w, "额度不足，请联系管理员")
		return
	}

	bodyBuf := &bytes.Buffer{}
	writer := multipart.NewWriter(bodyBuf)

	if strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		if !writeEditsFromJSON(w, r, user, writer) {
			return
		}
	} else {
		if !writeEditsFromMultipart(w, r, writer) {
			return
		}
	}

	_ = writer.WriteField("model", cfg.ImageModel)
	_ = writer.WriteField("response_format", "b64_json")
	if err := writer.Close(); err != nil {
		Fail(w, "请求构造失败")
		return
	}

	endpoint := upstreamURL(cfg.BaseURL, "/v1/images/edits")
	req, err := http.NewRequest(http.MethodPost, endpoint, bodyBuf)
	if err != nil {
		Fail(w, "请求构造失败")
		return
	}
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{Timeout: upstreamTimeout}
	resp, err := client.Do(req)
	if err != nil {
		Fail(w, "上游请求失败："+err.Error())
		return
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		Fail(w, parseUpstreamMessage(raw, resp.StatusCode))
		return
	}
	count := countImagePayload(raw)
	if count == 0 {
		Fail(w, "上游未返回图片")
		return
	}
	remaining := -1
	if user.Role != model.UserRoleAdmin {
		balance, _, err := service.ConsumeCredits(user.ID, count)
		if err != nil {
			log.Printf("consume credits failed user=%s amount=%d err=%v", user.ID, count, err)
		}
		remaining = balance
		logImageConsume(user.ID, count, balance, cfg.ImageModel, "图生图")
	}
	OK(w, wrapImageResult(raw, remaining))
}

// AIChatCompletions 反代 /v1/chat/completions，支持流式响应；按用户做限流。
func AIChatCompletions(w http.ResponseWriter, r *http.Request) {
	user, ok := requireUser(w, r)
	if !ok {
		return
	}
	cfg, ok := requireEnabledConfig(w)
	if !ok {
		return
	}
	if user.Role != model.UserRoleAdmin {
		allowed, retry := service.AllowChat(user.ID)
		if !allowed {
			Fail(w, fmt.Sprintf("请求过于频繁，请约 %d 秒后再试", int(retry.Seconds())+1))
			return
		}
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		Fail(w, "请求体读取失败")
		return
	}
	payload := map[string]any{}
	if len(bytes.TrimSpace(body)) > 0 {
		if err := json.Unmarshal(body, &payload); err != nil {
			Fail(w, "请求体格式错误")
			return
		}
	}
	payload["model"] = cfg.TextModel
	rebuilt, err := json.Marshal(payload)
	if err != nil {
		Fail(w, "请求体构造失败")
		return
	}

	endpoint := upstreamURL(cfg.BaseURL, "/v1/chat/completions")
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(rebuilt))
	if err != nil {
		Fail(w, "请求构造失败")
		return
	}
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")
	if accept := r.Header.Get("Accept"); accept != "" {
		req.Header.Set("Accept", accept)
	}

	client := &http.Client{Timeout: upstreamTimeout}
	resp, err := client.Do(req)
	if err != nil {
		Fail(w, "上游请求失败："+err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(resp.Body)
		Fail(w, parseUpstreamMessage(raw, resp.StatusCode))
		return
	}

	for key, values := range resp.Header {
		if strings.EqualFold(key, "Content-Length") {
			continue
		}
		for _, v := range values {
			w.Header().Add(key, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	flusher, _ := w.(http.Flusher)
	buf := make([]byte, 4096)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := w.Write(buf[:n]); writeErr != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if readErr != nil {
			return
		}
	}
}

// AIModels 反代 /v1/models（仅管理员可用，普通用户没必要选模型）。
func AIModels(w http.ResponseWriter, r *http.Request) {
	user, ok := requireUser(w, r)
	if !ok {
		return
	}
	if user.Role != model.UserRoleAdmin {
		Fail(w, "权限不足")
		return
	}
	cfg, ok := requireEnabledConfig(w)
	if !ok {
		return
	}
	endpoint := upstreamURL(cfg.BaseURL, "/v1/models")
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		Fail(w, "请求构造失败")
		return
	}
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		Fail(w, "上游请求失败："+err.Error())
		return
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		Fail(w, parseUpstreamMessage(raw, resp.StatusCode))
		return
	}
	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		Fail(w, "上游响应解析失败")
		return
	}
	OK(w, payload)
}

func requireUser(w http.ResponseWriter, r *http.Request) (model.AuthUser, bool) {
	user, ok := service.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		Fail(w, "请先登录")
		return model.AuthUser{}, false
	}
	return user, true
}

func requireEnabledConfig(w http.ResponseWriter) (model.AIConfig, bool) {
	cfg, err := service.EnabledAIConfig()
	if err != nil {
		Fail(w, err.Error())
		return model.AIConfig{}, false
	}
	return cfg, true
}

func postUpstreamJSON(cfg model.AIConfig, path string, payload any) ([]byte, int, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, err
	}
	endpoint := upstreamURL(cfg.BaseURL, path)
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: upstreamTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("上游请求失败：%s", err.Error())
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return raw, resp.StatusCode, nil
}

// upstreamURL 把用户填的 baseUrl 和 path 拼成最终 URL，兼容 baseUrl 已含 /v1 的情况。
func upstreamURL(baseURL string, path string) string {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.HasSuffix(base, "/v1") && strings.HasPrefix(path, "/v1/") {
		return base + strings.TrimPrefix(path, "/v1")
	}
	return base + path
}

// logImageConsume 写一条生图消耗流水。
func logImageConsume(userID string, count int, balance int, modelName string, remark string) {
	if err := service.LogCreditChange(model.CreditLog{
		UserID:  userID,
		Type:    model.CreditLogTypeConsume,
		Amount:  -count,
		Balance: balance,
		Model:   modelName,
		Remark:  remark,
	}); err != nil {
		log.Printf("write consume credit log failed user=%s err=%v", userID, err)
	}
}

// wrapImageResult 把上游 JSON 包装成 {upstream, remaining, upstreamMeta} 结构。
// upstream 是完整 JSON（含 b64_json，前端用于落盘）；
// upstreamMeta 是脱敏后的 raw 字符串（去掉 b64_json 大字段），前端会回写到 generations 表供 admin 审计用。
func wrapImageResult(raw []byte, remaining int) map[string]any {
	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		payload = nil
	}
	return map[string]any{
		"upstream":     payload,
		"remaining":    remaining,
		"upstreamMeta": redactUpstreamMeta(raw),
	}
}

// redactUpstreamMeta 把 OpenAI 兼容生图响应里的 b64_json 字段抹掉再序列化回 JSON 字符串，
// 保留 created / data[].revised_prompt / data[].url 等可读元信息。
// 解析失败时退化为原始字符串（截断到 4KB 以防极端情况）。
func redactUpstreamMeta(raw []byte) string {
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		if len(raw) > 4096 {
			return string(raw[:4096]) + "...(truncated)"
		}
		return string(raw)
	}
	if list, ok := parsed["data"].([]any); ok {
		for _, item := range list {
			if itemMap, ok := item.(map[string]any); ok {
				if v, ok := itemMap["b64_json"].(string); ok && v != "" {
					itemMap["b64_json"] = fmt.Sprintf("<%d bytes redacted>", len(v))
				}
			}
		}
	}
	out, err := json.Marshal(parsed)
	if err != nil {
		return ""
	}
	return string(out)
}

func countImagePayload(raw []byte) int {
	var payload struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return 0
	}
	count := 0
	for _, item := range payload.Data {
		if v, ok := item["b64_json"].(string); ok && v != "" {
			count++
			continue
		}
		if v, ok := item["url"].(string); ok && v != "" {
			count++
		}
	}
	return count
}

func parseUpstreamMessage(raw []byte, status int) string {
	var payload struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &payload); err == nil && payload.Error.Message != "" {
		return payload.Error.Message
	}
	// 网关层（nginx/cloudflare 等）返回的 HTML 错误页千万别透传给前端，
	// 否则浏览器会看到一整段 <html><head><title>504...</title> 整段文本。
	// 优先按 HTTP 状态码给中文可读提示，HTML 都压成"上游响应异常"。
	if msg := friendlyStatusMessage(status); msg != "" {
		return msg
	}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) > 0 && len(trimmed) < 500 && !looksLikeHTML(trimmed) {
		return string(trimmed)
	}
	return fmt.Sprintf("上游响应异常：%d", status)
}

// friendlyStatusMessage 把常见网关/上游错误码翻译成中文，配合 503/504 等场景。
func friendlyStatusMessage(status int) string {
	switch status {
	case http.StatusBadGateway:
		return "上游服务异常（502 Bad Gateway），请稍后再试"
	case http.StatusServiceUnavailable:
		return "上游服务暂不可用（503），请稍后再试"
	case http.StatusGatewayTimeout:
		return "上游服务响应超时（504），请稍后再试"
	}
	return ""
}

func looksLikeHTML(body []byte) bool {
	if len(body) == 0 {
		return false
	}
	if body[0] == '<' {
		return true
	}
	head := body
	if len(head) > 128 {
		head = head[:128]
	}
	lower := bytes.ToLower(head)
	return bytes.Contains(lower, []byte("<html")) || bytes.Contains(lower, []byte("<!doctype html"))
}

// editsJSONReferenceLimit 限制图生图最多带几张参考图，防止有人发巨量 id 让后端
// 一次性把 N 张大图从磁盘读进内存。8 张对正常使用足够。
const editsJSONReferenceLimit = 8

// writeEditsFromJSON 处理 application/json 入参的 /v1/images/edits 调用：
// 把 prompt/n/size/quality 写入 multipart 文本字段，把 references 按 storageKey 从磁盘
// 读出来当 "image" 文件字段塞进去。失败时已经 Fail，返回 false 告知上层立即返回。
func writeEditsFromJSON(w http.ResponseWriter, r *http.Request, user model.AuthUser, writer *multipart.Writer) bool {
	var payload struct {
		Prompt     string   `json:"prompt"`
		N          any      `json:"n"`
		Size       string   `json:"size"`
		Quality    string   `json:"quality"`
		References []string `json:"references"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		Fail(w, "请求体格式错误")
		return false
	}
	prompt := strings.TrimSpace(payload.Prompt)
	if prompt == "" {
		Fail(w, "提示词不能为空")
		return false
	}
	if len(payload.References) == 0 {
		Fail(w, "请至少提供一张参考图")
		return false
	}
	if len(payload.References) > editsJSONReferenceLimit {
		Fail(w, fmt.Sprintf("参考图数量超过上限（最多 %d 张）", editsJSONReferenceLimit))
		return false
	}

	_ = writer.WriteField("prompt", prompt)
	if n := normalizeEditsN(payload.N); n != "" {
		_ = writer.WriteField("n", n)
	}
	if payload.Size != "" {
		_ = writer.WriteField("size", payload.Size)
	}
	if payload.Quality != "" {
		_ = writer.WriteField("quality", payload.Quality)
	}

	for _, storageKey := range payload.References {
		storageKey = strings.TrimSpace(storageKey)
		if storageKey == "" {
			continue
		}
		image, err := service.GetImageForOwner(user.ID, storageKey)
		if err != nil {
			Fail(w, err.Error())
			return false
		}
		file, err := os.Open(service.ImageAbsPath(image))
		if err != nil {
			Fail(w, "参考图文件丢失")
			return false
		}
		filename := filepath.Base(image.Path)
		part, err := writer.CreateFormFile("image", filename)
		if err != nil {
			_ = file.Close()
			Fail(w, "请求构造失败")
			return false
		}
		_, copyErr := io.Copy(part, file)
		_ = file.Close()
		if copyErr != nil {
			Fail(w, "参考图读取失败")
			return false
		}
	}
	return true
}

// writeEditsFromMultipart 处理 multipart/form-data 入参（旧路径，画布里截屏/裁剪后
// 还没上传到服务器的瞬时图仍走这里）。把 r.MultipartForm 的所有字段透传到 writer，
// 过滤掉 model/response_format 防止客户端覆盖管理后台启用配置。
func writeEditsFromMultipart(w http.ResponseWriter, r *http.Request, writer *multipart.Writer) bool {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		Fail(w, "请求体解析失败")
		return false
	}
	for key, values := range r.MultipartForm.Value {
		if key == "model" || key == "response_format" {
			continue
		}
		for _, v := range values {
			_ = writer.WriteField(key, v)
		}
	}
	for key, files := range r.MultipartForm.File {
		for _, fh := range files {
			part, err := writer.CreateFormFile(key, fh.Filename)
			if err != nil {
				Fail(w, "请求构造失败")
				return false
			}
			f, err := fh.Open()
			if err != nil {
				Fail(w, "请求文件读取失败")
				return false
			}
			_, copyErr := io.Copy(part, f)
			_ = f.Close()
			if copyErr != nil {
				Fail(w, "请求文件读取失败")
				return false
			}
		}
	}
	return true
}

// normalizeEditsN 把 client 传的 n（可能是 number / 数字字符串）规范化成 multipart 字段
// 期望的字符串；空 / 0 / 非数字都返回 "" 表示不带这个字段（上游 OpenAI 兼容接口会用默认值 1）。
func normalizeEditsN(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(v)
	case float64:
		n := int(v)
		if n <= 0 {
			return ""
		}
		return strconv.Itoa(n)
	case int:
		if v <= 0 {
			return ""
		}
		return strconv.Itoa(v)
	}
	return ""
}
