package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
)

const (
	promptImageRoute        = "/api/prompt-images/"
	defaultPromptImageDir   = "data/prompt-images"
	maxPromptImageCacheSize = 32 << 20
)

var (
	promptImageClient = http.Client{Timeout: 45 * time.Second}
	promptImageLocks  sync.Map
	promptImageURLRe  = regexp.MustCompile(`https?://[^\s"'<>）)]+`)
)

func PromptImageURL(source string) string {
	source = strings.TrimSpace(source)
	if source == "" || isPromptImageServerURL(source) || strings.HasPrefix(source, "data:") || strings.HasPrefix(source, "blob:") {
		return source
	}
	source = normalizeGithubBlobImageURL(source)
	if !isRemotePromptImageURL(source) {
		return source
	}
	return promptImageRoute + base64.RawURLEncoding.EncodeToString([]byte(source))
}

func PromptImageFile(ctx context.Context, encoded string) (string, string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return "", "", errors.New("无效提示词图片")
	}
	source := normalizeGithubBlobImageURL(string(raw))
	if !isRemotePromptImageURL(source) {
		return "", "", errors.New("无效提示词图片来源")
	}

	cacheDir := promptImageCacheDir()
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		return "", "", err
	}
	key := promptImageCacheKey(source)
	path := filepath.Join(cacheDir, key)
	if promptImageCacheExists(path) {
		return path, promptImageContentType(path), nil
	}

	lock := promptImageLock(key)
	lock.Lock()
	defer lock.Unlock()
	if promptImageCacheExists(path) {
		return path, promptImageContentType(path), nil
	}
	return downloadPromptImage(ctx, source, path)
}

func normalizePromptImages(item *model.Prompt) {
	item.CoverURL = PromptImageURL(item.CoverURL)
	item.Preview = rewritePromptImageLinks(item.Preview)
}

func normalizePromptImageList(items []model.Prompt) {
	for i := range items {
		normalizePromptImages(&items[i])
	}
}

func rewritePromptImageLinks(value string) string {
	return promptImageURLRe.ReplaceAllStringFunc(value, PromptImageURL)
}

func isPromptImageServerURL(value string) bool {
	if strings.HasPrefix(value, promptImageRoute) {
		return true
	}
	parsed, err := url.Parse(value)
	return err == nil && strings.HasPrefix(parsed.Path, promptImageRoute)
}

func isRemotePromptImageURL(source string) bool {
	parsed, err := url.Parse(source)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "github.com" || host == "raw.githubusercontent.com" || strings.HasSuffix(host, ".githubusercontent.com")
}

func normalizeGithubBlobImageURL(source string) string {
	parsed, err := url.Parse(strings.TrimSpace(source))
	if err != nil || strings.ToLower(parsed.Hostname()) != "github.com" {
		return source
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) < 5 || parts[2] != "blob" {
		return source
	}
	parsed.Scheme = "https"
	parsed.Host = "raw.githubusercontent.com"
	parsed.Path = "/" + strings.Join(append([]string{parts[0], parts[1], parts[3]}, parts[4:]...), "/")
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func promptImageCacheDir() string {
	if dir := strings.TrimSpace(config.Cfg.PromptImageCacheDir); dir != "" {
		return dir
	}
	return defaultPromptImageDir
}

func promptImageCacheKey(source string) string {
	sum := sha256.Sum256([]byte(source))
	return hex.EncodeToString(sum[:])
}

func promptImageLock(key string) *sync.Mutex {
	value, _ := promptImageLocks.LoadOrStore(key, &sync.Mutex{})
	return value.(*sync.Mutex)
}

func promptImageCacheExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && info.Size() > 0
}

func downloadPromptImage(ctx context.Context, source string, path string) (string, string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return "", "", err
	}
	request.Header.Set("User-Agent", "infinite-canvas-prompt-image-cache")
	response, err := promptImageClient.Do(request)
	if err != nil {
		return "", "", err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", "", errors.New("提示词图片拉取失败")
	}

	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+"-*.tmp")
	if err != nil {
		return "", "", err
	}
	tmpName := tmp.Name()
	removeTmp := true
	defer func() {
		if removeTmp {
			_ = os.Remove(tmpName)
		}
	}()

	written, copyErr := io.Copy(tmp, io.LimitReader(response.Body, maxPromptImageCacheSize+1))
	closeErr := tmp.Close()
	if copyErr != nil {
		return "", "", copyErr
	}
	if closeErr != nil {
		return "", "", closeErr
	}
	if written > maxPromptImageCacheSize {
		return "", "", errors.New("提示词图片过大")
	}

	contentType := strings.TrimSpace(response.Header.Get("Content-Type"))
	if !isImageContentType(contentType) {
		contentType = detectPromptImageContentType(tmpName)
	}
	if !isImageContentType(contentType) {
		return "", "", errors.New("提示词图片内容异常")
	}
	if err := os.Rename(tmpName, path); err != nil {
		return "", "", err
	}
	removeTmp = false
	_ = os.WriteFile(path+".type", []byte(contentType), 0644)
	return path, contentType, nil
}

func promptImageContentType(path string) string {
	if data, err := os.ReadFile(path + ".type"); err == nil {
		contentType := strings.TrimSpace(string(data))
		if isImageContentType(contentType) {
			return contentType
		}
	}
	return detectPromptImageContentType(path)
}

func detectPromptImageContentType(path string) string {
	file, err := os.Open(path)
	if err != nil {
		return "application/octet-stream"
	}
	defer file.Close()
	buf := make([]byte, 512)
	n, _ := file.Read(buf)
	if n == 0 {
		return "application/octet-stream"
	}
	contentType := http.DetectContentType(buf[:n])
	if isImageContentType(contentType) {
		return contentType
	}
	if strings.Contains(strings.ToLower(string(buf[:n])), "<svg") {
		return "image/svg+xml"
	}
	return "application/octet-stream"
}

func isImageContentType(value string) bool {
	value = strings.TrimSpace(value)
	mediaType, _, err := mime.ParseMediaType(value)
	if err == nil {
		value = mediaType
	}
	return strings.HasPrefix(strings.ToLower(value), "image/")
}
