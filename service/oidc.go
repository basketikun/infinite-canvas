package service

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

var oidcHTTPClient = &http.Client{Timeout: 15 * time.Second}

type oidcDiscovery struct {
	Issuer        string `json:"issuer"`
	Authorization string `json:"authorization_endpoint"`
	Token         string `json:"token_endpoint"`
	UserInfo      string `json:"userinfo_endpoint"`
}

type oidcTokenResponse struct {
	AccessToken string `json:"access_token"`
	IDToken     string `json:"id_token"`
	TokenType   string `json:"token_type"`
}

// OIDCAuthorizeURL 生成 OIDC IdP 授权地址。
func OIDCAuthorizeURL(r *http.Request, redirect string) (string, error) {
	settings, err := repository.GetSettings()
	if err != nil {
		return "", err
	}
	settings = normalizeSettings(settings)
	if !settings.Public.Auth.OIDC.Enabled {
		return "", safeMessageError{message: "OIDC 登录未开启"}
	}
	oidc := settings.Private.Auth.OIDC
	if strings.TrimSpace(oidc.Issuer) == "" || strings.TrimSpace(oidc.ClientID) == "" {
		return "", safeMessageError{message: "OIDC 登录未配置"}
	}
	discovery, err := fetchOIDCDiscovery(oidc.Issuer)
	if err != nil {
		return "", err
	}
	values := url.Values{}
	values.Set("client_id", oidc.ClientID)
	values.Set("redirect_uri", oidcRedirectURI(r))
	values.Set("response_type", "code")
	values.Set("scope", oidcScopes(oidc.Scopes))
	values.Set("state", base64.RawURLEncoding.EncodeToString([]byte(redirect)))
	return discovery.Authorization + "?" + values.Encode(), nil
}

// LoginWithOIDC 处理 OIDC 回调，返回会话和跳转地址。
func LoginWithOIDC(r *http.Request, code string, state string) (model.AuthSession, string, error) {
	redirect := decodeState(state)
	settings, err := repository.GetSettings()
	if err != nil {
		return model.AuthSession{}, redirect, err
	}
	settings = normalizeSettings(settings)
	if !settings.Public.Auth.OIDC.Enabled {
		return model.AuthSession{}, redirect, safeMessageError{message: "OIDC 登录未开启"}
	}
	oidc := settings.Private.Auth.OIDC
	discovery, err := fetchOIDCDiscovery(oidc.Issuer)
	if err != nil {
		return model.AuthSession{}, redirect, err
	}
	token, err := exchangeOIDCToken(r, code, discovery.Token, oidc)
	if err != nil {
		return model.AuthSession{}, redirect, err
	}
	userInfo, err := fetchOIDCUserInfo(discovery.UserInfo, token.AccessToken)
	if err != nil {
		return model.AuthSession{}, redirect, err
	}
	sub := strings.TrimSpace(stringClaim(userInfo, "sub"))
	if sub == "" {
		return model.AuthSession{}, redirect, safeMessageError{message: "OIDC 用户信息缺少 sub"}
	}
	user, ok, err := repository.GetUserByOIDCSub(sub)
	if err != nil {
		return model.AuthSession{}, redirect, err
	}
	username := pickClaim(userInfo, oidc.UsernameClaim, "preferred_username", "email", "name")
	displayName := pickClaim(userInfo, oidc.DisplayNameClaim, "name", "preferred_username")
	avatar := pickClaim(userInfo, oidc.AvatarClaim, "picture", "avatar_url")
	if !ok {
		if settings.Public.Auth.AllowRegister != nil && !*settings.Public.Auth.AllowRegister {
			return model.AuthSession{}, redirect, safeMessageError{message: "当前未开放注册"}
		}
		user = model.User{
			ID:          newID("user"),
			Username:    oidcUsername(username, sub),
			DisplayName: strings.TrimSpace(displayName),
			AvatarURL:   strings.TrimSpace(avatar),
			Role:        model.UserRoleUser,
			AffCode:     newAffCode(),
			OIDCSub:     sub,
			Status:      model.UserStatusActive,
			CreatedAt:   now(),
		}
	} else if user.Status == model.UserStatusBan {
		return model.AuthSession{}, redirect, safeMessageError{message: "账号已被禁用"}
	}
	user.DisplayName = firstNonEmpty(displayName, user.DisplayName)
	user.AvatarURL = firstNonEmpty(avatar, user.AvatarURL)
	user.LastLoginAt = now()
	user.UpdatedAt = now()
	extra, _ := json.Marshal(map[string]any{"oidc": userInfo})
	user.Extra = string(extra)
	user, err = repository.SaveUser(user)
	if err != nil {
		return model.AuthSession{}, redirect, err
	}
	session, err := newSession(user)
	return session, redirect, err
}

