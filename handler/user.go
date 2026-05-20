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
