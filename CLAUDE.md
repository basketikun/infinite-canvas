# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

无限画布 (infinite-canvas) — 一个面向图片创作的开源工作台。Go + Gin + GORM 后端，Next.js (App Router) + React + Zustand 前端。**面向中文用户，UI 文案保持中文。**

详细 AI/自动化开发约束见 [AGENTS.md](AGENTS.md)（必读，比本文件更具体）。

## 常用命令

### 后端 (Go)

```bash
go run .                  # 启动后端，默认监听 :8080
go build -o server .      # 构建二进制
go test ./...             # 当前无测试用例，命令仅供参考
```

后端入口 [main.go](main.go) 会按顺序：`config.Load()` → `service.EnsureDefaultAdmin()` → `router.New().Run(":" + Cfg.Port)`。

### 前端 (Next.js, in `web/`)

```bash
cd web
bun install               # 使用 bun，存在 bun.lock
bun run dev               # 开发模式，0.0.0.0:3000，webpack
bun run build             # 生产构建
bun run start             # 生产启动
```

前端通过 `next.config.ts` 的 `rewrites` 把 `/api/:path*` 代理到 `API_BASE_URL`（默认 `http://127.0.0.1:8080`）。本地开发：先 `go run .` 起后端，再 `cd web && bun run dev`。

### Docker

```bash
docker compose up -d                                     # 拉取 ghcr 镜像
docker compose -f docker-compose.local.yml up -d --build # 本地源码构建
```

镜像内部 Go API 监听 `:8080`，Next.js 监听 `:3000` 并代理 `/api/*`；只对外暴露 `3000`。

### 配置

复制 `.env.example` 到 `.env`。关键变量：`ADMIN_USERNAME`/`ADMIN_PASSWORD`（首次启动创建管理员）、`JWT_SECRET`、`PORT`、`STORAGE_DRIVER`（`sqlite` / `mysql` / `postgres`）、`DATABASE_DSN`、`API_BASE_URL`（前端开发时指向不同后端端口）。

## 架构总览

### 后端分层（严格遵守）

```
handler/      仅处理 HTTP 入参 → 调 service → 返回 OK/Fail（见 handler/response.go）
service/      业务逻辑、默认值、校验、时间/ID、鉴权
repository/   仅做数据库访问和 GORM 查询
model/        数据结构、枚举、简单模型方法
middleware/   AdminAuth、OptionalAuth、NotFoundJSON
router/       唯一路由出口 router.New()
config/       env + godotenv 加载
```

所有业务接口走 `/api/*`，统一响应 `{ code, data, msg }`（`code:0` 成功）。**前端按 `code` 而不是 HTTP status 判断业务结果。** 见 [docs/api-response.md](docs/api-response.md)。

列表接口沿用 `model.Query` + `Normalize` + 标签筛选 + 分页约定（参考 `handler/prompts.go`、`handler/assets.go`）。

数据库使用 GORM `AutoMigrate`，启动时自动维护表结构。当前项目处于开发期，**不写旧字段兼容、不写数据迁移兜底**；改表结构直接按新设计修改。新增表需同步更新 [docs/backend-database.md](docs/backend-database.md)。

### 前端结构

```
web/src/
  app/
    (user)/      普通用户路由：canvas、assets、asset-library、prompts、image、login
    (admin)/     管理后台：admin/{users,prompts,assets,prompt-categories}
  components/    跨页面共享组件 + ui/（shadcn）
  services/api/  所有后端 API 请求统一收口
  stores/        Zustand 全局 store（ai-config、asset、theme、user、config-dialog）
  lib/           工具函数：canvas-theme、id、image-utils、localforage-storage、ai-config
```

画布页面位于 `app/(user)/canvas/`，**画布相关状态和组件都收敛在该目录内部**（`stores/use-canvas-store.ts`、`components/`、`utils/`、`constants.ts`、`types.ts`）。不要把画布状态抽到全局 `stores/`。

### 关键边界：图片与业务数据的本地存储

画布项目、我的素材、AI Key 当前**都保存在浏览器本地**，未做服务端同步——文档里不要误写成已支持云同步。

- 业务列表/JSON / 大对象 / 图片 Blob → **`localforage`**（见 `lib/localforage-storage.ts`、`services/image-storage.ts`）
  - 画布项目: db=`infinite-canvas` store=`app_state` key=`infinite-canvas:canvas_store`
  - 我的素材: 同 db/store, key=`infinite-canvas:asset_store`
  - 图片 Blob: db=`infinite-canvas` store=`image_files`
- 极小简单配置 → `localStorage`
- 画布 JSON 不存大体积 base64，节点只保存 `storageKey` + 元信息，Blob 经 `storageKey` 取回

图片节点结构和兼容边界详见 [docs/canvas-data-structure.md](docs/canvas-data-structure.md)。

### AI 调用模型

**前端直接** 请求 OpenAI 兼容接口（`/v1/images/generations`、`/v1/images/edits`、`/v1/chat/completions`、`/v1/models`），Base URL / API Key / 默认模型由用户在浏览器本地配置（`use-ai-config-store.ts`）。后端不代理这些请求。涉及安全说明时要写清这一点。

## 画布 UI 约束

新增 canvas 组件时**必须**使用 `canvasThemes`、`useThemeStore` 或 Ant Design `ConfigProvider` token；禁止硬编码黑白/stone/slate 颜色（会破坏浅色/深色主题切换）。复用已有工具栏、节点面板、Modal 的视觉风格。图片节点尺寸默认保持原始比例（`freeResize` 切换才放开）。

管理后台主题统一在 `AntThemeProvider` 或全局 CSS 配置，**页面私有组件不要写 `dark ? ...` 主题分支**。

## 文档流程（与代码改动配套）

- 新功能/调整/修复 → 写到根目录 [CHANGELOG.md](CHANGELOG.md) 的 `Unreleased` 节
- 新待办 → [docs/todo.md](docs/todo.md)
- 已实现待用户验证 → [docs/pending-test.md](docs/pending-test.md)（**不要**直接进 `features.md`）
- 用户确认通过后 → 从 `pending-test.md` 迁到 [docs/features.md](docs/features.md)
- 每次任务完成前都要回查 `todo.md` / `pending-test.md` 是否需要同步
- 新增数据表 → 同步 [docs/backend-database.md](docs/backend-database.md)
- 文档**不要**写日期，除非用户明确要求

## 开发风格强约束（来自 AGENTS.md）

- 先读现有代码，沿用既有结构和写法；不顺手重构无关文件
- 项目未上线，**不写旧数据兼容、不写迁移兜底**
- 不为"兼容更多场景"加分支；只实现当前明确需要的功能
- 写完代码**不要**自己跑构建/检查语法，用户会自己验
- 工作区已有用户改动时不回滚、不覆盖，只在必要范围追加
- 页面内只有一个主业务组件时直接写在 `page.tsx`，不要拆 `XxxManager` 再透传一堆 props
- 管理后台页面私有组件放各自页面目录的 `components/`，不要塞到 `admin/components/` 共享目录
- UI 图标优先 `lucide-react` 或已用的 Ant Design 图标
