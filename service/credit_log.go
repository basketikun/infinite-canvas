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
