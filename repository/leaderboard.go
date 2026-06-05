package repository

import (
	"github.com/basketikun/infinite-canvas/model"
)

// ImageGenerationRanking 按用户聚合"调用了 /images/* 接口"的 credit log 数量。
// 由于 credit_logs.extra 是 JSON 文本，跨数据库直接 LIKE 包含 "/images/" 子串即可。
func ImageGenerationRanking(limit int) ([]model.LeaderboardItem, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	type row struct {
		UserID      string
		Username    string
		DisplayName string
		AvatarURL   string
		Count       int
	}
	var rows []row
	err = db.Table("credit_logs").
		Select("credit_logs.user_id AS user_id, users.username AS username, users.display_name AS display_name, users.avatar_url AS avatar_url, COUNT(*) AS count").
		Joins("LEFT JOIN users ON users.id = credit_logs.user_id").
		Where("credit_logs.type = ? AND credit_logs.extra LIKE ?", model.CreditLogTypeAIConsume, "%/images/%").
		Group("credit_logs.user_id, users.username, users.display_name, users.avatar_url").
		Order("count DESC").
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	items := make([]model.LeaderboardItem, 0, len(rows))
	for _, r := range rows {
		items = append(items, model.LeaderboardItem{
			UserID:      r.UserID,
			Username:    r.Username,
			DisplayName: r.DisplayName,
			AvatarURL:   r.AvatarURL,
			Count:       r.Count,
		})
	}
	return items, nil
}
