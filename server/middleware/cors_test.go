package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCORSAllowsConfiguredOrigin(t *testing.T) {
	router := gin.New()
	router.Use(CORS("https://canvas.example.test, https://admin.example.test"))
	router.GET("/api/health", func(c *gin.Context) { c.Status(http.StatusOK) })

	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Header.Set("Origin", "https://canvas.example.test")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "https://canvas.example.test" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want configured origin", got)
	}
}

func TestCORSDeniesUnconfiguredOrigin(t *testing.T) {
	router := gin.New()
	router.Use(CORS("https://canvas.example.test"))
	router.GET("/api/health", func(c *gin.Context) { c.Status(http.StatusOK) })

	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Header.Set("Origin", "https://untrusted.example.test")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want empty", got)
	}
}

func TestCORSAllowsIfMatchForCanvasRevisionWrites(t *testing.T) {
	router := gin.New()
	router.Use(CORS("https://canvas.example.test"))
	router.OPTIONS("/api/v1/canvas/projects/:id", func(c *gin.Context) { c.Status(http.StatusNoContent) })

	request := httptest.NewRequest(http.MethodOptions, "/api/v1/canvas/projects/project-1", nil)
	request.Header.Set("Origin", "https://canvas.example.test")
	request.Header.Set("Access-Control-Request-Headers", "authorization,content-type,if-match")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if got := recorder.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(strings.ToLower(got), "if-match") {
		t.Fatalf("Access-Control-Allow-Headers = %q, want If-Match", got)
	}
}
