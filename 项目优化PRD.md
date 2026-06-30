# BloomReel / Infinite Canvas 总体优化 PRD

版本：2026-06-30
范围：`web`、`canvas-agent`、`docs`、根目录部署与工程配置
状态：规划稿，用于后续分阶段优化执行

## 1. 背景

本项目是面向 AI 创作的无限画布工具，核心能力包括图片、视频、音频、文本生成，多模态素材管理，WebDAV 同步，以及本地 Canvas Agent 驱动画布操作。当前产品已经具备完整可用的创作闭环，但随着功能持续叠加，代码组织、质量门禁、存储粒度、安全边界和大画布性能开始成为后续迭代的主要约束。

本 PRD 基于四份输入形成：

1. 参考报告：`项目分析报告.md`。
2. 第一轮复核：架构与模块边界。
3. 第二轮复核：数据流、安全与持久化。
4. 第三轮复核：质量基线、执行成本与依赖状态。

## 2. 当前状态摘要

### 2.1 技术栈

- Web：Next.js 16.2.3、React 19.2.5、TypeScript、Tailwind CSS v4、Ant Design 6、Zustand、TanStack Query、localforage。
- Canvas Agent：Node.js、Express 5、Zod、MCP SDK、OpenAI Codex app-server 集成。
- Docs：Next.js 16.2.6、fumadocs。
- 部署：根目录 Dockerfile 构建 `web` 的 Next standalone 产物。

### 2.2 已校准的参考报告结论

参考报告中的大方向成立，但以下结论需要按当前代码修正：

- `web/tsconfig.json` 已开启 `strict: true`。
- 图片比例解析已包含 `Number.isFinite` 防护。
- 画布节点已经有视口裁剪，问题集中在连线仍按全量 `connections` 过滤渲染。
- 画布和素材主要使用 localforage，问题不是“完全依赖 localStorage”，而是项目列表仍整体 JSON 持久化，且 localforage 失败后会回退到 localStorage。
- TanStack Query 已用于提示词列表；AI 生成类流程属于命令式长任务，不应简单套成普通 query，但日志和任务状态可以抽象。

### 2.3 基线命令结果

在 2026-06-30 执行以下基线命令：

```powershell
cd D:\BloomReel\infinite-canvas\web
bunx tsc --noEmit
```

结果：失败，发现 17 个 TypeScript 错误，集中在画布组件、提示词 API、配置模型解析和图片 API SSE 解析。

```powershell
cd D:\BloomReel\infinite-canvas\web
bun run format:check
```

结果：失败，Prettier 报告 114 个文件格式不符合当前配置。

```powershell
cd D:\BloomReel\infinite-canvas\canvas-agent
bun run build
```

结果：失败，当前 `canvas-agent/node_modules` 不存在，脚本找不到 `tsc`。

```powershell
cd D:\BloomReel\infinite-canvas\docs
bun run types:check
```

结果：失败，当前 `docs/node_modules` 不存在，脚本找不到 `fumadocs-mdx`。

### 2.4 工作区状态

分析时仓库已有未提交改动：

```text
 M web/package.json
 M web/src/app/(user)/page.tsx
 M web/src/components/prompts/prompt-card.tsx
 M web/src/components/prompts/prompt-detail-dialog.tsx
?? 项目分析报告.md
```

后续执行优化时必须保护这些改动，不得回滚或覆盖。

## 3. 问题定义

### 3.1 P0 问题：质量门禁不可依赖

`web/next.config.ts` 中启用了 `typescript.ignoreBuildErrors: true`。这意味着生产构建和 Docker 构建可以在 TypeScript 错误存在时继续通过。当前实际运行 `bunx tsc --noEmit` 已确认存在类型错误，因此必须先建立可执行的质量基线。

影响：

- 类型回归无法阻止合入。
- 大规模重构缺少安全网。
- Docker 镜像可能包含已知类型错误。

### 3.2 P0 问题：WebDAV proxy 存在 SSRF 风险

`web/src/app/webdav-proxy/route.ts` 接收 `x-webdav-target` 并转发请求，只限制 `http` 和 `https` 协议，未限制私网、localhost、link-local、metadata 地址，也没有目标 allowlist。若该应用部署在可访问内网资源的服务端环境，存在 SSRF 风险。

影响：

