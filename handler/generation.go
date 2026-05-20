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
