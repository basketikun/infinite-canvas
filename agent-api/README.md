# Research Canvas Agent API

托管 Agent API 是多用户产品边界。它验证 Supabase JWT，并把所有 Project、Conversation、Pi Session、Skill、事件和 Canvas 工具调用绑定到 JWT 所属用户的 Project。

首期关系固定为：

```text
User 1 ── N Project
Project 1 ── 1 CanvasWorkspace
Project 1 ── N Conversation
Conversation 1 ── N AgentRun
```

不支持 Project 成员、角色、邀请或共享 Workspace。画布内容仍以浏览器本地状态为权威，服务端只保存稳定身份、revision、Agent session 和事件。

## 配置

1. 在 Supabase SQL Editor 执行 `supabase/migrations/001_agent_platform.sql`。
2. 复制 `.env.example` 并填写 Supabase、Pi provider/model、平台 API Key 和 Agent 数据目录。
3. 安装依赖后运行 `npm run dev`。

Pi provider credential 只能放在 Agent API 服务端环境中，不能使用 `VITE_` 前缀，也不能写入数据库或返回浏览器。Web 端需要配置：

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_AGENT_API_URL
```

使用仓库内 nginx 容器镜像时，同样的三个公开值在启动容器时改用 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY` 和 `AGENT_API_URL`，由 `web/docker-entrypoint.sh` 写入运行时 `config.js`。这些只是浏览器所需的 Supabase 公开配置和 API 地址，Pi provider credential 仍只能使用 Agent API 服务端的 `PI_API_KEY`。

## 安全边界

- `userId` 只来自 `auth.getUser(jwt)` 的验证结果。
- 路由中的 `projectId` 每次都通过 RLS 和 Project owner 关系验证。
- `canvasWorkspaceId` 由 Project 关系解析，客户端不能指定。
- Pi 关闭全部内置工具，只注册读取当前画布和请求用户确认后修改当前画布两个工具。
- 每个 Conversation 使用独立 `SessionManager`，session 通过 revision 比较并交换保存。
- Agent 通信协议版本与 Pi session 存储版本独立记录；未知 session 存储版本会拒绝覆盖。
- 事件流使用 `fetch` 和 `Authorization` header，JWT 不进入 URL。
- 运行失败事件只返回产品级通用文案，不持久化 provider 原始错误内容。

## 当前部署边界

Conversation session 和事件已持久化到 Postgres，可以跨实例恢复。运行中的 abort controller、在线 Canvas 快照和待确认工具调用仍在单个 Agent API 进程内；横向扩容前需要为这些瞬时状态增加粘性路由或共享事件代理。当前实现遇到运行不在本实例时会明确返回冲突，不会把 abort 或工具结果误投到其他 Project。

## 验收

`src/domain.test.ts` 覆盖 owner 隔离、Project/Workspace 唯一绑定、伪造上下文、session revision 和 Conversation 运行互斥。真实发布前还必须在配置好的 Supabase 与模型账号上完成：

```text
Browser → Agent API → Pi → Tool → Canvas → Browser
```

本仓库规则要求本次提交不代替用户执行构建和测试，因此这些用例仍需在目标环境中运行确认。
