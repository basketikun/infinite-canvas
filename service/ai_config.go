package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

func ListAIConfigs() (model.AIConfigList, error) {
	items, err := repository.ListAIConfigs()
	if err != nil {
		return model.AIConfigList{}, err
	}
	for i := range items {
		items[i].APIKey = maskAPIKey(items[i].APIKey)
	}
	return model.AIConfigList{Items: items, Total: len(items)}, nil
}

func SaveAIConfig(item model.AIConfig) (model.AIConfig, error) {
	item.Name = strings.TrimSpace(item.Name)
	item.BaseURL = strings.TrimSpace(item.BaseURL)
	item.ImageModel = strings.TrimSpace(item.ImageModel)
	item.TextModel = strings.TrimSpace(item.TextModel)
	item.APIKey = strings.TrimSpace(item.APIKey)
	if item.Name == "" {
		return item, errors.New("配置名称不能为空")
	}
	if item.BaseURL == "" {
		return item, errors.New("Base URL 不能为空")
	}
	if item.ImageModel == "" {
		return item, errors.New("图像模型不能为空")
	}
	if item.TextModel == "" {
		return item, errors.New("文本模型不能为空")
	}
	if item.ID == "" {
		if item.APIKey == "" {
			return item, errors.New("API Key 不能为空")
		}
		item.ID = newID("aic")
		item.CreatedAt = now()
	} else {
		saved, ok, err := repository.GetAIConfigByID(item.ID)
		if err != nil {
			return item, err
		}
		if !ok {
			return item, errors.New("配置不存在")
		}
		item.CreatedAt = saved.CreatedAt
		item.Enabled = saved.Enabled
		if item.APIKey == "" {
			item.APIKey = saved.APIKey
		}
	}
	item.UpdatedAt = now()
	saved, err := repository.SaveAIConfig(item)
	if err != nil {
		return item, err
	}
	saved.APIKey = maskAPIKey(saved.APIKey)
	return saved, nil
}

func DeleteAIConfig(id string) error {
	saved, ok, err := repository.GetAIConfigByID(id)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}
	if saved.Enabled {
		return errors.New("已启用的配置不能删除，请先启用其他配置")
	}
	return repository.DeleteAIConfig(id)
}

func EnableAIConfig(id string) error {
	if _, ok, err := repository.GetAIConfigByID(id); err != nil {
		return err
	} else if !ok {
		return errors.New("配置不存在")
	}
	return repository.EnableAIConfig(id)
}

// TestAIConfig 调用 /v1/models 验证配置是否可用。
func TestAIConfig(id string) (int, error) {
	cfg, ok, err := repository.GetAIConfigByID(id)
	if err != nil {
		return 0, err
	}
	if !ok {
		return 0, errors.New("配置不存在")
	}
	endpoint := normalizeBaseURL(cfg.BaseURL) + "/v1/models"
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, errors.New("请求失败：" + err.Error())
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, errors.New(parseUpstreamError(body, resp.StatusCode))
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return 0, errors.New("响应解析失败")
	}
	return len(payload.Data), nil
}

// ProbeAIModels 探测给定 Base URL / API Key 下上游可用的模型 ID 列表，
// 用于新增/编辑配置时的"自动获取模型列表"功能。id 非空且 apiKey 为空时
// 回库里的原值（编辑场景下用户不重新输入 key 也能探测）。
func ProbeAIModels(baseURL, apiKey, id string) ([]string, error) {
	baseURL = strings.TrimSpace(baseURL)
	apiKey = strings.TrimSpace(apiKey)
	if baseURL == "" {
		return nil, errors.New("Base URL 不能为空")
	}
	if apiKey == "" {
		if id == "" {
			return nil, errors.New("API Key 不能为空")
		}
		saved, ok, err := repository.GetAIConfigByID(id)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, errors.New("配置不存在")
		}
		apiKey = saved.APIKey
	}
	endpoint := normalizeBaseURL(baseURL) + "/v1/models"
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, errors.New("请求失败：" + err.Error())
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, errors.New(parseUpstreamError(body, resp.StatusCode))
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, errors.New("响应解析失败")
	}
	out := make([]string, 0, len(payload.Data))
	for _, item := range payload.Data {
		modelID := strings.TrimSpace(item.ID)
		if modelID != "" {
			out = append(out, modelID)
		}
	}
	return out, nil
}

// EnabledAIConfig 返回当前启用的 AI 配置，供反代使用，apiKey 不脱敏。
func EnabledAIConfig() (model.AIConfig, error) {
	cfg, ok, err := repository.GetEnabledAIConfig()
	if err != nil {
		return model.AIConfig{}, err
	}
	if !ok {
		return model.AIConfig{}, errors.New("未配置启用的模型，请联系管理员")
	}
	return cfg, nil
}

func normalizeBaseURL(value string) string {
	value = strings.TrimSpace(value)
	for strings.HasSuffix(value, "/") {
		value = strings.TrimSuffix(value, "/")
	}
	if strings.HasSuffix(value, "/v1") {
		value = strings.TrimSuffix(value, "/v1")
	}
	return value
}

func maskAPIKey(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return ""
	}
	if len(key) <= 8 {
		return "****"
	}
	return key[:4] + "****" + key[len(key)-4:]
}

func parseUpstreamError(body []byte, status int) string {
	var payload struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &payload); err == nil && payload.Error.Message != "" {
		return payload.Error.Message
	}
	if len(body) > 0 && len(body) < 500 {
		return string(bytes.TrimSpace(body))
	}
	return http.StatusText(status)
}
