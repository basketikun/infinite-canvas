package repository

import (
	"errors"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
)

// ListCanvases 返回用户的画布概要列表（不带 data）。
func ListCanvases(userID string, q model.Query) ([]model.CanvasSummary, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Model(&model.Canvas{}).Where("user_id = ?", userID)
	if q.Keyword != "" {
		tx = tx.Where("title LIKE ?", "%"+q.Keyword+"%")
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var items []model.CanvasSummary
	err = tx.Select("id, user_id, title, cover_url, created_at, updated_at").
		Order("updated_at desc").
		Offset(q.Offset()).
		Limit(q.PageSize).
		Find(&items).Error
	return items, total, err
}

// GetCanvas 取得用户某张画布完整数据。
func GetCanvas(userID string, id string) (model.Canvas, bool, error) {
	db, err := DB()
	if err != nil {
		return model.Canvas{}, false, err
	}
	item := model.Canvas{}
	err = db.Where("id = ? AND user_id = ?", id, userID).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.Canvas{}, false, nil
	}
	return item, err == nil, err
}

// SaveCanvas 新建或更新画布。
func SaveCanvas(item model.Canvas) (model.Canvas, error) {
	db, err := DB()
	if err != nil {
		return item, err
	}
	return item, db.Save(&item).Error
}

// DeleteCanvas 删除用户画布。
func DeleteCanvas(userID string, id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Where("user_id = ?", userID).Delete(&model.Canvas{}, "id = ?", id).Error
}
