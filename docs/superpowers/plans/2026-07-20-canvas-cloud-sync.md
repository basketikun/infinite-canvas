# 画布云同步独立项目实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development.

**Goal:** 为登录用户提供跨设备画布与媒体同步，不改变现有 WebDAV 同步语义，也不在恢复旧后端阶段引入多人协作。

**Architecture:** 在 `server/` 增加独立 `sync` 域，PostgreSQL 保存项目元数据、版本号与权限，MinIO/S3 保存媒体 blob；前端通过 `web/src/services/cloud-sync/` 显式选择同步目标。首次仅支持“最后写入前必须匹配版本号”的单用户同步，冲突由用户选择本地或远端副本。

### Task 1: 数据模型和 API

**Files:** Create `server/model/{canvas_project,canvas_revision,media_object}.go`, `server/repository/canvas.go`, `server/handler/canvas_sync.go`, `server/service/canvas_sync.go`, tests; modify router and migration.

- [ ] 先写 repository 测试：同一项目使用过期 `revision` 写入必须返回冲突，正确 revision 写入后加一。
- [ ] 定义 `canvas_projects(user_id,id,title,current_revision,created_at,updated_at)`、`canvas_revisions(project_id,revision,payload,created_at)`、`media_objects(user_id,key,sha256,bytes,mime_type)`；所有查询必须按 `user_id` 限制。
- [ ] 提供 `GET/PUT /api/v1/canvas/projects/:id`、项目列表、媒体上传/下载 API；PUT 使用 `If-Match` revision，冲突返回 409 和当前 revision。
- [ ] 使用 PostgreSQL 集成测试与 MinIO 测试容器；SQLite 不作为云同步生产存储。

### Task 2: 前端同步适配

**Files:** Create `web/src/services/cloud-sync/**`, `web/src/stores/use-cloud-sync-store.ts`, tests; modify canvas store and config UI.

- [ ] 抽取现有项目序列化为纯函数，测试导入/导出后节点、连线、聊天会话不丢失。
- [ ] 增加“关闭 / WebDAV / 云同步”三态配置；只有登录服务端模式后允许云同步。
- [ ] 上传先创建不可变 revision，再并发传媒体；下载先校验 manifest 和 SHA-256，再写 IndexedDB。
- [ ] 409 时显示本地、远端、另存副本三种明确操作，绝不静默覆盖。

### Task 3: 部署与验收

**Files:** Modify Compose, server env docs, release docs.

- [ ] Compose 增加 PostgreSQL 与 MinIO，所有 bucket 和数据库凭据仅在服务器环境变量中。
- [ ] 测试两台浏览器同账号创建、同步、冲突和媒体恢复；确认 WebDAV 用户不受影响。
- [ ] 提交后作为独立可选版本发布，不与前 3 个计划绑定。
