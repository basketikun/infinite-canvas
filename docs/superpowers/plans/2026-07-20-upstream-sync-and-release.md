# 上游同步与发布维护计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development.

**Goal:** 让 fork 能持续合并 upstream，同时自动验证画布、控制平面和管理台互不破坏。

**Architecture:** `upstream/main` 只读；`integration/backend-control-plane` 承载自定义模块；每次同步由临时 `sync/upstream-<date>` 分支完成。CI 分别构建 `web/`、`server/`、`legacy-admin/` 和 Compose，不允许上游变更直接覆盖适配层。

### Task 1: 固化分支与同步脚本

**Files:** Create `scripts/sync-upstream.sh`, `docs/content/docs/development/upstream-sync.mdx`.

- [ ] 脚本执行 `git fetch upstream --tags`、从集成分支创建 `sync/upstream-$(date +%F)`、合并 `upstream/main`；不得向 upstream push。
- [ ] 合并前检查工作区干净，失败时退出；成功后打印需要运行的验证命令。
- [ ] 文档规定只在同步分支解决冲突，冲突优先保留 `server/`、`legacy-admin/` 与 `services/control-plane/`，其余采用 upstream。
- [ ] 用临时测试仓库验证脚本不修改 `main`，提交 `chore: add upstream sync workflow`。

### Task 2: CI 与发布门禁

**Files:** Create `.github/workflows/control-plane.yml`, `.github/workflows/legacy-admin.yml`, `.github/workflows/integration.yml`.

- [ ] `control-plane.yml` 运行 `cd server && go test ./...` 和 Docker build。
- [ ] `legacy-admin.yml`、`integration.yml` 分别运行 Bun frozen install、typecheck、build；集成工作流额外运行 `docker compose config`。
- [ ] 所有工作流在 pull request 与 `integration/**` 分支触发；任何失败阻止合并和镜像发布。
- [ ] 提交 `ci: verify control plane integration`。

### Task 3: 部署、版本与回滚

**Files:** Modify `CHANGELOG.md`, deployment docs, image workflows.

- [ ] 为 web、server、admin 各自产生同一 Git SHA 标签镜像；Compose 引用明确版本，不使用 `latest`。
- [ ] 发布前执行数据库备份、`docker compose pull`、健康检查；回滚使用前一 SHA 的 Compose 文件，不执行破坏性 schema downgrade。
- [ ] 为每次 upstream 同步记录冲突文件、测试结果和镜像 SHA，提交发布记录。
