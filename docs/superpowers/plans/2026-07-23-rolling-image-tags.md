# 滚动镜像标签发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让集成分支每次推送都为三个应用镜像发布一致的 `latest` 标签，使服务器后续只需拉取并重建容器。

**Architecture:** 保留 `v*` 标签触发的不变发布，同时让发布工作流监听唯一的集成分支。Docker metadata-action 依照 Git ref 有条件地产生 `latest`，并始终产生完整 SHA；Compose 说明将固定 SHA 的示例改为滚动标签用法。

**Tech Stack:** GitHub Actions、docker/metadata-action@v5、GHCR、Docker Compose。

---

### Task 1: 为集成分支发布 `latest` 镜像

**Files:**
- Modify: `.github/workflows/docker-image.yml`

- [x] **Step 1: 扩展 push 触发范围**

将 workflow trigger 改为同时保留标签和单一集成分支：

```yaml
on:
  push:
    branches: ["integration/backend-control-plane"]
    tags: ["v*"]
  workflow_dispatch:
```

- [x] **Step 2: 增加条件化的滚动标签**

在 `docker/metadata-action` 的 `tags` 列表中保留现有标签和 SHA，并追加：

```yaml
type=raw,value=latest,enable=${{ github.ref == 'refs/heads/integration/backend-control-plane' }}
```

这样版本标签推送不重新标记 `latest`，只有该集成分支的普通推送会同步更新三个镜像。

- [x] **Step 3: 审核 workflow 差异**

运行：

```bash
git diff --check
git diff -- .github/workflows/docker-image.yml
```

预期：仅新增集成分支触发和条件 `latest` metadata 标签；web、admin、control-plane 矩阵不变。

- [x] **Step 4: 提交 workflow 改动**

运行：

```bash
git add .github/workflows/docker-image.yml
git commit -m "ci: publish latest images from integration branch"
```

### Task 2: 更新滚动部署说明并发布验证

**Files:**
- Modify: `docs/content/docs/development/control-plane.mdx`
- Create: `docs/superpowers/plans/2026-07-23-rolling-image-tags.md`

- [x] **Step 1: 在控制平面部署文档新增滚动更新命令**

在现有 SHA 发布说明之后增加：

````md
对于滚动部署，可将三个应用镜像固定为 `:latest`。每次 `integration/backend-control-plane` 推送成功后，服务器执行：

```bash
docker compose pull
docker compose up -d
```

回滚时将三个镜像标签改为一个已发布的 `v0.9.0-control-plane.*` 版本标签。
````

- [x] **Step 2: 提交文档与计划**

运行：

```bash
git add docs/content/docs/development/control-plane.mdx docs/superpowers/plans/2026-07-23-rolling-image-tags.md
git commit -m "docs: explain rolling image deployment"
```

- [ ] **Step 3: 推送集成分支并验证发布工作流**

运行：

```bash
git push origin integration/backend-control-plane
```

使用 GitHub Actions 运行页面或 GitHub API 确认 `Publish Control Plane Images` 成功，且三个矩阵 job 成功。该推送应产生三套 `latest` 镜像和同一 commit 的 SHA 镜像。
