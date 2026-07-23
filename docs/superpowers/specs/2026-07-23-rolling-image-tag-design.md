# 滚动镜像标签发布设计

## 目标

部署服务器首次改为引用三个应用镜像的 `latest` 标签后，后续每次向 `integration/backend-control-plane` 推送已验证变更，管理员只需执行 `docker compose pull` 和 `docker compose up -d`，无需再编辑 Compose 文件中的镜像 SHA。

## 发布规则

镜像工作流继续在 `v*` 标签推送时发布不可变的版本标签和完整 Git SHA，作为可审计、可回滚的版本来源。

同一工作流新增对 `integration/backend-control-plane` 分支推送的触发。此触发为 web、admin 和 control-plane 三个 GHCR 镜像同时附加 `latest` 标签，也继续发布完整 Git SHA。三个服务由同一次 commit 构建，避免滚动部署时混用不同提交的镜像。

手动工作流调度不自动覆盖 `latest`，除非明确从集成分支调度；这避免意外将任意分支的镜像作为滚动部署版本。

## 服务器一次性迁移

用户服务器现有 Compose 中三个固定 SHA 镜像替换为对应 `:latest`。Nginx gateway、卷挂载、容器名称、`PUBLIC_BASE_URL` 和 Cloudflare Tunnel 不变。

之后更新命令固定为：

```bash
docker compose pull
docker compose up -d
```

如需回滚，将三个镜像临时固定为某个已发布的 `v0.9.0-control-plane.*` 标签，再执行相同命令；本设计不删除版本标签。

## 非目标

- 不在服务器上构建源码。
- 不把发布流程与独立 CI 工作流合并或复制其测试步骤。
- 不修改 Docker Compose 中的网关路由和控制平面配置。

## 验收

- workflow YAML 可被 GitHub Actions 解析，且集成分支推送会触发镜像发布。
- 在集成分支运行时，metadata 输出包含 `latest` 和完整 Git SHA。
- 在版本标签运行时，metadata 输出包含版本标签和完整 Git SHA。
- 服务器只需一次替换镜像标签，后续更新不再修改 Compose。
