package handler

import (
	"encoding/json"
	"net/http"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/service"
)

func AdminAIConfigs(w http.ResponseWriter, r *http.Request) {
	list, err := service.ListAIConfigs()
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, list)
}

func AdminSaveAIConfig(w http.ResponseWriter, r *http.Request) {
	var item model.AIConfig
	_ = json.NewDecoder(r.Body).Decode(&item)
	saved, err := service.SaveAIConfig(item)
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, saved)
}

func AdminDeleteAIConfig(w http.ResponseWriter, r *http.Request, id string) {
	if err := service.DeleteAIConfig(id); err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, true)
}

func AdminEnableAIConfig(w http.ResponseWriter, r *http.Request, id string) {
	if err := service.EnableAIConfig(id); err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, true)
}

func AdminProbeAIModels(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		ID      string `json:"id"`
		BaseURL string `json:"baseUrl"`
		APIKey  string `json:"apiKey"`
	}
	_ = json.NewDecoder(r.Body).Decode(&payload)
	items, err := service.ProbeAIModels(payload.BaseURL, payload.APIKey, payload.ID)
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, map[string]any{"items": items})
}

func AdminTestAIConfig(w http.ResponseWriter, r *http.Request, id string) {
	count, err := service.TestAIConfig(id)
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, map[string]any{"modelCount": count})
}
