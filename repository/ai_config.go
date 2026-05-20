package repository

import (
	"errors"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
)

// ListAIConfigs 列出全部 AI 配置。
func ListAIConfigs() ([]model.AIConfig, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var items []model.AIConfig
	err = db.Order("created_at desc").Find(&items).Error
	return items, err
}

// GetAIConfigByID 查询单条 AI 配置。
func GetAIConfigByID(id string) (model.AIConfig, bool, error) {
	db, err := DB()
	if err != nil {
		return model.AIConfig{}, false, err
	}
	item := model.AIConfig{}
	err = db.Where("id = ?", id).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.AIConfig{}, false, nil
	}
	return item, err == nil, err
}

// GetEnabledAIConfig 返回当前启用的 AI 配置。
func GetEnabledAIConfig() (model.AIConfig, bool, error) {
	db, err := DB()
	if err != nil {
		return model.AIConfig{}, false, err
	}
	item := model.AIConfig{}
	err = db.Where("enabled = ?", true).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.AIConfig{}, false, nil
	}
	return item, err == nil, err
}

// SaveAIConfig 保存或更新 AI 配置。
func SaveAIConfig(item model.AIConfig) (model.AIConfig, error) {
	db, err := DB()
	if err != nil {
		return item, err
	}
	return item, db.Save(&item).Error
}

// DeleteAIConfig 删除 AI 配置。
func DeleteAIConfig(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Delete(&model.AIConfig{}, "id = ?", id).Error
}

// EnableAIConfig 启用某条配置并把其他配置全部置为 disabled。
func EnableAIConfig(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.AIConfig{}).Where("id <> ?", id).Update("enabled", false).Error; err != nil {
			return err
		}
		result := tx.Model(&model.AIConfig{}).Where("id = ?", id).Update("enabled", true)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return errors.New("配置不存在")
		}
		return nil
	})
}
