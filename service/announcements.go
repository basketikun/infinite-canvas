package service

import (
	"errors"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

func ListAnnouncements(q model.Query) (model.AnnouncementList, error) {
	items, total, err := repository.ListAnnouncements(q)
	if err != nil {
		return model.AnnouncementList{}, err
	}
	return model.AnnouncementList{Items: items, Total: int(total)}, nil
}

func ListActiveAnnouncements() ([]model.Announcement, error) {
	return repository.ListActiveAnnouncements(time.Now())
}

func SaveAnnouncement(item model.Announcement) (model.Announcement, error) {
	item.Title = strings.TrimSpace(item.Title)
	item.Content = strings.TrimSpace(item.Content)
	item.DateFrom = normalizeAnnouncementDate(item.DateFrom)
	item.DateTo = normalizeAnnouncementDate(item.DateTo)
	if item.Title == "" {
		return item, errors.New("请输入公告标题")
	}
	if item.Content == "" {
		return item, errors.New("请输入公告内容")
	}
	if item.DateFrom != "" && item.DateTo != "" && item.DateFrom > item.DateTo {
		return item, errors.New("公告开始日期不能晚于结束日期")
	}
	now := time.Now().Format(time.RFC3339)
	if item.ID == "" {
		item.ID = newID("announcement")
		item.CreatedAt = now
	}
	item.UpdatedAt = now
	return repository.SaveAnnouncement(item)
}

func DeleteAnnouncement(id string) error {
	return repository.DeleteAnnouncement(id)
}

func normalizeAnnouncementDate(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if len(value) >= 10 {
		value = value[:10]
	}
	if _, err := time.Parse("2006-01-02", value); err != nil {
		return ""
	}
	return value
}
