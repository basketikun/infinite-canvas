# Pi SDK 迁移：单用户独立 Project 与 Canvas Workspace

状态：首期代码路径与自动化验收入口已落地，等待目标 Supabase、真实模型和浏览器环境执行发布 Gate。

## 目标模型

```text
User
  └── Project 1
        ├── CanvasWorkspace（唯一）
        ├── Conversations（多个）
        ├── Project Skills
        └── Agent Runtime
  └── Project 2
        └── 另一套完全独立的数据
```

系统服务多个用户，但一个 Project 只有一个 owner，并且强制对应一个 Canvas Workspace。首期不支持成员、角色、邀请、共享、协同编辑或跨用户 Memory。

固定 invariant：

```text
Project.ownerUserId = authenticatedUser.id
CanvasWorkspace.projectId = Project.id，并且 projectId UNIQUE
Conversation.ownerUserId = authenticatedUser.id
Conversation.projectId = Project.id
```

## 已实现架构

```text
Web (Supabase Auth)
  │ Authorization: Bearer <JWT>
  ▼
agent-api/
  ├── ProjectModule / ConversationModule
  ├── SupabaseResearchStore + RLS
  ├── RuntimeManager
  ├── PiRuntimeAdapter
  ├── EventHub (fetch streaming)
  └── CanvasBridge
        │
        └── 当前 Project 唯一的浏览器 Canvas

canvas-agent/
  └── 旧本地 Codex/MCP 链路，迁移期保留作灰度回退
```

主要边界：

- `userId` 只来自已验证的 Supabase JWT。
- `projectId` 来自路由，但每次都先查询 owner。
- `canvasWorkspaceId` 由 Project 关系解析，浏览器不能自由指定。
- 一个 Pi `AgentSession` 对应一个 Conversation。
- Web 只消费产品 `RuntimeEvent`，不导入 Pi SDK 类型。
- Pi provider credential 只存在 Agent API 服务端。
- provider 原始错误不写入持久化事件，浏览器只收到产品级失败状态。
- Pi 禁用 shell、文件系统和全部内置工具，只注册产品白名单工具。

## 数据与 RLS

`agent-api/supabase/migrations/001_agent_platform.sql` 定义 Projects、唯一 Canvas Workspaces、Conversations、Agent Runs、持久化 Agent Events 和 Project Skills。创建 Project 通过数据库函数在同一事务中创建唯一 Canvas Workspace。所有表均启用 RLS，并通过 Project owner 关系约束 `auth.uid()`。

`agent_runs` 的部分唯一索引保证每个 Conversation 只有一个 active run。Conversation 保存 Pi session header、entries 和 revision，并通过 revision 比较交换避免覆盖并发历史。

## Runtime 与事件

产品接口只管理运行，不复制 Codex 的 thread 生命周期：

```ts
interface AgentRuntime {
  runTurn(store, ctx, input): Promise<{ runId: string }>;
  abort(store, ctx, conversationId, runId): Promise<void>;
}
```

Conversation 生命周期由产品模块负责。Pi 原生事件转换为 `run.*`、`assistant.*`、`tool.*` 和 `canvas.tool.requested`。所有事件带 `projectId`、`canvasWorkspaceId`、`conversationId`、`threadId`、`turnId`、`itemId` 和 `runId`；兼容期 `threadId = conversationId`。

事件流通过带 Authorization header 的 `fetch` 建立，JWT 不进入 URL，并通过持久化 sequence 恢复。

## Canvas、Tools、Skills 与 Memory

画布内容仍以浏览器本地状态为权威。本地 Canvas Project 记录 `localOwnerUserId`，登录后只展示当前用户的数据；Web 同时持久化服务端 `agentProjectId`、`agentCanvasWorkspaceId`、owner 和 revision，不同登录用户不会复用同一个服务端绑定。

WebDAV 路径按 `users/<userId>/...` 分区，Canvas 同步只收集当前 owner 的 Project，合并返回本地时保留其他 owner 的本地状态但不会上传到当前用户的远端目录。

首批工具：

1. `canvas_read_snapshot`：只读当前 Project 闭包绑定的在线画布快照。
2. `canvas_apply_operations`：发送 `canvas.tool.requested`，等待浏览器用户确认后执行并回传结果。

模型看不到 user/project/workspace 参数。Skill 存在 `project_skills`，只把当前 Project 已启用的定义注入当前 Session。Memory 只保留类型约束：

```ts
type MemoryScope = "user_project_private";
```

本期没有 Memory 存储、检索、工具或自动注入。

## Web 切换

配置 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY` 和 `VITE_AGENT_API_URL` 后：

- 右上角提供 Supabase 账号密码登录和退出。
- 登录交互使用账号+密码，内置 `test / 12345678` 测试用户由 Agent API 通过仅服务端可见的 Supabase Secret Key 幂等创建。
- 登录用户打开本地 Canvas Project 时，前端创建并绑定其独立服务端 Project/Workspace。
- Agent 面板默认使用 Pi 托管链路，并可显式切回本地 Codex。
- Pi 面板支持 Project 私有 Conversation、流式回复、停止和画布写工具确认。
- Pi 面板先读取持久化 Conversation 快照，再按 sequence 接续实时事件；历史已物化事件不会重复合并。
- Pi 面板支持归档 Conversation，以及创建、编辑、启停和删除当前 Project 私有 Skill。

## 部署与自动化验收

- `agent-api/Dockerfile` 与 `docker-compose.local.yml` 提供 Web + Agent API 的本地容器闭环。
- `RUN_SUPABASE_RLS_TESTS=1 npm test` 验证真实 Supabase 中的跨用户/跨 Project 隔离、唯一 Workspace 和客户端不可绕过的写权限。
- `AGENT_API_URL=http://localhost:4100 npm run acceptance:live` 使用内置 test 账号驱动真实 Pi，并模拟浏览器确认工具结果，验证 streaming、session、read/write Canvas tools、事件 sequence、abort 与凭据不进入持久化产品数据。
- 两类外部验收都必须显式启用；缺少 Supabase 或模型凭据时不会用 fake 结果代替通过状态。

## 待在目标环境执行的发布 Gate

- 在目标 Supabase 实例执行 migration 并运行真实 RLS 集成测试。
- 使用真实平台模型凭据验证 Pi provider、流式事件、abort、session 恢复和两个工具。
- 在浏览器中验证 SSE 断线恢复与历史物化不会重复展示同一 turn。
- 验证凭据不出现在浏览器、日志、事件或数据库。
- 完成真实 `Browser → Agent API → Pi → Tool → Canvas → Browser` 验收。
- 横向扩容前，为运行中的 abort、在线 Canvas 快照和待确认工具调用增加粘性路由或共享事件代理。
- 只有以上 Gate 通过后，才能删除 Codex app-server、Codex 协议和 MCP 回环。

## 验收矩阵

- Alice 无法列出、读取、运行或删除 Bob 的 Project。
- 同一用户 Project A/B 的 Workspace、Conversation、Skill 和 Pi session 不同。
- 伪造 user、workspace 或其他 Project 的 Conversation 被拒绝。
- 创建 Project 恰好创建一个 Workspace，重复关系被唯一约束阻止。
- Project A 的工具请求不能送达 Project B 的浏览器连接。
- 同一 Conversation 并发 turn 冲突，不同 Conversation 可并行。
- abort 后同一 run 不再发送 completed 或 failed。
- 平台 Pi credential 不进入任何浏览器可见或持久化产品数据。
