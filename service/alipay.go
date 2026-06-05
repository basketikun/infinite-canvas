package service

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/smartwalle/alipay/v3"
)

// BuildAlipayPayURL 调用支付宝 alipay.trade.page.pay 生成 PC 端跳转地址。
func BuildAlipayPayURL(order model.MembershipOrder) (string, error) {
	client, cfg, err := alipayClient()
	if err != nil {
		return "", err
	}
	pay := alipay.TradePagePay{}
	pay.NotifyURL = cfg.NotifyURL
	pay.ReturnURL = cfg.ReturnURL
	pay.Subject = zpayTruncateName(order.PlanName)
	pay.OutTradeNo = order.ID
	pay.TotalAmount = fmt.Sprintf("%.2f", float64(order.Amount)/100)
	pay.ProductCode = "FAST_INSTANT_TRADE_PAY"
	payURL, err := client.TradePagePay(pay)
	if err != nil {
		return "", safeMessageError{message: "生成支付宝支付链接失败：" + err.Error()}
	}
	return payURL.String(), nil
}

// VerifyAlipayNotify 校验支付宝回调签名（同步 / 异步通用）。
func VerifyAlipayNotify(r *http.Request) (model.MembershipOrder, error) {
	client, _, err := alipayClient()
	if err != nil {
		return model.MembershipOrder{}, err
	}
	if err := r.ParseForm(); err != nil {
		return model.MembershipOrder{}, safeMessageError{message: "解析回调参数失败"}
	}
	// 支付宝同步跳转把参数放在 URL query，异步通知放在 form 里；alipay SDK 用 r.Form 统一处理。
	if err := client.VerifySign(context.Background(), r.Form); err != nil {
		return model.MembershipOrder{}, safeMessageError{message: "支付宝回调验签失败：" + err.Error()}
	}
	if status := r.Form.Get("trade_status"); status != "TRADE_SUCCESS" && status != "TRADE_FINISHED" && status != "" {
		// 同步跳转无 trade_status，异步通知有；非成功状态直接拒绝。
		return model.MembershipOrder{}, safeMessageError{message: "支付未完成"}
	}
	orderID := strings.TrimSpace(r.Form.Get("out_trade_no"))
	if orderID == "" {
		return model.MembershipOrder{}, safeMessageError{message: "缺少订单号"}
	}
	order, ok, err := repository.GetMembershipOrder(orderID)
	if err != nil {
		return order, err
	}
	if !ok {
		return order, safeMessageError{message: "订单不存在"}
	}
	return order, nil
}

func alipayClient() (*alipay.Client, model.PrivateAlipaySetting, error) {
	settings, err := repository.GetSettings()
	if err != nil {
		return nil, model.PrivateAlipaySetting{}, err
	}
	cfg := normalizeSettings(settings).Private.Payment.Alipay
	if !cfg.Enabled {
		return nil, cfg, safeMessageError{message: "支付宝直连未开启"}
	}
	if strings.TrimSpace(cfg.AppID) == "" || strings.TrimSpace(cfg.PrivateKey) == "" {
		return nil, cfg, safeMessageError{message: "支付宝直连未配置 AppID 或私钥"}
	}
	client, err := alipay.New(cfg.AppID, cfg.PrivateKey, !cfg.Sandbox)
	if err != nil {
		return nil, cfg, safeMessageError{message: "初始化支付宝客户端失败：" + err.Error()}
	}
	if strings.TrimSpace(cfg.PublicKey) != "" {
		if err := client.LoadAliPayPublicKey(cfg.PublicKey); err != nil {
			return nil, cfg, safeMessageError{message: "加载支付宝公钥失败：" + err.Error()}
		}
	}
	return client, cfg, nil
}
