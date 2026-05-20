package handler

import (
	"encoding/json"
	"net/http"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/service"
)

func MyCanvases(w http.ResponseWriter, r *http.Request) {
	user, ok := requireUser(w, r)
	if !ok {
		return
	}
	result, err := service.ListCanvases(user.ID, parseQuery(r))
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, result)
}

func GetMyCanvas(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := requireUser(w, r)
	if !ok {
		return
	}
	item, err := service.GetCanvas(user.ID, id)
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, item)
}

func SaveMyCanvas(w http.ResponseWriter, r *http.Request) {
	user, ok := requireUser(w, r)
	if !ok {
		return
	}
	var item model.Canvas
	_ = json.NewDecoder(r.Body).Decode(&item)
	saved, err := service.SaveCanvas(user.ID, item)
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, saved)
}

func DeleteMyCanvas(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := requireUser(w, r)
	if !ok {
		return
	}
	if err := service.DeleteCanvas(user.ID, id); err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, true)
}
