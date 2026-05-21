package model

type GenerationMode string

const (
	GenerationModeImage GenerationMode = "image"
	GenerationModeEdit  GenerationMode = "edit"
)

type GenerationStatus string

const (
	// GenerationStatusRunning 点击「开始生成」时立即写库的占位状态，task 跑完后再 upsert 为下面三种之一。
	GenerationStatusRunning GenerationStatus = "running"
	GenerationStatusSuccess GenerationStatus = "success"
	GenerationStatusPartial GenerationStatus = "partial"
	GenerationStatusFailed  GenerationStatus = "failed"
)

// Generation 一次生图工作台调用的元信息（缩略图不入库）。
type Generation struct {
	ID            string           `json:"id" gorm:"primaryKey"`
	UserID        string           `json:"userId" gorm:"index"`
	Prompt        string           `json:"prompt"`
	Mode          GenerationMode   `json:"mode"`
	Model         string           `json:"model"`
	Size          string           `json:"size"`
	Quality       string           `json:"quality"`
	Count         int              `json:"count"`
	SuccessCount  int              `json:"successCount"`
	FailCount     int              `json:"failCount"`
	DurationMs    int              `json:"durationMs"`
	Status        GenerationStatus `json:"status"`
	Thumbnails    []string         `json:"thumbnails" gorm:"serializer:json"`
	References    []string         `json:"references" gorm:"serializer:json"`
	// 各 slot 的错误信息（admin 排查用），失败 slot 一条，长度一般 <= FailCount。
	Errors []string `json:"errors" gorm:"serializer:json"`
	// 最近一次反代调用的请求参数（mode、size、quality、n、references 数量等），admin 详情页展示。
	RequestParams map[string]any `json:"requestParams" gorm:"serializer:json"`
	// 最近一次成功反代调用的上游响应 raw JSON 字符串，已去掉 b64_json 大字段，仅保留元信息（status、data[].url、data[].revised_prompt 等）。
	UpstreamMeta string `json:"upstreamMeta"`
	CreatedAt    string `json:"createdAt"`
}

// GenerationList 生图历史分页结果。
type GenerationList struct {
	Items []Generation `json:"items"`
	Total int          `json:"total"`
}

// AdminGenerationItem 管理后台展示用，比 Generation 多一个 username。
type AdminGenerationItem struct {
	Generation
	Username string `json:"username"`
}

// AdminGenerationList 管理后台生图历史分页结果。
type AdminGenerationList struct {
	Items []AdminGenerationItem `json:"items"`
	Total int                   `json:"total"`
}
