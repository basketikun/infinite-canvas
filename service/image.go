package service

import (
	"errors"
	"mime"
	"os"
	"path/filepath"
	"strings"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

// 单张图片最大 32 MB，超过则拒绝；按典型生图分辨率绰绰有余，又避免恶意撑爆磁盘。
const maxImageBytes = 32 << 20

// SaveImage 把图片字节写入磁盘 IMAGE_DIR/{userId}/{id}.{ext}，DB 记录 path。
func SaveImage(userID string, data []byte, mimeType string) (model.Image, error) {
	if userID == "" {
		return model.Image{}, errors.New("请先登录")
	}
	if len(data) == 0 {
		return model.Image{}, errors.New("图片内容为空")
	}
	if len(data) > maxImageBytes {
		return model.Image{}, errors.New("图片超过 32MB")
	}
	if mimeType == "" {
		mimeType = "image/png"
	}
	id := newID("img")
	relPath := filepath.Join(safeUserDir(userID), id+extFromMime(mimeType))
	absPath := filepath.Join(config.Cfg.ImageDir, relPath)
	if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
		return model.Image{}, err
	}
	if err := os.WriteFile(absPath, data, 0o644); err != nil {
		return model.Image{}, err
	}
	image := model.Image{
		ID:        id,
		UserID:    userID,
		MimeType:  mimeType,
		Size:      len(data),
		Path:      filepath.ToSlash(relPath),
		CreatedAt: now(),
	}
	saved, err := repository.SaveImage(image)
	if err != nil {
		// DB 写失败回滚已落盘文件，避免悬空文件
		_ = os.Remove(absPath)
		return model.Image{}, err
	}
	return saved, nil
}

// GetImage 取图片元信息，不校验登录态（id 是 uuid，事实上不可枚举）。
// 删除场景用 LoadImageForOwner 做归属检查。
func GetImage(id string) (model.Image, error) {
	image, ok, err := repository.GetImageByID(id)
	if err != nil {
		return model.Image{}, err
	}
	if !ok {
		return model.Image{}, errors.New("图片不存在")
	}
	return image, nil
}

// ImageAbsPath 返回图片在磁盘上的绝对路径。
func ImageAbsPath(image model.Image) string {
	return filepath.Join(config.Cfg.ImageDir, filepath.FromSlash(image.Path))
}

// GetImageForOwner 取图片元信息并校验 owner，常用于"按 storageKey 引用别人图"
// 的鉴权场景（例如图生图把参考图按 id 传给后端时）。id 不存在或 owner 不匹配都报错。
func GetImageForOwner(userID string, id string) (model.Image, error) {
	if userID == "" {
		return model.Image{}, errors.New("请先登录")
	}
	image, ok, err := repository.GetImageByID(id)
	if err != nil {
		return model.Image{}, err
	}
	if !ok {
		return model.Image{}, errors.New("参考图不存在")
	}
	if image.UserID != userID {
		return model.Image{}, errors.New("参考图无权访问")
	}
	return image, nil
}

// DeleteImage 必须是 owner 才能删；同步删磁盘文件。
func DeleteImage(userID string, id string) error {
	image, ok, err := repository.GetImageByID(id)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}
	if image.UserID != userID {
		return errors.New("权限不足")
	}
	if err := repository.DeleteImage(id); err != nil {
		return err
	}
	if image.Path != "" {
		_ = os.Remove(ImageAbsPath(image))
	}
	return nil
}

func safeUserDir(userID string) string {
	clean := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '_'
	}, userID)
	if clean == "" {
		clean = "guest"
	}
	return clean
}

func extFromMime(mimeType string) string {
	mimeType = strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
	switch mimeType {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	}
	if exts, err := mime.ExtensionsByType(mimeType); err == nil && len(exts) > 0 {
		return exts[0]
	}
	return ".bin"
}
