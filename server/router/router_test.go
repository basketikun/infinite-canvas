package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/timerainv7/infinite-canvas/server/config"
)

func TestHealth(t *testing.T) {
	previous := config.Cfg
	t.Cleanup(func() { config.Cfg = previous })
	config.Cfg = config.Config{}

	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	recorder := httptest.NewRecorder()
	New().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK || recorder.Body.String() != "ok" {
		t.Fatalf("health response = %d %q, want 200 ok", recorder.Code, recorder.Body.String())
	}
}
