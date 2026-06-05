package service

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

// ListMembershipPlans 返回套餐分页列表。enabledOnly 用于面向用户的展示。
func ListMembershipPlans(q model.Query, enabledOnly bool) (model.MembershipPlanList, error) {
	plans, total, err := repository.ListMembershipPlans(q, enabledOnly)
	if err != nil {
		return model.MembershipPlanList{}, err
	}
	return model.MembershipPlanList{Items: plans, Total: int(total)}, nil
}

// SaveMembershipPlan 后台保存套餐。
func SaveMembershipPlan(plan model.MembershipPlan) (model.MembershipPlan, error) {
	plan.Name = strings.TrimSpace(plan.Name)
	if plan.Name == "" {
		return plan, safeMessageError{message: "套餐名称不能为空"}
	}
	if plan.Level == "" {
		plan.Level = model.MembershipLevelVIP
	}
	if plan.Price < 0 {
		plan.Price = 0
	}
	if plan.DurationDays < 0 {
		plan.DurationDays = 0
	}
	if plan.CreditsGranted < 0 {
		plan.CreditsGranted = 0
	}
	now := now()
	if plan.ID == "" {
		plan.ID = newID("plan")
		plan.CreatedAt = now
	}
	plan.UpdatedAt = now
	return repository.SaveMembershipPlan(plan)
}

// DeleteMembershipPlan 删除套餐。
func DeleteMembershipPlan(id string) error {
	return repository.DeleteMembershipPlan(id)
}

// ListMembershipOrders 后台或用户查询订单。
func ListMembershipOrders(q model.Query, userID string) (model.MembershipOrderList, error) {
	orders, total, err := repository.ListMembershipOrders(q, userID)
	if err != nil {
		return model.MembershipOrderList{}, err
	}
	return model.MembershipOrderList{Items: orders, Total: int(total)}, nil
}

// CreateMembershipOrder 用户下单。
func CreateMembershipOrder(userID string, planID string, provider model.PaymentProvider) (model.MembershipOrder, error) {
	settings, err := PublicSettings()
	if err != nil {
		return model.MembershipOrder{}, err
	}
	if !settings.Membership.Enabled {
		return model.MembershipOrder{}, safeMessageError{message: "会员功能未开启"}
	}
	plan, ok, err := repository.GetMembershipPlan(planID)
	if err != nil {
		return model.MembershipOrder{}, err
	}
	if !ok || !plan.Enabled {
		return model.MembershipOrder{}, safeMessageError{message: "套餐不存在或已下架"}
	}
	provider = normalizePaymentProvider(provider, settings.Membership.PaymentMethods)
	order := model.MembershipOrder{
		ID:              newID("order"),
		UserID:          userID,
		PlanID:          plan.ID,
		PlanName:        plan.Name,
		PlanLevel:       plan.Level,
		Amount:          plan.Price,
		Status:          model.MembershipOrderStatusPending,
		PaymentProvider: provider,
		CreatedAt:       now(),
		UpdatedAt:       now(),
	}
	payURL, err := buildOrderPayURL(order)
	if err != nil {
		return order, err
	}
	order.PayURL = payURL
	return repository.SaveMembershipOrder(order)
}

// RefreshOrderPayURL 重新生成订单的支付跳转地址（用于待支付订单的"再次支付"）。
func RefreshOrderPayURL(orderID string, userID string) (model.MembershipOrder, error) {
	order, ok, err := repository.GetMembershipOrder(orderID)
	if err != nil {
		return order, err
	}
	if !ok {
		return order, safeMessageError{message: "订单不存在"}
	}
	if userID != "" && order.UserID != userID {
		return order, safeMessageError{message: "无权操作此订单"}
	}
	if order.Status != model.MembershipOrderStatusPending {
		return order, safeMessageError{message: "订单状态不允许支付"}
	}
	payURL, err := buildOrderPayURL(order)
	if err != nil {
		return order, err
	}
	order.PayURL = payURL
	order.UpdatedAt = now()
	return repository.SaveMembershipOrder(order)
}

func buildOrderPayURL(order model.MembershipOrder) (string, error) {
	if order.PaymentProvider == model.PaymentProviderMock {
		return "/payment/mock?orderId=" + order.ID, nil
	}
	settings, err := repository.GetSettings()
	if err != nil {
		return "", err
	}
	payment := normalizeSettings(settings).Private.Payment
	switch order.PaymentProvider {
	case model.PaymentProviderAlipay:
		if payment.Alipay.Enabled {
			return BuildAlipayPayURL(order)
		}
		if payment.ZPay.Enabled {
			return BuildZPayPayURL(order)
		}
		return "", safeMessageError{message: "支付宝支付未开启，请联系管理员"}
	case model.PaymentProviderWechat:
		if payment.Wechat.Enabled {
			return BuildWechatPayURL(order)
		}
		if payment.ZPay.Enabled {
			return BuildZPayPayURL(order)
		}
		return "", safeMessageError{message: "微信支付未开启，请联系管理员"}
	}
	return BuildZPayPayURL(order)
}

