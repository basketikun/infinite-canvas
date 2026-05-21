package repository

import (
	"github.com/basketikun/infinite-canvas/model"
)

// ListCreditLogs 返回用户额度流水。
func ListCreditLogs(userID string, q model.Query) ([]model.CreditLog, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Model(&model.CreditLog{}).Where("user_id = ?", userID)

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var items []model.CreditLog
	err = tx.Order("created_at desc").Offset(q.Offset()).Limit(q.PageSize).Find(&items).Error
	return items, total, err
}

// AppendCreditLog 追加一条额度流水。
func AppendCreditLog(item model.CreditLog) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Create(&item).Error
}

// ListAllCreditLogs 管理后台用：跨用户分页查流水，支持按用户名或备注模糊匹配 + 按 type 过滤。
func ListAllCreditLogs(q model.Query) ([]model.CreditLog, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Model(&model.CreditLog{})
	if q.UserID != "" {
		tx = tx.Where("user_id = ?", q.UserID)
	}
	if q.Keyword != "" {
		like := "%" + q.Keyword + "%"
		tx = tx.Where(
			"remark LIKE ? OR model LIKE ? OR user_id IN (SELECT id FROM users WHERE username LIKE ?)",
			like, like, like,
		)
	}
	if q.Type != "" {
		tx = tx.Where("type = ?", q.Type)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var items []model.CreditLog
	err = tx.Order("created_at desc").Offset(q.Offset()).Limit(q.PageSize).Find(&items).Error
	return items, total, err
}

// GetUsersByIDs 批量查询用户基础信息，结果以 id 作为 map key。
func GetUsersByIDs(ids []string) (map[string]model.User, error) {
	if len(ids) == 0 {
		return map[string]model.User{}, nil
	}
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var users []model.User
	if err := db.Where("id IN ?", ids).Find(&users).Error; err != nil {
		return nil, err
	}
	out := make(map[string]model.User, len(users))
	for _, u := range users {
		out[u.ID] = u
	}
	return out, nil
}

// SumCreditByType 统计用户某类流水的总变动量。
func SumCreditByType(userID string, logType model.CreditLogType) (int64, error) {
	db, err := DB()
	if err != nil {
		return 0, err
	}
	var total *int64
	err = db.Model(&model.CreditLog{}).
		Where("user_id = ? AND type = ?", userID, logType).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&total).Error
	if err != nil || total == nil {
		return 0, err
	}
	return *total, nil
}
