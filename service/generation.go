package service

import (
	"errors"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

const generationThumbnailLimit = 6

func ListGenerations(userID string, q model.Query) (model.GenerationList, error) {
	items, total, err := repository.ListGenerations(userID, q)
	if err != nil {
		return model.GenerationList{}, err
	}
	return model.GenerationList{Items: items, Total: int(total)}, nil
}

func SaveGeneration(userID string, item model.Generation) (model.Generation, error) {
	if userID == "" {
		return item, errors.New("请先登录")
	}
	if item.ID == "" {
		item.ID = newID("gen")
		item.CreatedAt = now()
	}
	item.UserID = userID
	if len(item.Thumbnails) > generationThumbnailLimit {
		item.Thumbnails = item.Thumbnails[:generationThumbnailLimit]
	}
	if item.Status == "" {
		item.Status = model.GenerationStatusSuccess
	}
	if item.Count < 0 {
		item.Count = 0
	}
	return repository.SaveGeneration(item)
}

func DeleteGeneration(userID string, id string) error {
	return repository.DeleteGeneration(userID, id)
}
