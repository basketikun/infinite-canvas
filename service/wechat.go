package service

import (
	"context"
	"crypto/rsa"
	"net/http"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/core/auth/verifiers"
	"github.com/wechatpay-apiv3/wechatpay-go/core/downloader"
	"github.com/wechatpay-apiv3/wechatpay-go/core/notify"
	"github.com/wechatpay-apiv3/wechatpay-go/core/option"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments/native"
	"github.com/wechatpay-apiv3/wechatpay-go/utils"
)

// BuildWechatPayURL 调用微信支付 V3 Native 下单接口，返回扫码 code_url。
func BuildWechatPayURL(order model.MembershipOrder) (string, error) {
	client, cfg, err := wechatClient()
	if err != nil {
		return "", err
	}
	svc := native.NativeApiService{Client: client}
	expireTime := time.Now().Add(30 * time.Minute)
	resp, _, err := svc.Prepay(context.Background(), native.PrepayRequest{
		Appid:       core.String(cfg.AppID),
		Mchid:       core.String(cfg.MchID),
		Description: core.String(zpayTruncateName(order.PlanName)),
		OutTradeNo:  core.String(order.ID),
		TimeExpire:  core.Time(expireTime),
		NotifyUrl:   core.String(cfg.NotifyURL),
		Amount: &native.Amount{
			Total:    core.Int64(int64(order.Amount)),
			Currency: core.String("CNY"),
		},
	})
	if err != nil {
		return "", safeMessageError{message: "微信下单失败：" + err.Error()}
	}
	if resp == nil || resp.CodeUrl == nil || *resp.CodeUrl == "" {
		return "", safeMessageError{message: "微信下单未返回 code_url"}
	}
	return *resp.CodeUrl, nil
}

// VerifyWechatNotify 解析微信支付 V3 异步回调，校验签名并解密资源，返回订单号和交易号。
func VerifyWechatNotify(r *http.Request) (string, string, error) {
	settings, err := repository.GetSettings()
	if err != nil {
		return "", "", err
	}
	cfg := normalizeSettings(settings).Private.Payment.Wechat
	if !cfg.Enabled {
		return "", "", safeMessageError{message: "微信支付未开启"}
	}
	if strings.TrimSpace(cfg.APIV3Key) == "" {
		return "", "", safeMessageError{message: "微信支付未配置 APIv3 密钥"}
	}
	if err := ensureWechatDownloaderRegistered(cfg); err != nil {
		return "", "", err
	}
	visitor := downloader.MgrInstance().GetCertificateVisitor(cfg.MchID)
	handler := notify.NewNotifyHandler(cfg.APIV3Key, verifiers.NewSHA256WithRSAVerifier(visitor))
	transaction := struct {
		OutTradeNo    string `json:"out_trade_no"`
		TransactionID string `json:"transaction_id"`
		TradeState    string `json:"trade_state"`
	}{}
	if _, err := handler.ParseNotifyRequest(context.Background(), r, &transaction); err != nil {
		return "", "", safeMessageError{message: "微信回调验签失败：" + err.Error()}
	}
	if transaction.TradeState != "SUCCESS" {
		return "", "", safeMessageError{message: "微信回调状态非 SUCCESS：" + transaction.TradeState}
	}
	if strings.TrimSpace(transaction.OutTradeNo) == "" {
		return "", "", safeMessageError{message: "微信回调缺少订单号"}
	}
	return transaction.OutTradeNo, transaction.TransactionID, nil
}

func wechatClient() (*core.Client, model.PrivateWechatSetting, error) {
	settings, err := repository.GetSettings()
	if err != nil {
		return nil, model.PrivateWechatSetting{}, err
	}
	cfg := normalizeSettings(settings).Private.Payment.Wechat
	if !cfg.Enabled {
		return nil, cfg, safeMessageError{message: "微信支付未开启"}
	}
	if strings.TrimSpace(cfg.AppID) == "" || strings.TrimSpace(cfg.MchID) == "" {
		return nil, cfg, safeMessageError{message: "微信支付未配置 AppID 或商户号"}
	}
	if strings.TrimSpace(cfg.MchPrivateKey) == "" || strings.TrimSpace(cfg.SerialNo) == "" {
		return nil, cfg, safeMessageError{message: "微信支付未配置商户私钥或证书序列号"}
	}
	if strings.TrimSpace(cfg.APIV3Key) == "" {
		return nil, cfg, safeMessageError{message: "微信支付未配置 APIv3 密钥"}
	}
	privateKey, err := loadWechatPrivateKey(cfg.MchPrivateKey)
	if err != nil {
		return nil, cfg, err
	}
	client, err := core.NewClient(context.Background(), option.WithWechatPayAutoAuthCipher(cfg.MchID, cfg.SerialNo, privateKey, cfg.APIV3Key))
	if err != nil {
		return nil, cfg, safeMessageError{message: "初始化微信支付客户端失败：" + err.Error()}
	}
	return client, cfg, nil
}

// ensureWechatDownloaderRegistered 把当前商户注册到全局证书下载器（幂等）。
func ensureWechatDownloaderRegistered(cfg model.PrivateWechatSetting) error {
	mgr := downloader.MgrInstance()
	if mgr.GetCertificateVisitor(cfg.MchID) != nil {
		return nil
	}
	privateKey, err := loadWechatPrivateKey(cfg.MchPrivateKey)
	if err != nil {
		return err
	}
	if err := mgr.RegisterDownloaderWithPrivateKey(context.Background(), privateKey, cfg.SerialNo, cfg.MchID, cfg.APIV3Key); err != nil {
		return safeMessageError{message: "注册微信平台证书下载器失败：" + err.Error()}
	}
	return nil
}

func loadWechatPrivateKey(pem string) (*rsa.PrivateKey, error) {
	key, err := utils.LoadPrivateKey(pem)
	if err != nil {
		return nil, safeMessageError{message: "解析微信商户私钥失败：" + err.Error()}
	}
	return key, nil
}
