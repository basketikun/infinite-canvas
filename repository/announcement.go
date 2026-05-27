package repository

import (
	"errors"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
)

// ListAnnouncements 按查询条件返回公告分页列表。
func ListAnnouncements(q model.Query) ([]model.Announcement, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Model(&model.Announcement{})
	if q.Keyword != "" {
		like := "%" + q.Keyword + "%"
		tx = tx.Where("title LIKE ? OR content LIKE ?", like, like)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []model.Announcement
	err = tx.Order("sort_order asc, updated_at desc").Offset(q.Offset()).Limit(q.PageSize).Find(&items).Error
	return items, total, err
}

// ListActiveAnnouncements 返回当前时间有效的启用公告。
func ListActiveAnnouncements(now time.Time) ([]model.Announcement, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	today := now.Format("2006-01-02")
	stamp := now.Format(time.RFC3339)
	var items []model.Announcement
	err = db.Where("enabled = ?", true).
		Where("date_from = '' OR date_from <= ? OR date_from <= ?", today, stamp).
		Where("date_to = '' OR date_to >= ? OR date_to >= ?", today, stamp).
		Order("sort_order asc, updated_at desc").
		Find(&items).Error
	return items, err
}

// SaveAnnouncement 保存公告，并在更新时保留原创建时间。
func SaveAnnouncement(item model.Announcement) (model.Announcement, error) {
	db, err := DB()
	if err != nil {
		return item, err
	}
	if saved, ok, err := findAnnouncement(db, item.ID); err != nil {
		return item, err
	} else if ok && item.CreatedAt == "" {
		item.CreatedAt = saved.CreatedAt
	}
	return item, db.Save(&item).Error
}

// DeleteAnnouncement 删除指定公告。
func DeleteAnnouncement(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Delete(&model.Announcement{}, "id = ?", id).Error
}

func findAnnouncement(db *gorm.DB, id string) (model.Announcement, bool, error) {
	item := model.Announcement{}
	err := db.Where("id = ?", id).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.Announcement{}, false, nil
	}
	return item, err == nil, err
}
