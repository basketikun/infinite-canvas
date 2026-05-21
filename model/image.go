package model

// Image 用户上传或生成的图片元信息。
// 二进制本身落到磁盘（IMAGE_DIR），DB 只保留 Path 引用。
type Image struct {
	ID        string `json:"id" gorm:"primaryKey"`
	UserID    string `json:"userId" gorm:"index"`
	MimeType  string `json:"mimeType"`
	Size      int    `json:"size"`
	Path      string `json:"-"` // 相对 IMAGE_DIR 的路径，例如 "u123/img-xxx.png"
	CreatedAt string `json:"createdAt"`
}
