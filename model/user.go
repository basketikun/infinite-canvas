package model

type UserRole string

const (
	UserRoleGuest UserRole = "guest"
	UserRoleUser  UserRole = "user"
	UserRoleAdmin UserRole = "admin"
)

const DefaultUserCredits = 4

// UserPreferences 用户跨设备的偏好配置（生图默认值等）。JSON 列存储，便于以后扩展。
type UserPreferences struct {
	Quality string `json:"quality"`
	Size    string `json:"size"`
	Count   string `json:"count"`
}

// User 系统用户。
type User struct {
	ID          string          `json:"id" gorm:"primaryKey"`
	Username    string          `json:"username" gorm:"uniqueIndex"`
	Password    string          `json:"password,omitempty"`
	Role        UserRole        `json:"role"`
	Credits     int             `json:"credits"`
	Preferences UserPreferences `json:"preferences" gorm:"serializer:json"`
	CreatedAt   string          `json:"createdAt"`
	UpdatedAt   string          `json:"updatedAt"`
}

// UserList 用户分页结果。
type UserList struct {
	Items []User `json:"items"`
	Total int    `json:"total"`
}

// AuthUser 用户公开信息。
type AuthUser struct {
	ID          string          `json:"id"`
	Username    string          `json:"username"`
	Role        UserRole        `json:"role"`
	Credits     int             `json:"credits"`
	Preferences UserPreferences `json:"preferences"`
	CreatedAt   string          `json:"createdAt"`
	UpdatedAt   string          `json:"updatedAt"`
}

// AuthSession 登录会话信息。
type AuthSession struct {
	Token string   `json:"token"`
	User  AuthUser `json:"user"`
}

func PublicUser(user User) AuthUser {
	return AuthUser{
		ID:          user.ID,
		Username:    user.Username,
		Role:        user.Role,
		Credits:     user.Credits,
		Preferences: user.Preferences,
		CreatedAt:   user.CreatedAt,
		UpdatedAt:   user.UpdatedAt,
	}
}
