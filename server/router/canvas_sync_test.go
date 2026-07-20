package router

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/timerainv7/infinite-canvas/server/config"
	"github.com/timerainv7/infinite-canvas/server/model"
	"github.com/timerainv7/infinite-canvas/server/repository"
	"github.com/timerainv7/infinite-canvas/server/service"
)

func TestCanvasProjectPutUsesIfMatchRevision(t *testing.T) {
	previous := config.Cfg
	t.Cleanup(func() { config.Cfg = previous })
	config.Cfg = config.Config{JWTSecret: "test-secret", StorageDriver: "sqlite", DatabaseDSN: t.TempDir() + "/canvas.db"}
	if _, err := repository.SaveUser(model.User{ID: "canvas-user", Username: "canvas-user", Role: model.UserRoleUser, Status: model.UserStatusActive}); err != nil {
		t.Fatal(err)
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, service.TokenClaims{UserID: "canvas-user", Username: "canvas-user", Role: model.UserRoleUser, RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}}).SignedString([]byte(config.Cfg.JWTSecret))
	if err != nil {
		t.Fatal(err)
	}
	router := New()
	request := httptest.NewRequest(http.MethodPut, "/api/v1/canvas/projects/project-1", bytes.NewBufferString(`{"title":"测试画布","payload":{"nodes":[]}}`))
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("If-Match", "0")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("create status = %d body=%s", recorder.Code, recorder.Body.String())
	}

	stale := httptest.NewRequest(http.MethodPut, "/api/v1/canvas/projects/project-1", bytes.NewBufferString(`{"title":"过期写入","payload":{}}`))
	stale.Header.Set("Authorization", "Bearer "+token)
	stale.Header.Set("Content-Type", "application/json")
	stale.Header.Set("If-Match", "0")
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, stale)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("stale status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Data struct {
			CurrentRevision int64 `json:"currentRevision"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil || body.Data.CurrentRevision != 1 {
		t.Fatalf("conflict response = %s err=%v", recorder.Body.String(), err)
	}
}