func fetchOIDCDiscovery(issuer string) (oidcDiscovery, error) {
	issuer = strings.TrimRight(strings.TrimSpace(issuer), "/")
	if issuer == "" {
		return oidcDiscovery{}, safeMessageError{message: "OIDC Issuer 为空"}
	}
	req, _ := http.NewRequest(http.MethodGet, issuer+"/.well-known/openid-configuration", nil)
	res, err := oidcHTTPClient.Do(req)
	if err != nil {
		return oidcDiscovery{}, safeMessageError{message: "无法访问 OIDC Issuer：" + err.Error()}
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode >= http.StatusBadRequest {
		return oidcDiscovery{}, safeMessageError{message: fmt.Sprintf("OIDC 自动发现失败（%d）", res.StatusCode)}
	}
	var discovery oidcDiscovery
	if err := json.Unmarshal(body, &discovery); err != nil {
		return oidcDiscovery{}, safeMessageError{message: "OIDC 自动发现返回不是 JSON"}
	}
	if discovery.Authorization == "" || discovery.Token == "" || discovery.UserInfo == "" {
		return oidcDiscovery{}, safeMessageError{message: "OIDC 自动发现缺少必要端点"}
	}
	return discovery, nil
}

func exchangeOIDCToken(r *http.Request, code string, tokenURL string, oidc model.PrivateOIDCAuthSetting) (oidcTokenResponse, error) {
	values := url.Values{}
	values.Set("grant_type", "authorization_code")
	values.Set("code", code)
	values.Set("redirect_uri", oidcRedirectURI(r))
	values.Set("client_id", oidc.ClientID)
	values.Set("client_secret", oidc.ClientSecret)
	req, _ := http.NewRequest(http.MethodPost, tokenURL, strings.NewReader(values.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	res, err := oidcHTTPClient.Do(req)
	if err != nil {
		return oidcTokenResponse{}, safeMessageError{message: "换取 OIDC token 失败：" + err.Error()}
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode >= http.StatusBadRequest {
		return oidcTokenResponse{}, safeMessageError{message: fmt.Sprintf("换取 OIDC token 失败（%d）：%s", res.StatusCode, string(body))}
	}
	var token oidcTokenResponse
	if err := json.Unmarshal(body, &token); err != nil {
		return oidcTokenResponse{}, safeMessageError{message: "OIDC token 响应不是 JSON"}
	}
	if strings.TrimSpace(token.AccessToken) == "" {
		return oidcTokenResponse{}, safeMessageError{message: "OIDC 未返回 access_token"}
	}
	return token, nil
}

func fetchOIDCUserInfo(userInfoURL string, accessToken string) (map[string]any, error) {
	req, _ := http.NewRequest(http.MethodGet, userInfoURL, nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	res, err := oidcHTTPClient.Do(req)
	if err != nil {
		return nil, safeMessageError{message: "拉取 OIDC 用户信息失败：" + err.Error()}
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode >= http.StatusBadRequest {
		return nil, safeMessageError{message: fmt.Sprintf("拉取 OIDC 用户信息失败（%d）", res.StatusCode)}
	}
	payload := map[string]any{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, safeMessageError{message: "OIDC 用户信息不是 JSON"}
	}
	return payload, nil
}

func oidcRedirectURI(r *http.Request) string {
	return RequestOrigin(r) + "/api/auth/oidc/callback"
}

func oidcScopes(custom string) string {
	scope := strings.TrimSpace(custom)
	if scope == "" {
		scope = "openid profile email"
	}
	return scope
}

func oidcUsername(username string, sub string) string {
	base := strings.TrimSpace(username)
	if base == "" {
		base = "oidc-" + sub
	}
	base = strings.ReplaceAll(base, " ", "-")
	if _, ok, err := repository.GetUserByUsername(base); err != nil || !ok {
		return base
	}
	return base + "-" + sub
}

func pickClaim(payload map[string]any, fallbacks ...string) string {
	for _, key := range fallbacks {
		if key == "" {
			continue
		}
		if value := stringClaim(payload, key); strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func stringClaim(payload map[string]any, key string) string {
	value, ok := payload[key]
	if !ok {
		return ""
	}
	switch v := value.(type) {
	case string:
		return v
	case float64:
		return fmt.Sprintf("%.0f", v)
	case bool:
		if v {
			return "true"
		}
		return "false"
	}
	return ""
}
