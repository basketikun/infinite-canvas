# 单域名网关发布设计

## 目标

生产环境只由 Cloudflare Tunnel 访问 `http://127.0.0.1:3002`。同一域名下，画布位于 `/`，Go 控制平面位于 `/api/`，管理台入口位于 `/admin`。

## 架构

`gateway` 使用官方 Nginx Alpine 镜像并加入现有 Compose 网络。它是唯一发布宿主机端口的服务：`127.0.0.1:3002:80`。`web`、`control-plane` 与 `admin` 仅通过 Docker 内部 DNS 分别由 `web:3000`、`control-plane:8080` 与 `admin:3000` 访问。

Nginx 优先将 `/api/` 转发至 Go 服务，将 `/admin` 路径前缀保留并转发至管理台，并将其余请求转发至新版画布。Next.js 将 `/admin` 规范化为管理台入口，Nginx 不改变其尾随斜杠。

## 管理台路由

管理台设置 Next.js `basePath` 为 `/admin`。原有管理员路由从 `app/(admin)/admin/**` 调整到 `app/(admin)/**`，使管理员首页为 `/admin`，功能页为 `/admin/users`、`/admin/settings` 等，而非错误的 `/admin/admin/users`。

## 非目标

不改变 Go API 路由，不重新构建 `web` 或 `control-plane` 镜像，不配置 Cloudflare Tunnel 本身，不将供应商密钥写入前端或 Compose 文件。

## 验收

- `docker compose ... config` 解析后仅 `gateway` 发布 `127.0.0.1:3002`。
- Nginx 配置通过 `nginx -t`。
- `legacy-admin` 的生产构建通过，生成路由以 `/admin` 为基址。
- 文档说明 `CONTROL_PLANE_URL` 必须是域名根地址而非 `/api`，并给出单 Tunnel 配置。
