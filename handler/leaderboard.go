package handler

import (
	"net/http"
	"strconv"

	"github.com/basketikun/infinite-canvas/service"
)

// ImageGenerationLeaderboard 返回生图排行榜，公开可访问。
func ImageGenerationLeaderboard(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := service.ImageGenerationRanking(limit)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]any{"items": items})
}
