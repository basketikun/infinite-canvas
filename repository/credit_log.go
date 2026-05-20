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
