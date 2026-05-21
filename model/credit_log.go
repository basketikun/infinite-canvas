package model

type CreditLogType string

const (
	CreditLogTypeConsume     CreditLogType = "consume"
	CreditLogTypeAdminAdjust CreditLogType = "admin_adjust"
	CreditLogTypeSignupBonus CreditLogType = "signup_bonus"
)

// CreditLog 用户额度变动流水。
type CreditLog struct {
	ID         string        `json:"id" gorm:"primaryKey"`
	UserID     string        `json:"userId" gorm:"index"`
	Type       CreditLogType `json:"type"`
	Amount     int           `json:"amount"`
	Balance    int           `json:"balance"`
	Model      string        `json:"model"`
	RelatedID  string        `json:"relatedId"`
	OperatorID string        `json:"operatorId"`
	Remark     string        `json:"remark"`
	CreatedAt  string        `json:"createdAt"`
}

// CreditLogList 流水分页结果。
type CreditLogList struct {
	Items []CreditLog `json:"items"`
	Total int         `json:"total"`
}

// AdminCreditLogItem 管理后台展示用，附带 username 和 operatorUsername。
type AdminCreditLogItem struct {
	CreditLog
	Username         string `json:"username"`
	OperatorUsername string `json:"operatorUsername"`
}

// AdminCreditLogList 管理后台流水分页结果。
type AdminCreditLogList struct {
	Items []AdminCreditLogItem `json:"items"`
	Total int                  `json:"total"`
}

// CreditProfile 个人中心聚合数据。
type CreditProfile struct {
	User           AuthUser `json:"user"`
	TotalConsumed  int      `json:"totalConsumed"`
	TotalGranted   int      `json:"totalGranted"`
	GeneratedCount int      `json:"generatedCount"`
}
