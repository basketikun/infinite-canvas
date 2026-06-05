package repository

import (
	"errors"
	"strings"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
)

// ListMembershipPlans 分页查询会员套餐。
func ListMembershipPlans(q model.Query, enabledOnly bool) ([]model.MembershipPlan, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Model(&model.MembershipPlan{})
	if enabledOnly {
		tx = tx.Where("enabled = ?", true)
	}
	if keyword := strings.TrimSpace(q.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		tx = tx.Where("name LIKE ? OR level LIKE ? OR description LIKE ?", like, like, like)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var plans []model.MembershipPlan
	err = tx.Order("sort asc, created_at asc").Offset(q.Offset()).Limit(q.PageSize).Find(&plans).Error
	return plans, total, err
}

// GetMembershipPlan 根据 ID 查询套餐。
func GetMembershipPlan(id string) (model.MembershipPlan, bool, error) {
	db, err := DB()
	if err != nil {
		return model.MembershipPlan{}, false, err
	}
	plan := model.MembershipPlan{}
	err = db.Where("id = ?", id).First(&plan).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.MembershipPlan{}, false, nil
	}
	return plan, err == nil, err
}

// SaveMembershipPlan 保存套餐。
func SaveMembershipPlan(plan model.MembershipPlan) (model.MembershipPlan, error) {
	db, err := DB()
	if err != nil {
		return plan, err
	}
	return plan, db.Save(&plan).Error
}

// DeleteMembershipPlan 删除套餐。
func DeleteMembershipPlan(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Delete(&model.MembershipPlan{}, "id = ?", id).Error
}

// ListMembershipOrders 分页查询订单。
func ListMembershipOrders(q model.Query, userID string) ([]model.MembershipOrder, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Model(&model.MembershipOrder{})
	if userID != "" {
		tx = tx.Where("user_id = ?", userID)
	}
	if keyword := strings.TrimSpace(q.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		tx = tx.Where("id LIKE ? OR user_id LIKE ? OR plan_name LIKE ? OR payment_id LIKE ?", like, like, like, like)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var orders []model.MembershipOrder
	err = tx.Order("created_at desc").Offset(q.Offset()).Limit(q.PageSize).Find(&orders).Error
	return orders, total, err
}

// GetMembershipOrder 根据 ID 查询订单。
func GetMembershipOrder(id string) (model.MembershipOrder, bool, error) {
	db, err := DB()
	if err != nil {
		return model.MembershipOrder{}, false, err
	}
	order := model.MembershipOrder{}
	err = db.Where("id = ?", id).First(&order).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.MembershipOrder{}, false, nil
	}
	return order, err == nil, err
}

// SaveMembershipOrder 保存订单。
func SaveMembershipOrder(order model.MembershipOrder) (model.MembershipOrder, error) {
	db, err := DB()
	if err != nil {
		return order, err
	}
	return order, db.Save(&order).Error
}

// DeleteMembershipOrder 删除订单。
func DeleteMembershipOrder(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Delete(&model.MembershipOrder{}, "id = ?", id).Error
}
