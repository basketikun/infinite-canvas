package repository

import (
	"errors"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
)

// GetGenerationByID 查询单条生图历史。
func GetGenerationByID(id string) (model.Generation, bool, error) {
	db, err := DB()
	if err != nil {
		return model.Generation{}, false, err
	}
	var item model.Generation
	if err := db.Where("id = ?", id).First(&item).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.Generation{}, false, nil
		}
		return model.Generation{}, false, err
	}
	return item, true, nil
}

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

// ListAllGenerations 管理后台用：跨用户分页查生图历史，支持按提示词或用户名模糊匹配。
func ListAllGenerations(q model.Query) ([]model.Generation, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Model(&model.Generation{})
	if q.UserID != "" {
		tx = tx.Where("user_id = ?", q.UserID)
	}
	if q.Keyword != "" {
		like := "%" + q.Keyword + "%"
		// 用 subquery 命中 username；同时模糊匹配 prompt
		tx = tx.Where(
			"prompt LIKE ? OR user_id IN (SELECT id FROM users WHERE username LIKE ?)",
			like, like,
		)
	}
	if q.Type != "" {
		tx = tx.Where("status = ?", q.Type)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var items []model.Generation
	err = tx.Order("created_at desc").Offset(q.Offset()).Limit(q.PageSize).Find(&items).Error
	return items, total, err
}
