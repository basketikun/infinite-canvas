package handler

import (
	"net/http"
	"os"

	"github.com/basketikun/infinite-canvas/service"
)

func PromptImage(w http.ResponseWriter, r *http.Request, source string) {
	path, contentType, err := service.PromptImageFile(r.Context(), source)
	if err != nil {
		http.Error(w, "图片加载失败", http.StatusBadGateway)
		return
	}
	file, err := os.Open(path)
	if err != nil {
		http.Error(w, "图片加载失败", http.StatusNotFound)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		http.Error(w, "图片加载失败", http.StatusNotFound)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}
