# 恢复 Go 控制平面实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 v0.3.0 的 Go 后端恢复为可独立构建、测试和部署的 `server/` 服务，且不改动新版 Vite 画布的调用方式。

**Architecture:** `server/` 是独立 Go module，保留 v0.3.0 的 Gin `/api`、`/api/v1` 与 `/api/admin` 路由、GORM 数据模型和服务层。`docker-compose.control-plane.yml` 单独启动它与 SQLite 持久卷；新版画布适配、独立管理台和云端画布同步属于后续计划。

**Tech Stack:** Go 1.25、Gin、GORM、SQLite/MySQL/PostgreSQL、Docker Compose。

---

## 文件结构

- `server/`：迁入的 `config/`、`handler/`、`middleware/`、`model/`、`repository/`、`router/`、`service/`、`go.mod`、`go.sum`、`main.go`。
- `server/middleware/cors.go`：环境变量驱动的浏览器来源白名单。
- `server/middleware/cors_test.go`、`server/router/router_test.go`：新增的边界测试。
- `server/Dockerfile`、`server/.env.example`、`server/README.md`、`docker-compose.control-plane.yml`：独立运行入口。
- `docs/content/docs/development/control-plane.mdx`、`CHANGELOG.md`、`docs/content/docs/progress/pending-test.mdx`：部署和验收文档。

### Task 1: 从 v0.3.0 还原独立 Go 服务

**Files:**
- Create: `server/go.mod`, `server/go.sum`, `server/main.go`
- Create: `server/config/**`, `server/handler/**`, `server/middleware/admin.go`, `server/model/**`, `server/repository/**`, `server/router/router.go`, `server/service/**`
- Modify: `server/go.mod` 与 `server/**/*.go` 内的 module import

- [ ] **Step 1: 将标签中的后端文件导出至 `server/`**

```bash
mkdir -p server
git archive --format=tar v0.3.0 go.mod go.sum main.go config handler middleware model repository router service | tar -x -C server
```

- [ ] **Step 2: 将模块名和内部 import 改为 fork 的独立服务路径**

```bash
cd server
go mod edit -module github.com/timerainv7/infinite-canvas/server
rg -l 'github.com/basketikun/infinite-canvas' --glob '*.go' | xargs sed -i 's#github.com/basketikun/infinite-canvas#github.com/timerainv7/infinite-canvas/server#g'
go mod tidy
```

`server/main.go` 的三个内部 import 必须是：

```go
"github.com/timerainv7/infinite-canvas/server/config"
"github.com/timerainv7/infinite-canvas/server/router"
"github.com/timerainv7/infinite-canvas/server/service"
```

- [ ] **Step 3: 运行带回的测试，确认服务端基线**

Run: `cd server && go test ./...`

Expected: v0.3.0 的 `config`、`handler`、`service` 测试通过；若失败，只修复 module 路径或遗漏文件，不改变旧路由和数据模型语义。

- [ ] **Step 4: 提交服务端基线**

```bash
git add server
git commit -m "feat(server): restore legacy control plane"
```

### Task 2: 添加来源白名单和路由测试

**Files:**
- Modify: `server/config/config.go`, `server/router/router.go`
- Create: `server/middleware/cors.go`, `server/middleware/cors_test.go`, `server/router/router_test.go`

- [ ] **Step 1: 写出失败的 CORS 白名单测试**

```go
package middleware

import (
    "net/http"
    "net/http/httptest"
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
    if recorder.Header().Get("Access-Control-Allow-Origin") != "https://canvas.example.test" {
        t.Fatalf("unexpected allow-origin: %q", recorder.Header().Get("Access-Control-Allow-Origin"))
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
    if recorder.Header().Get("Access-Control-Allow-Origin") != "" { t.Fatal("unconfigured origin received allow header") }
}
```

Run: `cd server && go test ./middleware -run TestCORS -v`

Expected: FAIL because `CORS` is undefined.

- [ ] **Step 2: 实现最小来源白名单 middleware**

在 `server/config/config.go` 的 `Config` 中加入：

```go
CORSAllowOrigins string `env:"CORS_ALLOW_ORIGINS"`
```

创建 `server/middleware/cors.go`：

```go
package middleware

import (
    "net/http"
    "strings"

    "github.com/gin-gonic/gin"
)

func CORS(allowOrigins string) gin.HandlerFunc {
    allowed := map[string]struct{}{}
    for _, origin := range strings.Split(allowOrigins, ",") {
        if value := strings.TrimSpace(origin); value != "" {
            allowed[value] = struct{}{}
        }
    }
    return func(c *gin.Context) {
        origin := c.GetHeader("Origin")
        if _, ok := allowed[origin]; ok {
            c.Header("Access-Control-Allow-Origin", origin)
            c.Header("Vary", "Origin")
            c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            c.Header("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS")
        }
        if c.Request.Method == http.MethodOptions {
            c.Status(http.StatusNoContent)
            c.Abort()
            return
        }
        c.Next()
    }
}
```

