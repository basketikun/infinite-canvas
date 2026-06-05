package service

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"net/url"
	"sort"
	"strings"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

const defaultZPayGateway = "https://zpayz.cn/submit.php"

// BuildZPayPayURL 为订单生成 ZPay 收银台跳转 URL。
func BuildZPayPayURL(order model.MembershipOrder) (string, error) {
	cfg, err := zpayConfig()
	if err != nil {
		return "", err
	}
	params := map[string]string{
		"pid":          cfg.PID,
		"type":         zpayTypeFromProvider(order.PaymentProvider),
		"out_trade_no": order.ID,
		"notify_url":   cfg.NotifyURL,
		"return_url":   cfg.ReturnURL,
		"name":         zpayTruncateName(order.PlanName),
		"money":        fmt.Sprintf("%.2f", float64(order.Amount)/100),
	}
	params["sign"] = signZPay(params, cfg.Key)
	params["sign_type"] = "MD5"
	values := url.Values{}
	for k, v := range params {
		values.Set(k, v)
	}
	gateway := strings.TrimSpace(cfg.GatewayURL)
	if gateway == "" {
		gateway = defaultZPayGateway
	}
	return gateway + "?" + values.Encode(), nil
}

// VerifyZPayNotify 校验回调签名并返回订单号。
func VerifyZPayNotify(query map[string]string) (string, error) {
	cfg, err := zpayConfig()
	if err != nil {
		return "", err
	}
	sign := query["sign"]
	if sign == "" {
		return "", safeMessageError{message: "缺少签名"}
	}
	expected := signZPay(query, cfg.Key)
	if !strings.EqualFold(sign, expected) {
		return "", safeMessageError{message: "签名校验失败"}
	}
	if query["trade_status"] != "TRADE_SUCCESS" {
		return "", safeMessageError{message: "订单未支付成功"}
	}
	outTradeNo := strings.TrimSpace(query["out_trade_no"])
	if outTradeNo == "" {
		return "", safeMessageError{message: "缺少订单号"}
	}
	return outTradeNo, nil
}

func zpayConfig() (model.PrivateZPaySetting, error) {
	settings, err := repository.GetSettings()
	if err != nil {
		return model.PrivateZPaySetting{}, err
	}
	cfg := normalizeSettings(settings).Private.Payment.ZPay
	if !cfg.Enabled {
		return cfg, safeMessageError{message: "支付未开启"}
	}
	if strings.TrimSpace(cfg.PID) == "" || strings.TrimSpace(cfg.Key) == "" {
		return cfg, safeMessageError{message: "支付未配置 PID 或密钥"}
	}
	return cfg, nil
}

func zpayTypeFromProvider(provider model.PaymentProvider) string {
	switch provider {
	case model.PaymentProviderAlipay:
		return "alipay"
	case model.PaymentProviderWechat:
		return "wxpay"
	default:
		return "alipay"
	}
}

func zpayTruncateName(name string) string {
	name = strings.TrimSpace(name)
	if len([]rune(name)) > 100 {
		name = string([]rune(name)[:100])
	}
	if name == "" {
		name = "会员套餐"
	}
	return name
}

// signZPay 按 ZPay 规则做 MD5 签名（参数 a-z 排序，排除 sign / sign_type / 空值）。
func signZPay(params map[string]string, key string) string {
	keys := make([]string, 0, len(params))
	for k, v := range params {
		if k == "sign" || k == "sign_type" || v == "" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	builder := strings.Builder{}
	for i, k := range keys {
		if i > 0 {
			builder.WriteByte('&')
		}
		builder.WriteString(k)
		builder.WriteByte('=')
		builder.WriteString(params[k])
	}
	builder.WriteString(key)
	sum := md5.Sum([]byte(builder.String()))
	return hex.EncodeToString(sum[:])
}
