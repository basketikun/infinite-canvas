package handler

import (
	"net/http"

	"github.com/basketikun/infinite-canvas/service"
)

func MyCreditLogs(w http.ResponseWriter, r *http.Request) {
	user, ok := requireUser(w, r)
	if !ok {
		return
	}
	result, err := service.ListCreditLogs(user.ID, parseQuery(r))
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, result)
}

func MyProfile(w http.ResponseWriter, r *http.Request) {
	user, ok := requireUser(w, r)
	if !ok {
		return
	}
	profile, err := service.CreditProfile(user)
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, profile)
}

// AdminCreditLogs 管理后台：分页查全部用户的积分流水。
func AdminCreditLogs(w http.ResponseWriter, r *http.Request) {
	q := parseQuery(r)
	if v := r.URL.Query().Get("userId"); v != "" {
		q.UserID = v
	}
	result, err := service.ListAllCreditLogsForAdmin(q)
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, result)
}
