package repository

import (
	"errors"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
)

// ListAssets 按查询条件返回素材分页列表。
func ListAssets(q model.Query) ([]model.Asset, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := applyAssetFilters(db.Model(&model.Asset{}), q)

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var items []model.Asset
	err = tx.Order("updated_at desc").Offset(q.Offset()).Limit(q.PageSize).Find(&items).Error
	return items, total, err
}

// ListAssetTags 返回当前素材查询条件下的全部标签。
func ListAssetTags(q model.Query) ([]string, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	q.Normalize()
	q.Tags = nil
	tx := applyAssetFilters(db.Model(&model.Asset{}), q)

	var items []model.Asset
	if err := tx.Select("tags").Find(&items).Error; err != nil {
		return nil, err
	}
	return assetTagsFromItems(items), nil
}

// GetAssetByID 按 ID 查询素材。
func GetAssetByID(id string) (model.Asset, bool, error) {
	db, err := DB()
	if err != nil {
		return model.Asset{}, false, err
	}
	return findAsset(db, id)
}

// SaveAsset 保存素材，并在更新时保留原创建时间。
func SaveAsset(item model.Asset) (model.Asset, error) {
	db, err := DB()
	if err != nil {
		return item, err
	}
	if saved, ok, err := findAsset(db, item.ID); err != nil {
		return item, err
	} else if ok && item.CreatedAt == "" {
		item.CreatedAt = saved.CreatedAt
	}
	return item, db.Save(&item).Error
}

// DeleteAsset 删除指定素材。
func DeleteAsset(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Delete(&model.Asset{}, "id = ?", id).Error
}

// applyAssetFilters 应用素材列表的搜索条件。
func applyAssetFilters(tx *gorm.DB, q model.Query) *gorm.DB {
	if q.Keyword != "" {
		like := "%" + q.Keyword + "%"
		tx = tx.Where("title LIKE ? OR description LIKE ? OR content LIKE ?", like, like, like)
	}
	if isActiveAssetOption(q.Type) {
		tx = tx.Where("type = ?", q.Type)
	}
	if q.Visibility != "" {
		tx = tx.Where("visibility = ?", q.Visibility)
	}
	if q.UserID != "" {
		tx = tx.Where("user_id = ?", q.UserID)
	}
	return applyAssetTagsFilter(tx, q.Tags)
}

// findAsset 根据 ID 查询素材。
func findAsset(db *gorm.DB, id string) (model.Asset, bool, error) {
	item := model.Asset{}
	err := db.Where("id = ?", id).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.Asset{}, false, nil
	}
	return item, err == nil, err
}

// applyAssetTagsFilter 应用 JSON 标签条件。
func applyAssetTagsFilter(tx *gorm.DB, tags []string) *gorm.DB {
	if len(tags) == 0 {
		return tx
	}
	condition := tx.Session(&gorm.Session{NewDB: true})
	for _, tag := range tags {
		condition = condition.Or(assetJSONTagsContains(tx), tag)
	}
	return tx.Where(condition)
}

func assetTagsFromItems(items []model.Asset) []string {
	seen := map[string]bool{}
	tags := []string{}
	for _, item := range items {
		for _, tag := range item.Tags {
			if tag != "" && !seen[tag] {
				seen[tag] = true
				tags = append(tags, tag)
			}
		}
	}
	return tags
}

// assetJSONTagsContains 返回素材 tags 的 JSON 包含条件。
func assetJSONTagsContains(tx *gorm.DB) string {
	switch tx.Dialector.Name() {
	case "mysql":
		return "JSON_CONTAINS(tags, JSON_QUOTE(?))"
	case "postgres":
		return "jsonb_exists(tags::jsonb, ?)"
	default:
		return "EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)"
	}
}

// isActiveAssetOption 判断素材筛选项有效状态。
func isActiveAssetOption(value string) bool {
	return value != "" && value != "全部" && value != "all"
}
