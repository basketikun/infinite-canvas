package handler

import (
	"encoding/json"
	"net/http"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/service"
)

type createOrderRequest struct {
	PlanID   string                `json:"planId"`
	Provider model.PaymentProvider `json:"provider"`
}

type markOrderPaidRequest struct {
	PaymentID string `json:"paymentId"`
}

// MembershipPlans 用户侧获取已启用的会员套餐。
func MembershipPlans(w http.ResponseWriter, r *http.Request) {
	result, err := service.ListMembershipPlans(parseQuery(r), true)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

// MyMembership 当前用户的会员状态。
func MyMembership(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录")
		return
	}
	result, err := service.GetUserMembership(user.ID)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

// MyMembershipOrders 当前用户的订单列表。
func MyMembershipOrders(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录")
		return
	}
	result, err := service.ListMembershipOrders(parseQuery(r), user.ID)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

// CreateMembershipOrder 用户下单。
func CreateMembershipOrder(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录")
		return
	}
	var request createOrderRequest
	_ = json.NewDecoder(r.Body).Decode(&request)
	result, err := service.CreateMembershipOrder(user.ID, request.PlanID, request.Provider)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

// CancelMembershipOrder 用户取消订单。
func CancelMembershipOrder(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录")
		return
	}
	if err := service.CancelMembershipOrder(id, user.ID); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}

// MockPayMembershipOrder 模拟支付回调。真实接入支付后由微信/支付宝异步通知。
func MockPayMembershipOrder(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录")
		return
	}
	result, err := service.MarkOrderPaid(id, "mock-"+user.ID)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

// RefreshMembershipOrderPay 重新生成订单的支付跳转链接。
func RefreshMembershipOrderPay(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录")
		return
	}
	result, err := service.RefreshOrderPayURL(id, user.ID)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

// ZPayNotify ZPay 异步回调，校验签名后标记订单为已支付。
func ZPayNotify(w http.ResponseWriter, r *http.Request) {
	values := r.URL.Query()
	params := make(map[string]string, len(values))
	for k, v := range values {
		if len(v) > 0 {
			params[k] = v[0]
		}
	}
	outTradeNo, err := service.VerifyZPayNotify(params)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("fail"))
		return
	}
	if _, err := service.MarkOrderPaid(outTradeNo, params["trade_no"]); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("fail"))
		return
	}
	// ZPay 约定：成功必须返回纯字符串 success
	_, _ = w.Write([]byte("success"))
}

// ZPayReturn ZPay 支付完成后浏览器跳转，校验后直接跳回前端结果页。
func ZPayReturn(w http.ResponseWriter, r *http.Request) {
	values := r.URL.Query()
	params := make(map[string]string, len(values))
	for k, v := range values {
		if len(v) > 0 {
			params[k] = v[0]
		}
	}
	outTradeNo, err := service.VerifyZPayNotify(params)
	status := "success"
	if err != nil {
		status = "fail"
	} else {
		// 同步标记一次，避免异步通知未到达
		_, _ = service.MarkOrderPaid(outTradeNo, params["trade_no"])
	}
	http.Redirect(w, r, "/orders?focus="+outTradeNo+"&payStatus="+status, http.StatusFound)
}

// AlipayNotify 支付宝异步通知，验签成功后必须返回纯字符串 success。
func AlipayNotify(w http.ResponseWriter, r *http.Request) {
	order, err := service.VerifyAlipayNotify(r)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("fail"))
		return
	}
	if _, err := service.MarkOrderPaid(order.ID, r.Form.Get("trade_no")); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("fail"))
		return
	}
	_, _ = w.Write([]byte("success"))
}

// AlipayReturn 支付宝同步跳转，校验后跳回前端订单页。
func AlipayReturn(w http.ResponseWriter, r *http.Request) {
	order, err := service.VerifyAlipayNotify(r)
	status := "success"
	orderID := ""
	if err != nil {
		status = "fail"
	} else {
		orderID = order.ID
		_, _ = service.MarkOrderPaid(order.ID, r.Form.Get("trade_no"))
	}
	http.Redirect(w, r, "/orders?focus="+orderID+"&payStatus="+status, http.StatusFound)
}

// WechatNotify 微信支付 V3 异步回调，验签解密成功后返回 200 + 空 JSON。
func WechatNotify(w http.ResponseWriter, r *http.Request) {
	orderID, paymentID, err := service.VerifyWechatNotify(r)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":"FAIL","message":"verify failed"}`))
		return
	}
	if _, err := service.MarkOrderPaid(orderID, paymentID); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"code":"FAIL","message":"internal error"}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"code":"SUCCESS"}`))
}

// AdminMembershipPlans 管理员套餐分页。
func AdminMembershipPlans(w http.ResponseWriter, r *http.Request) {
	result, err := service.ListMembershipPlans(parseQuery(r), false)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

// AdminSaveMembershipPlan 管理员保存套餐。
func AdminSaveMembershipPlan(w http.ResponseWriter, r *http.Request) {
	var plan model.MembershipPlan
	_ = json.NewDecoder(r.Body).Decode(&plan)
	result, err := service.SaveMembershipPlan(plan)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

// AdminDeleteMembershipPlan 管理员删除套餐。
func AdminDeleteMembershipPlan(w http.ResponseWriter, r *http.Request, id string) {
	if err := service.DeleteMembershipPlan(id); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}

// AdminMembershipOrders 管理员订单分页。
func AdminMembershipOrders(w http.ResponseWriter, r *http.Request) {
	result, err := service.ListMembershipOrders(parseQuery(r), "")
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

// AdminMarkOrderPaid 管理员手动标记订单已支付。
func AdminMarkOrderPaid(w http.ResponseWriter, r *http.Request, id string) {
	var request markOrderPaidRequest
	_ = json.NewDecoder(r.Body).Decode(&request)
	paymentID := request.PaymentID
	if paymentID == "" {
		paymentID = "admin-manual"
	}
	result, err := service.MarkOrderPaid(id, paymentID)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

// AdminDeleteMembershipOrder 管理员删除订单。
func AdminDeleteMembershipOrder(w http.ResponseWriter, r *http.Request, id string) {
	if err := service.DeleteMembershipOrder(id); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}