// MarkOrderPaid 标记订单已支付，并发放会员权益。
func MarkOrderPaid(orderID string, paymentID string) (model.MembershipOrder, error) {
	order, ok, err := repository.GetMembershipOrder(orderID)
	if err != nil {
		return order, err
	}
	if !ok {
		return order, safeMessageError{message: "订单不存在"}
	}
	if order.Status == model.MembershipOrderStatusPaid {
		return order, nil
	}
	if order.Status == model.MembershipOrderStatusCancelled {
		return order, safeMessageError{message: "订单已取消"}
	}
	plan, ok, err := repository.GetMembershipPlan(order.PlanID)
	if err != nil {
		return order, err
	}
	if !ok {
		return order, safeMessageError{message: "套餐不存在"}
	}
	user, ok, err := repository.GetUserByID(order.UserID)
	if err != nil {
		return order, err
	}
	if !ok {
		return order, safeMessageError{message: "用户不存在"}
	}
	expiresAt, err := extendMembership(user, plan)
	if err != nil {
		return order, err
	}
	user.MembershipLevel = plan.Level
	user.MembershipExpiresAt = expiresAt
	user.UpdatedAt = now()
	if _, err := repository.SaveUser(user); err != nil {
		return order, err
	}
	if plan.CreditsGranted > 0 {
		if err := grantOrderCredits(order, plan); err != nil {
			return order, err
		}
	}
	order.Status = model.MembershipOrderStatusPaid
	order.PaymentID = paymentID
	order.PaidAt = now()
	order.ExpiresAt = expiresAt
	order.UpdatedAt = now()
	return repository.SaveMembershipOrder(order)
}

// CancelMembershipOrder 取消未支付订单。
func CancelMembershipOrder(orderID string, userID string) error {
	order, ok, err := repository.GetMembershipOrder(orderID)
	if err != nil {
		return err
	}
	if !ok {
		return safeMessageError{message: "订单不存在"}
	}
	if userID != "" && order.UserID != userID {
		return safeMessageError{message: "无权操作此订单"}
	}
	if order.Status == model.MembershipOrderStatusPaid {
		return safeMessageError{message: "已支付订单不能取消"}
	}
	order.Status = model.MembershipOrderStatusCancelled
	order.UpdatedAt = now()
	_, err = repository.SaveMembershipOrder(order)
	return err
}

// DeleteMembershipOrder 后台删除订单。
func DeleteMembershipOrder(id string) error {
	return repository.DeleteMembershipOrder(id)
}

// GetUserMembership 返回用户的会员状态。
func GetUserMembership(userID string) (model.AuthUser, error) {
	user, ok, err := repository.GetUserByID(userID)
	if err != nil {
		return model.AuthUser{}, err
	}
	if !ok {
		return model.AuthUser{}, safeMessageError{message: "用户不存在"}
	}
	if isMembershipExpired(user) {
		user.MembershipLevel = model.MembershipLevelFree
		user.MembershipExpiresAt = ""
		user.UpdatedAt = now()
		if _, err := repository.SaveUser(user); err != nil {
			return model.AuthUser{}, err
		}
	}
	return model.PublicUser(user), nil
}

func grantOrderCredits(order model.MembershipOrder, plan model.MembershipPlan) error {
	user, ok, err := repository.RefundUserCredits(order.UserID, plan.CreditsGranted, now())
	if err != nil {
		return err
	}
	if !ok {
		return safeMessageError{message: "发放算力点失败：用户不存在"}
	}
	extra, _ := json.Marshal(map[string]string{"orderId": order.ID, "planId": plan.ID})
	_, err = repository.SaveCreditLog(model.CreditLog{
		ID:        newID("credit"),
		UserID:    order.UserID,
		Type:      model.CreditLogTypeMembershipGrant,
		Amount:    plan.CreditsGranted,
		Balance:   user.Credits,
		RelatedID: order.ID,
		Remark:    "购买会员 " + plan.Name + " 赠送算力点",
		Extra:     string(extra),
		CreatedAt: now(),
	})
	return err
}

func extendMembership(user model.User, plan model.MembershipPlan) (string, error) {
	if plan.DurationDays <= 0 {
		return user.MembershipExpiresAt, nil
	}
	base := time.Now()
	if !isMembershipExpired(user) && strings.TrimSpace(user.MembershipExpiresAt) != "" {
		if parsed, err := time.Parse(time.RFC3339, user.MembershipExpiresAt); err == nil && parsed.After(base) {
			base = parsed
		}
	}
	return base.Add(time.Duration(plan.DurationDays) * 24 * time.Hour).Format(time.RFC3339), nil
}

func isMembershipExpired(user model.User) bool {
	if user.MembershipLevel == "" || user.MembershipLevel == model.MembershipLevelFree {
		return true
	}
	if strings.TrimSpace(user.MembershipExpiresAt) == "" {
		return true
	}
	parsed, err := time.Parse(time.RFC3339, user.MembershipExpiresAt)
	if err != nil {
		return true
	}
	return parsed.Before(time.Now())
}

func normalizePaymentProvider(provider model.PaymentProvider, allowed []string) model.PaymentProvider {
	if provider == "" {
		if len(allowed) > 0 {
			return model.PaymentProvider(allowed[0])
		}
		return model.PaymentProviderMock
	}
	return provider
}

// IsMembershipActive 对外暴露的会员有效判断，供其它 service 使用。
func IsMembershipActive(user model.User) bool {
	return !isMembershipExpired(user)
}