- 可能访问部署环境内网服务。
- 可能探测云 metadata 地址。
- 日志中打印完整 URL，可能暴露敏感路径。

### 3.3 P1 问题：核心画布页面承担过多职责

`web/src/app/(user)/canvas/[id]/canvas-client-page.tsx` 接近 3000 行，包含项目装载、持久化、历史、选择框、拖拽、连线、生成任务、重试、资源引用、弹窗、Agent 面板等职责。

影响：

- 功能修改容易引发交叉回归。
- 生成逻辑与画布状态耦合，难以单测。
- Agent 工具操作和手动 UI 操作共享规则，但校验分散。

### 3.4 P1 问题：项目持久化粒度偏粗

`use-canvas-store.ts` 将所有 `projects` 存为一个数组，再整体 JSON 序列化。每次更新当前项目时，都会创建新的项目数组并排队持久化整个状态。

影响：

- 项目数量和节点数量增加后，保存成本随全量数据增长。
- 多项目 WebDAV 合并和本地写入难以增量化。
- 大画布下 UI 线程可能被 JSON 序列化和反序列化影响。

### 3.5 P1 问题：安全敏感配置混在普通持久化配置中

`use-config-store.ts` 持久化 AI API Key、WebDAV 用户名、WebDAV 密码和渠道配置。Canvas Agent token 也保存在 localStorage。

影响：

- 共享设备或导出浏览器数据时存在泄露风险。
- 缺少一键清理敏感信息。
- 缺少“会话保存”和“持久保存”的明确选择。

### 3.6 P2 问题：图片/视频工作台重复实现

`web/src/app/(user)/image/page.tsx` 和 `web/src/app/(user)/video/page.tsx` 都维护日志、素材插入、保存资产、重试、结果预览、localforage 存储等逻辑。

影响：

- 生成取消、日志同步、资产保存等能力需要重复修。
- 新增音频或文本工作台时重复成本高。
- WebDAV 同步日志时依赖页面内部数据结构，演进困难。

### 3.7 P2 问题：API 错误处理和请求基础设施重复

`image.ts`、`audio.ts`、`video.ts` 各自实现 axios 错误解析，错误文案和取消处理不完全一致。`request.ts` 目前只提供参数序列化，未承担共享请求基础能力。

影响：

- 用户看到的错误文案不一致。
- 取消请求、状态码、服务端 envelope 解析重复。
- 后续添加 provider 时容易复制旧问题。

### 3.8 P2 问题：Canvas Agent 本地安全和可控性仍需增强

Canvas Agent 绑定 `127.0.0.1`，基础边界合理，但仍存在优化空间：

- 启动日志打印完整 Connect token。
- 前端使用 query token 建立 SSE 和调用部分接口。
- Express JSON limit 为 30MB，缺少更细的 attachment 限制。
- Codex turn 目前队列化执行，但 HTTP 层缺少取消运行中 turn 的明确接口。

### 3.9 P3 问题：提示词 API 可观测性不足

`web/src/app/api/prompts/route.ts` 聚合多个 GitHub 原始资源，单个源失败时吞掉错误并返回空数组。`Prompt.coverUrl` 类型是必填 string，但源数据可能为空。

影响：

- 上游源失效时难以定位。
- UI 需要反复处理空字符串图片地址。
- 缓存和失败状态不可见。

## 4. 产品目标

### 4.1 总目标

在不改变核心用户体验的前提下，将项目优化为可持续迭代、可验证、可安全部署、可承载大画布数据的工程结构。

### 4.2 用户价值

- 创作者：大画布和多媒体项目更稳定，减少生成中断和数据丢失。
- 高级用户：本地 Agent 更可控，敏感配置更清晰。
- 后续开发者：模块边界清晰，能小步修改并用测试验证。
- 部署者：服务端 proxy 和构建产物更安全可靠。

### 4.3 非目标

- 不重做视觉风格。
- 不更换 Next.js、React、Ant Design、Zustand 等主要技术栈。
- 不重写 AI provider 适配层，只整理公共能力和错误处理。
- 不在第一阶段引入服务端数据库。
- 不破坏已有本地数据；如果涉及存储迁移，必须提供自动迁移和回滚说明。

## 5. 成功指标

### 5.1 工程质量指标

