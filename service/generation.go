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
	} else {
		saved, ok, err := repository.GetGenerationByID(item.ID)
		if err != nil {
			return item, err
		}
		if !ok {
			// 不允许客户端任意指定一个新 id 创建——只能更新已有记录
			return item, errors.New("生成记录不存在")
		}
		if saved.UserID != userID {
			return item, errors.New("权限不足")
		}
		// 保留原 created_at，避免被 client 覆盖
		item.CreatedAt = saved.CreatedAt
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

// ListAllGenerationsForAdmin 管理后台用，给每条记录附上 username。
func ListAllGenerationsForAdmin(q model.Query) (model.AdminGenerationList, error) {
	items, total, err := repository.ListAllGenerations(q)
	if err != nil {
		return model.AdminGenerationList{}, err
	}
	userIDs := uniqueUserIDs(items, func(g model.Generation) string { return g.UserID })
	users, err := repository.GetUsersByIDs(userIDs)
	if err != nil {
		return model.AdminGenerationList{}, err
	}
	out := make([]model.AdminGenerationItem, 0, len(items))
	for _, item := range items {
		out = append(out, model.AdminGenerationItem{
			Generation: item,
			Username:   users[item.UserID].Username,
		})
	}
	return model.AdminGenerationList{Items: out, Total: int(total)}, nil
}

func uniqueUserIDs[T any](items []T, pick func(T) string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0)
	for _, item := range items {
		id := pick(item)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}
