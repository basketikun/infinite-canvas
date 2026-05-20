package repository

import (
	"github.com/basketikun/infinite-canvas/model"
)

// ListGenerations 返回用户生图历史。
func ListGenerations(userID string, q model.Query) ([]model.Generation, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Model(&model.Generation{}).Where("user_id = ?", userID)

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var items []model.Generation
	err = tx.Order("created_at desc").Offset(q.Offset()).Limit(q.PageSize).Find(&items).Error
	return items, total, err
}

// SaveGeneration 新建或更新一条生图历史。
func SaveGeneration(item model.Generation) (model.Generation, error) {
	db, err := DB()
	if err != nil {
		return item, err
	}
	return item, db.Save(&item).Error
}

// DeleteGeneration 删除用户的一条生图历史。
func DeleteGeneration(userID string, id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Where("user_id = ?", userID).Delete(&model.Generation{}, "id = ?", id).Error
}

// CountGenerations 统计用户成功生图次数（用于个人中心聚合）。
func CountGenerations(userID string) (int64, error) {
	db, err := DB()
	if err != nil {
		return 0, err
	}
	var total int64
	return total, db.Model(&model.Generation{}).Where("user_id = ?", userID).Count(&total).Error
}
