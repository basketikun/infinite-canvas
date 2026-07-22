# 单域名网关发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过一个内置 Nginx 网关，把画布、控制平面与管理台安全发布到一个域名的 `/`、`/api/`、`/admin`。

**Architecture:** Compose 仅让 gateway 绑定 `127.0.0.1:3002`，其余服务使用内部网络名称。Next.js 管理台在构建期使用 `/admin` basePath，并将原有管理员目录提升一层以避免双重 `/admin/admin`。

**Tech Stack:** Docker Compose、Nginx Alpine、Next.js 16、Bun。

---

### Task 1: 建立单域名网关发布入口

**Files:**
- Create: `deploy/nginx/infinite-canvas.conf`
- Modify: `docker-compose.release.yml`
- Modify: `.github/workflows/integration.yml`

- [ ] **Step 1: 写入并运行发布配置断言，确认当前配置不符合目标**

Run: `IMAGE_OWNER=example IMAGE_TAG=0123456789abcdef0123456789abcdef01234567 CONTROL_PLANE_URL=https://canvas.example.test docker compose --env-file server/.env.example -f docker-compose.release.yml config`

Expected: 输出显示现有 `web`、`control-plane`、`admin` 直接发布端口，且没有 `gateway` 服务。

- [ ] **Step 2: 添加 Nginx 路由配置**

```nginx
location /api/ { proxy_pass http://control-plane:8080; }
location /admin/ { proxy_pass http://admin:3000; }
location / { proxy_pass http://web:3000; }
```

- [ ] **Step 3: 修改生产 Compose**

删除三个业务服务的 `ports`，添加 `gateway`，将 `127.0.0.1:3002:80` 映射到 Nginx，并只读挂载该配置。

- [ ] **Step 4: 运行配置与 Nginx 语法验证**

Run: `IMAGE_OWNER=example IMAGE_TAG=0123456789abcdef0123456789abcdef01234567 CONTROL_PLANE_URL=https://canvas.example.test docker compose --env-file server/.env.example -f docker-compose.release.yml config`，以及 `docker run --rm -v "$PWD/deploy/nginx/infinite-canvas.conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.27-alpine nginx -t`。

Expected: Compose 只发布 `127.0.0.1:3002`，Nginx 输出 `syntax is ok` 与 `test is successful`。

### Task 2: 将管理台置于 `/admin`

**Files:**
- Modify: `legacy-admin/next.config.ts`
- Move: `legacy-admin/src/app/(admin)/admin/**` to `legacy-admin/src/app/(admin)/**`
- Modify: 管理台中指向旧 `/admin` 根路由的链接与重定向

- [ ] **Step 1: 运行当前生产构建作为基线**

Run: `cd legacy-admin && bun run build`

Expected: 当前构建成功，但不存在 `/admin` basePath。

- [ ] **Step 2: 配置 basePath 并提升管理员路由**

设置 `basePath: "/admin"`，把管理员首页改为根页面并将其跳转目标设为 `/users`；所有管理台内部管理员链接使用提升后的路径。

- [ ] **Step 3: 运行管理台生产构建**

Run: `cd legacy-admin && bun run build`

Expected: 退出码为 0，构建日志列出 `/`、`/users`、`/settings` 等管理台内部路由。

### Task 3: 更新生产部署说明

**Files:**
- Modify: `docs/content/docs/development/control-plane.mdx`
- Modify: `docs/content/docs/development/ai-upstream-update-guide.mdx`

- [ ] **Step 1: 将发布命令改为单域名变量**

将 `CONTROL_PLANE_URL`、`PUBLIC_BASE_URL` 设为 `https://image.example.com`，并把 `CORS_ALLOW_ORIGINS` 限定为这一来源。

- [ ] **Step 2: 说明单 Tunnel、3002 网关和 `/admin` 管理台**

明确 Cloudflare Tunnel 仅指向 `http://127.0.0.1:3002`，并说明 `/api` 不应附加到 `CONTROL_PLANE_URL`，否则前端会请求错误的 `/api/api/*`。

- [ ] **Step 3: 运行完整发布前验证**

Run: `docker compose -f docker-compose.release.yml config`（带所需环境变量）、`cd legacy-admin && bun run build`。

Expected: 命令均以退出码 0 完成。
