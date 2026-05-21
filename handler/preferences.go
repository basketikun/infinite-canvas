package handler

import (
	"encoding/json"
	"net/http"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/service"
)

// UpdateMyPreferences 写入当前用户的跨设备偏好（生图默认值等）。
func UpdateMyPreferences(w http.ResponseWriter, r *http.Request) {
	user, ok := requireUser(w, r)
	if !ok {
		return
	}
	var payload model.UserPreferences
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		Fail(w, "请求体格式错误")
		return
	}
	saved, err := service.UpdateUserPreferences(user.ID, payload)
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, saved)
}
