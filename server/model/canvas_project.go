package model

// CanvasProject 是一个用户画布的当前元数据；内容保存在不可变修订中。
type CanvasProject struct {
	ID              string `json:"id" gorm:"primaryKey"`
	UserID          string `json:"userId" gorm:"index;not null"`
	Title           string `json:"title"`
	CurrentRevision int64  `json:"currentRevision"`
	CreatedAt       string `json:"createdAt"`
	UpdatedAt       string `json:"updatedAt"`
}

// CanvasRevision 保存项目的一个不可变 JSON 快照。
type CanvasRevision struct {
	ProjectID string `json:"projectId" gorm:"primaryKey"`
	Revision  int64  `json:"revision" gorm:"primaryKey"`
	Payload   string `json:"payload" gorm:"type:text"`
	CreatedAt string `json:"createdAt"`
}

// MediaObject 描述存放在对象存储中的用户媒体；对象内容不写入关系型数据库。
type MediaObject struct {
	UserID    string `json:"userId" gorm:"primaryKey"`
	Key       string `json:"key" gorm:"primaryKey"`
	SHA256    string `json:"sha256" gorm:"index"`
	Bytes     int64  `json:"bytes"`
	MimeType  string `json:"mimeType"`
	CreatedAt string `json:"createdAt"`
}
