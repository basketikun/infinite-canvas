package handler

import (
	"encoding/json"
	"net/http"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/service"
)

func MyGenerations(w http.ResponseWriter, r *http.Request) {
	user, ok := requireUser(w, r)
	if !ok {
		return
	}
	result, err := service.ListGenerations(user.ID, parseQuery(r))
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, result)
}

func SaveMyGeneration(w http.ResponseWriter, r *http.Request) {
	user, ok := requireUser(w, r)
	if !ok {
		return
	}
	var item model.Generation
	_ = json.NewDecoder(r.Body).Decode(&item)
	saved, err := service.SaveGeneration(user.ID, item)
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, saved)
}

func DeleteMyGeneration(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := requireUser(w, r)
	if !ok {
		return
	}
	if err := service.DeleteGeneration(user.ID, id); err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, true)
}

// AdminGenerations 管理后台：分页查全部用户的生图历史。
func AdminGenerations(w http.ResponseWriter, r *http.Request) {
	q := parseQuery(r)
	if v := r.URL.Query().Get("userId"); v != "" {
		q.UserID = v
	}
	if v := r.URL.Query().Get("status"); v != "" {
		q.Type = v
	}
	result, err := service.ListAllGenerationsForAdmin(q)
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, result)
}
