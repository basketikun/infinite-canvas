package handler

import (
	"encoding/json"
	"net/http"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/service"
)

func Announcements(w http.ResponseWriter, r *http.Request) {
	result, err := service.ListActiveAnnouncements()
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminAnnouncements(w http.ResponseWriter, r *http.Request) {
	result, err := service.ListAnnouncements(parseQuery(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminSaveAnnouncement(w http.ResponseWriter, r *http.Request) {
	var item model.Announcement
	_ = json.NewDecoder(r.Body).Decode(&item)
	result, err := service.SaveAnnouncement(item)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminDeleteAnnouncement(w http.ResponseWriter, r *http.Request, id string) {
	if err := service.DeleteAnnouncement(id); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}