- `web` 新增 `typecheck` 脚本并通过。
- `web/next.config.ts` 关闭 `typescript.ignoreBuildErrors` 或仅在明确的临时开关下使用。
- `web` 至少覆盖 30 个核心单元测试用例，优先覆盖纯函数和数据迁移。
- `canvas-agent` 在安装依赖后 `bun run build` 通过。
- `docs` 在安装依赖后 `bun run types:check` 通过。
- CI 至少执行 `web typecheck`、`web test`、`canvas-agent build`。

### 5.2 性能指标

- 500 节点、800 连线画布下，基础拖拽和缩放无明显卡顿。
- 1000 节点基准页面可打开，节点裁剪和连线裁剪启用。
- 当前项目保存采用项目级分片，更新一个项目时不重写所有项目主体数据。
- 大媒体 Blob 不回退写入 localStorage。

### 5.3 安全指标

- WebDAV proxy 拒绝 localhost、私网、link-local、metadata IP 和非 http/https 协议。
- WebDAV proxy 日志不打印完整认证信息或敏感 query。
- AI API Key、WebDAV 密码、Agent token 有明确清理入口。
- Canvas Agent 默认不打印完整 token，提供手动显示或复制方式。

### 5.4 体验指标

- 生成取消在画布、图片工作台、视频工作台中行为一致。
- 图片/视频工作台日志结构统一，WebDAV 同步不依赖页面内部实现。
- 提示词卡片不再传入空字符串图片地址。

## 6. 优化方案总览

### 阶段 A：保护网和质量门禁

目标：让后续改动可以被验证。

工作项：

- 新增 `web` 的 `typecheck`、`test` 脚本。
- 引入 Vitest，先覆盖无 DOM 或轻 DOM 的纯函数。
- 修复现有 TypeScript 错误。
- 明确格式化策略，避免一次性格式化 114 个文件造成审查噪音。
- canvas-agent/docs 标记依赖安装前置条件。

### 阶段 B：安全基线

目标：先处理部署风险和敏感配置。

工作项：

- WebDAV proxy 增加 SSRF 防护。
- WebDAV proxy 日志脱敏。
- 配置存储拆出敏感字段或提供安全保存模式。
- Canvas Agent token 展示和存储加固。

### 阶段 C：API 基础设施和工作台复用

目标：减少重复请求和日志实现。

工作项：

- 抽 `api-error` 和 provider 请求基础能力。
- 抽图片/视频工作台日志仓储。
- 为图片生成和视频轮询补取消能力。
- 提示词 API 调整 `coverUrl` 类型和错误可观测性。

### 阶段 D：画布核心模块化

目标：将核心页面拆成可测试的领域模块。

工作项：

- 抽历史栈、项目状态、视口保存、选择拖拽、生成执行、资源引用、Agent bridge。
- 将 `buildGenerationConfig`、重试源查找、资源引用规则等纯函数移出页面并测试。
- 保持 UI 行为一致，每次只移动一个职责。

### 阶段 E：存储分片和大画布性能

目标：让多项目和大画布可持续扩展。

工作项：

- 项目存储改成 `project_index` 和 `project:<id>` 分片。
- 编写旧存储迁移。
- 连线渲染按可见节点裁剪。
- 建立 100、500、1000 节点性能基准。

### 阶段 F：文档和交付闭环

目标：让优化结果可维护。

工作项：

- 更新 README、SECURITY、docs 中的配置和安全说明。
- 补充本地 Agent 使用、token、安全边界、WebDAV proxy 部署建议。
- 建立后续版本的检查清单。

## 7. 需求明细

### 7.1 质量门禁需求

- `web/package.json` 必须提供：
  - `typecheck`
  - `test`
  - `test:run`
  - `format:check`
- `next.config.ts` 不允许长期保留 `ignoreBuildErrors: true`。
- 类型错误清零前，不允许进行大规模画布拆分。
- Prettier 格式化改动应单独成批，避免和业务重构混合。

### 7.2 安全需求

- WebDAV proxy 仅允许公网 http/https 目标，默认拒绝：
  - `localhost`
  - `127.0.0.0/8`
  - `::1`
  - `10.0.0.0/8`
  - `172.16.0.0/12`
  - `192.168.0.0/16`
  - `169.254.0.0/16`
  - `100.64.0.0/10`
  - `fc00::/7`
  - `fe80::/10`
  - `169.254.169.254`
