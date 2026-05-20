package model

// AIConfig OpenAI 兼容接口的连接配置。
type AIConfig struct {
	ID         string `json:"id" gorm:"primaryKey"`
	Name       string `json:"name"`
	BaseURL    string `json:"baseUrl"`
	APIKey     string `json:"apiKey,omitempty"`
	ImageModel string `json:"imageModel"`
	TextModel  string `json:"textModel"`
	Enabled    bool   `json:"enabled"`
	CreatedAt  string `json:"createdAt"`
	UpdatedAt  string `json:"updatedAt"`
}

// AIConfigList AI 配置列表结果。
type AIConfigList struct {
	Items []AIConfig `json:"items"`
	Total int        `json:"total"`
}