在 `server/router/router.go` 的 `New` 中创建 engine 后加入：

```go
router.Use(middleware.CORS(config.Cfg.CORSAllowOrigins))
```

并加入 `config` import：

```go
"github.com/timerainv7/infinite-canvas/server/config"
```

- [ ] **Step 3: 写健康检查测试并验证**

```go
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
```

Run: `cd server && go test ./middleware ./router && go test ./...`

Expected: PASS.

- [ ] **Step 4: 提交浏览器边界**

```bash
git add server/config/config.go server/middleware server/router
git commit -m "feat(server): add origin allowlist"
```

### Task 3: 添加独立容器与运行文档

**Files:**
- Create: `server/Dockerfile`, `server/.env.example`, `server/README.md`, `docker-compose.control-plane.yml`
- Create: `docs/content/docs/development/control-plane.mdx`
- Modify: `docs/content/docs/development/meta.json`

- [ ] **Step 1: 写独立服务 Dockerfile**

```dockerfile
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/control-plane .
FROM alpine:3.22
RUN apk add --no-cache ca-certificates && addgroup -S app && adduser -S -G app app && mkdir -p /app/data && chown -R app:app /app
WORKDIR /app
COPY --from=build /out/control-plane /usr/local/bin/control-plane
USER app
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/control-plane"]
```

- [ ] **Step 2: 写无秘密的环境样例与 compose 文件**

`server/.env.example`：

```dotenv
PORT=8080
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-before-production
JWT_SECRET=change-this-to-a-long-random-secret
JWT_EXPIRE_HOURS=168
STORAGE_DRIVER=sqlite
DATABASE_DSN=/app/data/infinite-canvas.db
PUBLIC_BASE_URL=http://localhost:8080
CORS_ALLOW_ORIGINS=http://localhost:3000,http://localhost:3001
```

`docker-compose.control-plane.yml`：

```yaml
services:
  control-plane:
    build:
      context: ./server
    env_file:
      - ./server/.env
    ports:
      - "8080:8080"
    volumes:
      - control-plane-data:/app/data
    restart: unless-stopped
volumes:
  control-plane-data:
```

- [ ] **Step 3: 写运行文档并加入导航**

`server/README.md` 和 `docs/content/docs/development/control-plane.mdx` 必须包含：

```text
cp server/.env.example server/.env
cd server && go test ./... && go run .
curl http://127.0.0.1:8080/api/health
docker compose -f docker-compose.control-plane.yml up --build
```

两份文档都必须说明：服务恢复 v0.3.0 的账号、积分、模型代理、提示词、公共素材、参考媒体与系统设置；当前画布仍使用 IndexedDB/WebDAV，不是服务端画布。在 `docs/content/docs/development/meta.json` 增加 `"control-plane": "后端控制平面"`。

- [ ] **Step 4: 验证容器与健康检查**

```bash
cp server/.env.example server/.env
docker compose -f docker-compose.control-plane.yml config
docker compose -f docker-compose.control-plane.yml up --build -d
curl --fail http://127.0.0.1:8080/api/health
docker compose -f docker-compose.control-plane.yml down
```

Expected: compose 合法，`curl` 输出 `ok`，关闭容器后命名卷保留。

- [ ] **Step 5: 提交部署入口与文档**

```bash
git add server docker-compose.control-plane.yml docs/content/docs/development
git commit -m "docs: add control plane deployment"
```

### Task 4: 记录验收项并完成最终验证

**Files:**
- Modify: `CHANGELOG.md`, `docs/content/docs/progress/pending-test.mdx`
- Modify: `docs/content/docs/progress/todo.mdx`（仅当存在对应待办）

- [ ] **Step 1: 写入版本记录与人工验收项**

在 `CHANGELOG.md` 的 `Unreleased` 加入：

```markdown
- [新增] 恢复可独立部署的 Go 后端控制平面，提供旧版账号、模型代理、积分和后台资源管理 API。
```

在 `pending-test.mdx` 加入：

```markdown
## 后端控制平面

- Compose 启动后，`/api/health` 返回 `ok`。
- 使用 `.env` 管理员登录后可访问 `/api/admin/settings`；无管理员 token 时被拒绝。
- 模型渠道 API Key 不出现在浏览器本地存储或请求负载中。
```

- [ ] **Step 2: 运行最终验证并提交**

```bash
cd server && go test ./...
cd ../web && "$HOME/.bun/bin/bun" run typecheck
git diff --check
git status --short
git add CHANGELOG.md docs/content/docs/progress/pending-test.mdx docs/content/docs/progress/todo.mdx
git commit -m "docs: record control plane verification"
```

Expected: Go 测试、前端类型检查和 diff 检查通过，且没有计划外的已跟踪改动。
