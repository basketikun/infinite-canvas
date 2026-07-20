# 恢复独立管理台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development.

**Goal:** 将 v0.3.0 的完整管理后台作为独立 Next.js 应用部署，并只通过 Go 控制平面 API 管理数据。

**Architecture:** 以 v0.3.0 的 `web/` 为源码基线复制为 `legacy-admin/`，保留其 `/admin`、登录、`/api/[...path]` 代理和管理服务。它与当前 Vite `web/` 不共享路由、不修改彼此文件；代理目标由 `API_BASE_URL` 指向 `server/`。

### Task 1: 迁入管理员应用

**Files:** Create `legacy-admin/**` from `v0.3.0:web/**`; modify `legacy-admin/next.config.*`, `legacy-admin/Dockerfile`, `legacy-admin/.env.example`.

- [ ] 导出管理应用：`git archive --format=tar v0.3.0 web | tar -x -C /tmp && mv /tmp/web legacy-admin`。
- [ ] 保留 `app/(admin)/admin/**`、`app/(user)/login/**`、`services/api/admin.ts`、`services/api/auth.ts` 与 `app/api/[...path]/route.ts`；旧画布页面不得作为新版画布入口链接。
- [ ] 设置 `.env.example`：`API_BASE_URL=http://control-plane:8080`、`NEXT_PUBLIC_DOC_URL`；禁止写入 JWT、模型 Key。
- [ ] 运行 `cd legacy-admin && bun install --frozen-lockfile && bun run build`；期望 Next.js 生产构建成功。
- [ ] 提交：`feat(admin): restore legacy administration console`。

### Task 2: 容器化并连接控制平面

**Files:** Create `legacy-admin/Dockerfile`; modify `docker-compose.control-plane.yml`; test `legacy-admin` proxy route.

- [ ] 使用 v0.3.0 的 standalone Next Docker 构建方式，仅构建 `legacy-admin/`，运行时暴露 `3001`。
- [ ] 在 Compose 增加：

```yaml
  admin:
    build: ./legacy-admin
    environment:
      API_BASE_URL: http://control-plane:8080
    ports: ["3001:3000"]
    depends_on: [control-plane]
```

- [ ] 用 `docker compose -f docker-compose.control-plane.yml up --build -d` 启动；`curl --fail http://127.0.0.1:3001/login` 必须得到 HTML，管理员登录后 `/admin/settings` 返回管理页。
- [ ] 验证代理：错误 token 请求 `/api/admin/settings` 必须从 Go 服务得到 401/403，而不是 Next 404。
- [ ] 提交：`feat(admin): deploy console with control plane`。

### Task 3: 记录验收

**Files:** Modify `CHANGELOG.md`, `docs/content/docs/progress/pending-test.mdx`.

- [ ] 记录用户、积分日志、提示词、素材、系统设置五个管理页的人工验收项。
- [ ] 最终运行 `go test ./...`（在 `server/`）与 `bun run build`（在 `legacy-admin/`），并提交 `docs: record admin console verification`。
