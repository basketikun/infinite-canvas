package model

type GenerationMode string

const (
	GenerationModeImage GenerationMode = "image"
	GenerationModeEdit  GenerationMode = "edit"
)

type GenerationStatus string

const (
	GenerationStatusSuccess GenerationStatus = "success"
	GenerationStatusPartial GenerationStatus = "partial"
	GenerationStatusFailed  GenerationStatus = "failed"
)

// Generation 一次生图工作台调用的元信息（缩略图不入库）。
type Generation struct {
	ID           string           `json:"id" gorm:"primaryKey"`
	UserID       string           `json:"userId" gorm:"index"`
	Prompt       string           `json:"prompt"`
	Mode         GenerationMode   `json:"mode"`
	Model        string           `json:"model"`
	Size         string           `json:"size"`
	Quality      string           `json:"quality"`
	Count        int              `json:"count"`
	SuccessCount int              `json:"successCount"`
	FailCount    int              `json:"failCount"`
	DurationMs   int              `json:"durationMs"`
	Status       GenerationStatus `json:"status"`
	Thumbnails   []string         `json:"thumbnails" gorm:"serializer:json"`
	CreatedAt    string           `json:"createdAt"`
}

// GenerationList 生图历史分页结果。
type GenerationList struct {
	Items []Generation `json:"items"`
	Total int          `json:"total"`
}
