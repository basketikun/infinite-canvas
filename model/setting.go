package model

import "encoding/json"

type SettingKey string

const (
	SettingKeyPublic  SettingKey = "public"
	SettingKeyPrivate SettingKey = "private"
)

// ModelChannel 模型渠道配置。
type ModelChannel struct {
	Protocol string   `json:"protocol"`
	Name     string   `json:"name"`
	BaseURL  string   `json:"baseUrl"`
	APIKey   string   `json:"apiKey"`
	Models   []string `json:"models"`
	Weight   int      `json:"weight"`
	Enabled  bool     `json:"enabled"`
	Remark   string   `json:"remark"`
}

// ModelCost 模型算力点配置。
type ModelCost struct {
	Model   string `json:"model"`
	Credits int    `json:"credits"`
}

// ImageModelCapability describes optional frontend parameter constraints for an image model.
type ImageModelCapability struct {
	Sizes        []string `json:"sizes"`
	Resolutions  []string `json:"resolutions"`
	AspectRatios []string `json:"aspectRatios"`
}

// PublicModelChannelSetting 公开模型渠道配置。
type PublicModelChannelSetting struct {
	AvailableModels        []string                        `json:"availableModels"`
	ModelCosts             []ModelCost                     `json:"modelCosts"`
	DefaultModel           string                          `json:"defaultModel"`
	DefaultImageModel      string                          `json:"defaultImageModel"`
	ImageModelCapabilities map[string]ImageModelCapability `json:"imageModelCapabilities"`
	DefaultVideoModel      string                          `json:"defaultVideoModel"`
	DefaultTextModel       string                          `json:"defaultTextModel"`
	SystemPrompt           string                          `json:"systemPrompt"`
	AllowCustomChannel     *bool                           `json:"allowCustomChannel"`
	AllowLocalChannel      *bool                           `json:"allowLocalChannel"`
	AllowNewAPIChannel     *bool                           `json:"allowNewApiChannel"`
	AllowRemoteChannel     *bool                           `json:"allowRemoteChannel"`
}

// PublicSetting 公开配置。
type PublicSetting struct {
	ModelChannel PublicModelChannelSetting `json:"modelChannel"`
	Auth         PublicAuthSetting         `json:"auth"`
	UI           PublicUISetting           `json:"ui"`
}

type PublicAuthSetting struct {
	AllowRegister *bool                    `json:"allowRegister"`
	LinuxDo       PublicLinuxDoAuthSetting `json:"linuxDo"`
}

type PublicLinuxDoAuthSetting struct {
	Enabled bool `json:"enabled"`
}

// PublicUISetting 控制前台可见入口和额度展示。
type PublicUISetting struct {
	ShowLoginEntry    *bool `json:"showLoginEntry"`
	ShowCreditBalance *bool `json:"showCreditBalance"`
}

// PrivateSetting 私有配置。
type PrivateSetting struct {
	Channels   []ModelChannel     `json:"channels"`
	PromptSync PromptSyncSetting  `json:"promptSync"`
	Auth       PrivateAuthSetting `json:"auth"`
}

// PromptSyncSetting 提示词定时同步配置。
type PromptSyncSetting struct {
	Enabled *bool  `json:"enabled"`
	Cron    string `json:"cron"`
}

type PrivateAuthSetting struct {
	LinuxDo PrivateLinuxDoAuthSetting `json:"linuxDo"`
}

type PrivateLinuxDoAuthSetting struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
}

// Setting 系统配置。
type Setting struct {
	Key       SettingKey      `json:"key" gorm:"primaryKey"`
	Value     json.RawMessage `json:"value" gorm:"serializer:json"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
}

// Settings 系统公开和私有配置。
type Settings struct {
	Public  PublicSetting  `json:"public"`
	Private PrivateSetting `json:"private"`
}
