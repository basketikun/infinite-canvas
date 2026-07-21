# Go Control Plane

该服务恢复 v0.3.0 的账号、权限、积分、模型代理、系统设置、提示词、公共素材和参考媒体 API。默认画布继续保存在浏览器 IndexedDB/WebDAV；启用 `docker-compose.cloud-sync.yml` 后，可选用 PostgreSQL 与 MinIO/S3 同步画布项目及其引用媒体，不改变 WebDAV 的既有语义。

## 本地运行

```bash
cp server/.env.example server/.env
cd server
go test ./...
go run .
```

健康检查：

```bash
curl http://127.0.0.1:8080/api/health
```

## Docker

```bash
cp server/.env.example server/.env
docker compose -f docker-compose.control-plane.yml up --build
```

部署前必须替换 `ADMIN_PASSWORD` 和 `JWT_SECRET`，并将 `CORS_ALLOW_ORIGINS` 限制为实际画布和管理台地址。

云同步部署、生产镜像发布和双浏览器验收请参阅 `docs/content/docs/development/control-plane.mdx`。
