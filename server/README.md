# Go Control Plane

该服务恢复 v0.3.0 的账号、权限、积分、模型代理、系统设置、提示词、公共素材和参考媒体 API。画布项目仍保存在浏览器 IndexedDB/WebDAV，本服务尚不提供云端画布同步。

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
