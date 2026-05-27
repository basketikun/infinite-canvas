package model

// Announcement 公告记录。
type Announcement struct {
	ID        string `json:"id" gorm:"primaryKey"`
	Title     string `json:"title"`
	Content   string `json:"content" gorm:"type:text"`
	DateFrom  string `json:"dateFrom" gorm:"index"`
	DateTo    string `json:"dateTo" gorm:"index"`
	SortOrder int    `json:"sortOrder" gorm:"index"`
	Enabled   bool   `json:"enabled" gorm:"index"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// AnnouncementList 公告分页结果。
type AnnouncementList struct {
	Items []Announcement `json:"items"`
	Total int            `json:"total"`
}
