package model

type MembershipLevel string

const (
	MembershipLevelFree MembershipLevel = "free"
	MembershipLevelVIP  MembershipLevel = "vip"
	MembershipLevelSVIP MembershipLevel = "svip"
)

// MembershipPlan 会员套餐配置。
type MembershipPlan struct {
	ID             string          `json:"id" gorm:"primaryKey"`
	Name           string          `json:"name"`
	Level          MembershipLevel `json:"level"`
	Description    string          `json:"description"`
	Price          int             `json:"price"`               // 价格，单位：分
	DurationDays   int             `json:"durationDays"`        // 会员有效天数
	CreditsGranted int             `json:"creditsGranted"`      // 赠送算力点数量
	Unlimited      bool            `json:"unlimited"`           // 会员期内是否不限算力点扣费
	PriorityQueue  bool            `json:"priorityQueue"`       // 是否优先队列
	Features       string          `json:"features" gorm:"type:text"` // JSON 文本，记录解锁的功能 key
	Enabled        bool            `json:"enabled"`
	Sort           int             `json:"sort"`
	CreatedAt      string          `json:"createdAt"`
	UpdatedAt      string          `json:"updatedAt"`
}

type MembershipPlanList struct {
	Items []MembershipPlan `json:"items"`
	Total int              `json:"total"`
}

type MembershipOrderStatus string

const (
	MembershipOrderStatusPending   MembershipOrderStatus = "pending"
	MembershipOrderStatusPaid      MembershipOrderStatus = "paid"
	MembershipOrderStatusCancelled MembershipOrderStatus = "cancelled"
)

type PaymentProvider string

const (
	PaymentProviderWechat PaymentProvider = "wechat"
	PaymentProviderAlipay PaymentProvider = "alipay"
	PaymentProviderMock   PaymentProvider = "mock"
)

// MembershipOrder 会员订单。
type MembershipOrder struct {
	ID              string                `json:"id" gorm:"primaryKey"`
	UserID          string                `json:"userId" gorm:"index"`
	PlanID          string                `json:"planId" gorm:"index"`
	PlanName        string                `json:"planName"`
	PlanLevel       MembershipLevel       `json:"planLevel"`
	Amount          int                   `json:"amount"` // 单位：分
	Status          MembershipOrderStatus `json:"status" gorm:"index"`
	PaymentProvider PaymentProvider       `json:"paymentProvider"`
	PaymentID       string                `json:"paymentId"`
	PayURL          string                `json:"payUrl"`
	PaidAt          string                `json:"paidAt"`
	ExpiresAt       string                `json:"expiresAt"`
	CreatedAt       string                `json:"createdAt"`
	UpdatedAt       string                `json:"updatedAt"`
}

type MembershipOrderList struct {
	Items []MembershipOrder `json:"items"`
	Total int               `json:"total"`
}
