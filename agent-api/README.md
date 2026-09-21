# Research Canvas Agent API

托管 Agent API 是多用户产品边界。它验证 Supabase JWT，并把所有 Project、Conversation、Pi Session、Skill、事件和 Canvas 工具调用绑定到 JWT 所属用户的 Project。

首期关系固定为：

```text
User 1 ── N Project
Project 1 ── 1 CanvasWorkspace
Project 1 ── N Conversation
Conversation 1 ── 1 Codex Thread（仅 AGENT_RUNTIME=codex）
Conversation 1 ── N AgentRun
```

不支持 Project 成员、角色、邀请或共享 Workspace。运行时编辑真值仍在浏览器；服务端保存 Canvas snapshot 用于恢复。`agent-api` 是浏览器唯一 Gateway，浏览器不直连 Codex。

默认运行时仍是 Pi。切换托管 Codex 时设置 `AGENT_RUNTIME=codex`，并执行 `supabase/migrations/002_codex_runtime.sql`。

## 配置

1. 在 Supabase SQL Editor 执行 `supabase/migrations/001_agent_platform.sql`。
2. 复制 `.env.example` 并填写 Supabase publishable key、仅服务端可见的 Secret Key、Pi provider/model、平台 API Key 和 Agent 数据目录。
3. 安装依赖后运行 `npm run dev`。

Codex 模式额外需要服务器安装 Codex CLI，并设置：

```text
AGENT_RUNTIME=codex
CODEX_API_KEY 或 OPENAI_API_KEY
AGENT_RUNTIME_ROOT
AGENT_RUNTIME_TOKEN_SECRET
```

这些是平台基础设施凭据，不能使用 `VITE_` 前缀，不能写入用户目录或返回浏览器。每个 `User × Project` 会在 `AGENT_RUNTIME_ROOT/users/<userId>/projects/<projectKey>/` 下建立互相隔离的 `workspace/` 与 `codex-home/`。

Agent API 启动时会幂等创建并确认内置测试用户：账号 `test`，密码 `12345678`（Supabase 内部邮箱为 `test@research-canvas.test`）。`SUPABASE_SECRET_KEY` 只用于这个服务端初始化动作，不会写入浏览器运行时配置。

Pi provider credential 只能放在 Agent API 服务端环境中，不能使用 `VITE_` 前缀，也不能写入数据库或返回浏览器。Web 端需要配置：

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_AGENT_API_URL
```

使用仓库内 nginx 容器镜像时，同样的三个公开值在启动容器时改用 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY` 和 `AGENT_API_URL`，由 `web/docker-entrypoint.sh` 写入运行时 `config.js`。这些只是浏览器所需的 Supabase 公开配置和 API 地址，Pi provider credential 仍只能使用 Agent API 服务端的 `PI_API_KEY`。

本地容器闭环：复制 `agent-api/.env.example` 为 `agent-api/.env`，在当前 Shell 设置 Web 需要的 `SUPABASE_URL` 和 `SUPABASE_PUBLISHABLE_KEY`，然后使用 `docker compose -f docker-compose.local.yml up --build`。Web 默认连接宿主机 `http://localhost:4100`，Pi 数据目录使用独立 volume。

## 安全边界

- `userId` 只来自 `auth.getUser(jwt)` 的验证结果。
- 路由中的 `projectId` 每次都通过 RLS 和 Project owner 关系验证。
- `canvasWorkspaceId` 由 Project 关系解析，客户端不能指定。
- Pi 关闭全部内置工具，只注册读取当前画布和请求用户确认后修改当前画布两个工具。
- Codex 适配器为每个 Project 启动隔离的 app-server；画布 MCP 使用 ephemeral runtime token 调用仅本机可访问的回环接口，工具参数不含 Project ID。
- 每个 Conversation 使用独立 `SessionManager`，session 通过 revision 比较并交换保存。
- Agent 通信协议版本与 Pi session 存储版本独立记录；未知 session 存储版本会拒绝覆盖。
- 事件流使用 `fetch` 和 `Authorization` header，JWT 不进入 URL。
- 运行失败事件只返回产品级通用文案，不持久化 provider 原始错误内容。

## 当前部署边界

Conversation session 和事件已持久化到 Postgres，可以跨实例恢复。运行中的 abort controller、在线 Canvas 快照和待确认工具调用仍在单个 Agent API 进程内；横向扩容前需要为这些瞬时状态增加粘性路由或共享事件代理。当前实现遇到运行不在本实例时会明确返回冲突，不会把 abort 或工具结果误投到其他 Project。

## 验收

`src/domain.test.ts` 与 `src/codex-runtime.test.ts` 覆盖 owner 隔离、Project/Workspace 唯一绑定、伪造上下文、session revision、Conversation 运行互斥，以及 Codex Runtime 的 token、目录隔离、thread 绑定和产品事件映射。常规 `npm test` 会跳过依赖外部 Supabase 的集成用例；应用 migration 后可显式运行真实 RLS 验收：

```bash
RUN_SUPABASE_RLS_TESTS=1 npm test
```

启动配置了真实模型的 Agent API 后，可从 `agent-api/` 执行协议级闭环验收。该脚本使用内置 test 账号，验证真实 Pi 流式回复、只读工具、模拟浏览器确认的写工具、session 持久化、事件序号、abort 和持久化数据中的凭据泄漏：

```bash
AGENT_API_URL=http://localhost:4100 npm run acceptance:live
```

脚本不添加隐式重试或超时，失败会保留原始 Gate；完成后仍需在真实浏览器界面人工确认：

```text
Browser → Agent API → Pi → Tool → Canvas → Browser
```

本仓库规则要求本次提交不代替用户执行构建和测试，因此这些用例仍需在目标环境中运行确认。
