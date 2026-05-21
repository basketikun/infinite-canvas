package service

import (
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

func ListCreditLogs(userID string, q model.Query) (model.CreditLogList, error) {
	items, total, err := repository.ListCreditLogs(userID, q)
	if err != nil {
		return model.CreditLogList{}, err
	}
	return model.CreditLogList{Items: items, Total: int(total)}, nil
}

// LogCreditChange 写一条额度流水。failure 不会回滚业务调用，仅打 log。
func LogCreditChange(item model.CreditLog) error {
	if item.ID == "" {
		item.ID = newID("cl")
	}
	if item.CreatedAt == "" {
		item.CreatedAt = now()
	}
	return repository.AppendCreditLog(item)
}

// ListAllCreditLogsForAdmin 管理后台用，给每条流水附上 username 和 operatorUsername。
func ListAllCreditLogsForAdmin(q model.Query) (model.AdminCreditLogList, error) {
	items, total, err := repository.ListAllCreditLogs(q)
	if err != nil {
		return model.AdminCreditLogList{}, err
	}
	ids := make([]string, 0, 2*len(items))
	for _, item := range items {
		if item.UserID != "" {
			ids = append(ids, item.UserID)
		}
		if item.OperatorID != "" {
			ids = append(ids, item.OperatorID)
		}
	}
	users, err := repository.GetUsersByIDs(ids)
	if err != nil {
		return model.AdminCreditLogList{}, err
	}
	out := make([]model.AdminCreditLogItem, 0, len(items))
	for _, item := range items {
		out = append(out, model.AdminCreditLogItem{
			CreditLog:        item,
			Username:         users[item.UserID].Username,
			OperatorUsername: users[item.OperatorID].Username,
		})
	}
	return model.AdminCreditLogList{Items: out, Total: int(total)}, nil
}

// CreditProfile 聚合用户当前积分、累计消耗、累计赠送/调整、生图次数。
func CreditProfile(user model.AuthUser) (model.CreditProfile, error) {
	consumed, err := repository.SumCreditByType(user.ID, model.CreditLogTypeConsume)
	if err != nil {
		return model.CreditProfile{}, err
	}
	bonus, err := repository.SumCreditByType(user.ID, model.CreditLogTypeSignupBonus)
	if err != nil {
		return model.CreditProfile{}, err
	}
	adjust, err := repository.SumCreditByType(user.ID, model.CreditLogTypeAdminAdjust)
	if err != nil {
		return model.CreditProfile{}, err
	}
	generated, err := repository.CountGenerations(user.ID)
	if err != nil {
		return model.CreditProfile{}, err
	}
	totalGranted := int(bonus + adjust)
	if totalGranted < 0 {
		totalGranted = 0
	}
	return model.CreditProfile{
		User:           user,
		TotalConsumed:  int(-consumed),
		TotalGranted:   totalGranted,
		GeneratedCount: int(generated),
	}, nil
}
