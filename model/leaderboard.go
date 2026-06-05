package model

// LeaderboardItem 排行榜条目。
type LeaderboardItem struct {
	UserID      string `json:"userId"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	AvatarURL   string `json:"avatarUrl"`
	Count       int    `json:"count"`
}

type LeaderboardList struct {
	Items []LeaderboardItem `json:"items"`
}
