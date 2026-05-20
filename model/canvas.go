package model

// Canvas 一张完整的画布项目，data 是前端 CanvasProject 的 JSON 序列化结果。
type Canvas struct {
	ID        string         `json:"id" gorm:"primaryKey"`
	UserID    string         `json:"userId" gorm:"index"`
	Title     string         `json:"title"`
	CoverURL  string         `json:"coverUrl"`
	Data      map[string]any `json:"data" gorm:"serializer:json"`
	CreatedAt string         `json:"createdAt"`
	UpdatedAt string         `json:"updatedAt"`
}

// CanvasSummary 画布列表展示项，不包含完整 data。
type CanvasSummary struct {
	ID        string `json:"id"`
	UserID    string `json:"userId"`
	Title     string `json:"title"`
	CoverURL  string `json:"coverUrl"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// CanvasList 画布列表分页结果。
type CanvasList struct {
	Items []CanvasSummary `json:"items"`
	Total int             `json:"total"`
}
