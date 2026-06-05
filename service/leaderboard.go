package service

import (
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

func ImageGenerationRanking(limit int) ([]model.LeaderboardItem, error) {
	return repository.ImageGenerationRanking(limit)
}
