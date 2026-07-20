package model

type AssetType string

const (
	AssetTypeText  AssetType = "text"
	AssetTypeImage AssetType = "image"
)

// Asset 素材记录。
type Asset struct {
	ID          string    `json:"id" gorm:"primaryKey"`
	Title       string    `json:"title"`
	Type        AssetType `json:"type"`
	CoverURL    string    `json:"coverUrl"`
	Tags        []string  `json:"tags" gorm:"serializer:json"`
	Category    string    `json:"category"`
	Description string    `json:"description"`
	Content     string    `json:"content,omitempty"`
	URL         string    `json:"url,omitempty"`
	CreatedAt   string    `json:"createdAt"`
	UpdatedAt   string    `json:"updatedAt"`
}

// AssetList 素材分页结果。
type AssetList struct {
	Items []Asset  `json:"items"`
	Tags  []string `json:"tags"`
	Total int      `json:"total"`
}