- WebDAV proxy 应限制允许的方法为 `GET`、`HEAD`、`PUT`、`PROPFIND`、`MKCOL`。
- 日志必须脱敏 query 和认证相关 header。
- 前端应提供清理 AI Key、WebDAV 密码、Agent token 的入口。

### 7.3 存储需求

- 新增项目存储版本号。
- 旧的 `infinite-canvas:canvas_store` 能迁移到新结构。
- 新结构至少包含：
  - `infinite-canvas:canvas_project_index`
  - `infinite-canvas:canvas_project:<id>`
- 删除项目时同步清理项目主体。
- WebDAV 同步继续兼容当前 manifest 格式，迁移完成后再规划 manifest v2。

### 7.4 画布模块化需求

- `canvas-client-page.tsx` 保留页面组合职责。
- 历史、生成、选择、视口、资源引用、Agent 交互应进入 hooks 或 utils。
- 生成逻辑的配置构建必须可单测。
- Agent ops 和 UI 操作共享的节点/连线规则应逐步统一。

### 7.5 工作台需求

- 图片工作台支持取消正在执行的批量生成。
- 视频工作台支持取消当前轮询，不把用户取消记录为普通失败。
- 图片/视频日志仓储使用统一接口。
- 删除日志时同步清理对应媒体 Blob。

### 7.6 Agent 需求

- 默认启动日志不打印完整 token。
- 提供 token rotation 或重新生成配置方式。
- 限制 attachment 总大小和单文件大小。
- 提供取消 Codex turn 的 HTTP 能力，若底层不支持硬取消，则至少支持前端标记取消并停止后续状态写入。

## 8. 验收计划

### 8.1 每个 PR 的最低验收

```powershell
cd D:\BloomReel\infinite-canvas\web
bun run typecheck
bun run test:run
```

如果 PR 触及格式化范围：

```powershell
cd D:\BloomReel\infinite-canvas\web
bun run format:check
```

如果 PR 触及 Canvas Agent：

```powershell
cd D:\BloomReel\infinite-canvas\canvas-agent
bun install --frozen-lockfile
bun run build
```

如果 PR 触及 docs：

```powershell
cd D:\BloomReel\infinite-canvas\docs
bun install --frozen-lockfile
bun run types:check
```

### 8.2 手动回归清单

- 新建画布。
- 添加文本节点、图片节点、配置节点。
- 连接节点并触发生图。
- 停止生成。
- 撤销和重做。
- 导入素材到画布。
- 保存资产。
- 打开图片工作台生成并保存日志。
- 打开视频工作台创建任务并恢复轮询。
- WebDAV direct 模式测试连接。
- WebDAV nextjs proxy 模式测试连接。
- 本地 Canvas Agent 连接、读取画布、创建节点、执行需要确认的工具调用。

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 先格式化全仓导致审查困难 | 难以看清业务变更 | 格式化单独提交，业务 PR 避免混入格式化 |
| 关闭 `ignoreBuildErrors` 后构建失败 | 阻塞部署 | 先修现有 TS 错误，再关闭 |
| 存储迁移破坏用户本地数据 | 数据丢失 | 保留旧 key，迁移后校验数量，提供回滚读取路径 |
| 拆画布页面引入行为回归 | 核心体验受损 | 每次只抽一个职责，先测纯函数，再手动 smoke |
| SSRF 防护误伤内网 WebDAV | 用户无法同步局域网 NAS | 默认安全，允许本地开发通过显式配置或 direct 模式处理 |
| Agent token 加固影响连接便利性 | 用户配置成本增加 | 保留自动发现，但默认只显示 token 摘要 |

## 10. 优先级排序

1. P0：修复 TypeScript 基线，新增 `typecheck` 脚本。
2. P0：WebDAV proxy SSRF 防护。
3. P0：关闭或约束 `ignoreBuildErrors`。
4. P1：API 错误处理统一。
5. P1：画布核心纯函数测试和首轮拆分。
6. P1：项目存储分片设计和迁移。
7. P2：图片/视频工作台日志与取消能力。
8. P2：Canvas Agent token 和 attachment 加固。
9. P3：提示词 API 可观测性。
10. P3：docs 和部署说明完善。

## 11. 后续执行入口

具体任务拆解见：`优化子任务集.md`。
