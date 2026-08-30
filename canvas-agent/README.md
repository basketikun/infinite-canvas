# Infinite Canvas Agent

本地 Canvas Agent 用来连接画布网页和用户电脑上的 Codex / Claude Code。本地开发时优先连接 `http://localhost:3000`，不需要先使用线上站点。

## 启动

```bash
npx -y @basketikun/canvas-agent
```

需要排查连接、线程、Codex app-server 或工具调用问题时，可开启 Debug 模式：

```bash
npx -y @basketikun/canvas-agent --debug
```

Debug 日志会以 `[DEBUG][HH:mm:ss]` 等传统格式输出到终端，并按启动日期保存到 `~/.infinite-canvas/logs/canvas-agent-YYYY-MM-DD.log`。终端日志带级别颜色，文件日志为纯文本；日志包含 HTTP、SSE、线程、turn、Codex app-server 和工具调用事件，token 与图片 Data URL 会自动隐藏。

本仓库开发时也可以直接运行：

```bash
cd canvas-agent
npm install
npm run build
node dist/index.js
```

启动后会输出本机地址和 token：

```txt
Local URL: http://127.0.0.1:17371
Connect token: xxxxxx
```

在画布右上角点击 `Agent`，填入地址和 token 后连接。

Codex app 插件会读取启动输出里的 Local URL 和 Connect token，并直接打开画布网页地址；Canvas Agent 不负责生成画布打开 URL。

Canvas Agent 默认只监听 `127.0.0.1`。网页带正确 token 连接后，Canvas Agent 会把该网页 Origin 加入本机白名单；Origin 白名单只约束浏览器跨域请求，不限制本机 MCP 客户端的数量。

## 发布

`canvas-agent` 使用自己的 `package.json` 版本号，不跟仓库根目录 `VERSION` 绑定。涉及 `canvas-agent` 的 PR 会执行测试、构建和打包检查；推送到上游仓库 `main` 后，GitHub Actions 会检查 npm 上是否已经存在当前包版本，不存在时才发布 `@basketikun/canvas-agent`。

发布前需要在 GitHub 仓库 Secrets 中配置 `NPM_TOKEN`。

## Codex MCP

如果希望 Codex 终端能直接操作画布，需要先把 Canvas Agent 注册成 Codex MCP。

直接运行 `npx -y @basketikun/canvas-agent` 只启动本地 Agent 服务，不会安装 MCP，也不会增加 Codex 工具上下文。只有安装 Codex app 插件，或手动执行 `codex mcp add` 后，`infinite-canvas` 工具才会进入 Codex 上下文；由于工具较多，不使用时建议移除。

通过插件安装时移除插件：

```bash
codex plugin remove infinite-canvas
```

手动添加 MCP 时移除 MCP：

```bash
codex mcp remove infinite-canvas
```

### Codex app 插件

仓库内提供了 Codex app 插件：`plugins/infinite-canvas`。在 Codex app 中添加本仓库的 marketplace 后，可以安装 `Infinite Canvas` 插件；插件会注册同一个 `infinite-canvas` MCP，并带上画布操作说明。

添加本地 marketplace 时建议使用仓库绝对路径，避免 Codex 从其他工作目录解析失败：

```bash
cd /path/to/infinite-canvas
codex plugin marketplace add "$(pwd)"
codex plugin add infinite-canvas@infinite-canvas-local
```

插件默认通过 npm 启动 MCP；这个命令只提供 MCP 工具，不会把 MCP 写入全局配置，也不会在退出时自动卸载：

```bash
npx -y @basketikun/canvas-agent mcp --agent codex --name Codex
```

使用时可以直接在 Codex 里说“打开 Infinite Canvas”，插件会启动本地 Agent，读取 Local URL 和 Connect token，然后在右侧打开 `https://canvas.best/` 并自动新建、连接画布；只有明确要求使用本地项目时才会启动本地前端。

Canvas Agent 启动后，给 Codex 添加 MCP：

```bash
codex mcp add infinite-canvas -- npx -y @basketikun/canvas-agent mcp --agent codex --name Codex
```

本仓库开发时可以改成，实际使用建议替换为本机绝对路径：

```bash
codex mcp add infinite-canvas -- node /path/to/infinite-canvas/canvas-agent/dist/index.js mcp --agent codex --name Codex
```

Canvas Agent 源码使用 TypeScript 编写，MCP 协议层使用官方 `@modelcontextprotocol/sdk`，工具入参使用 `zod` 描述。

如果希望终端里的 Codex 不被 MCP 审批卡住，可以在 `~/.codex/config.toml` 里给这个 MCP 设置自动放行：

```toml
[mcp_servers.infinite-canvas]
command = "npx"
args = ["-y", "@basketikun/canvas-agent", "mcp", "--agent", "codex", "--name", "Codex"]
default_tools_approval_mode = "approve"
```

可用工具：

- `canvas_get_state`
- `canvas_get_selection`
- `canvas_export_snapshot`
- `canvas_apply_ops`
- `canvas_create_text_node`
- `canvas_create_image_prompt_flow`

`canvas_apply_ops` 示例：

```json
{
  "projectId": "当前 canvas_get_state 返回的 projectId",
  "baseRevision": 1,
  "ops": [
    {
      "type": "add_node",
      "id": "由调用方生成的唯一 ID",
      "nodeType": "text",
      "title": "标题",
      "position": { "x": 0, "y": 0 },
      "metadata": { "content": "文本内容" }
    }
  ]
}
```

## 侧边栏 Codex

本地面板会把提示词发送给 Canvas Agent。Canvas Agent 使用官方 `@openai/codex` CLI 的 `codex app-server --stdio` 启动并复用同一个 Codex thread，启动时会注入 `infinite-canvas` MCP 配置并自动放行 MCP 审批，真正执行画布修改前仍由网页侧边栏二次确认。

侧边栏会展示 Codex 返回的 `thread.started`、`turn.started`、`item.*`、`turn.completed` 等结构化事件；Canvas Agent 会合并短时间内的回复、思考摘要和命令输出增量，网页使用同一条消息持续更新，并把任务进度、计划、搜索、文件修改与工具操作整理为中文过程时间线。

侧边栏上传或粘贴的图片会先发到本机 Canvas Agent，再由 Canvas Agent 临时写入本机文件并作为 app-server `localImage` 输入传给 Codex；前端会提示附件体积，单次请求体限制为 30MB。

## Claude Code

Claude Code Adapter 代码暂时保留，但当前网页侧边栏只开放 Codex。后续开放 Claude 入口时，Canvas Agent 会调用本机 `claude -p --output-format stream-json` 并把流式 JSON 事件转发到侧边栏。

如果希望 Claude Code 也能操作画布，需要给 Claude Code 添加同一个 MCP。建议用 user scope，避免 Canvas Agent 从不同目录启动时找不到配置：

```bash
claude mcp add --scope user --transport stdio infinite-canvas -- npx -y @basketikun/canvas-agent mcp --agent claude --name "Claude Code"
```

本仓库开发时可以改成：

```bash
claude mcp add --scope user --transport stdio infinite-canvas -- node /path/to/infinite-canvas/canvas-agent/dist/index.js mcp --agent claude --name "Claude Code"
```

Canvas Agent 调用 Claude Code 时会默认带上 `--allowedTools mcp__infinite-canvas__*`，画布写操作仍由网页侧边栏确认。

## 多 Agent 并行与协作

Codex、ZCode、TraeCode 等客户端可以同时启动各自的 MCP 进程，并连接同一个已经运行的 Canvas Agent。每个进程必须通过 `--agent` 和 `--name` 声明身份；需要同时运行多个同类 Agent 时，再用 `--instance` 指定稳定且唯一的实例 ID。

不带身份参数的旧版 `canvas-agent mcp` 命令仍按 Codex 客户端兼容运行，但多 Agent 场景应显式配置身份。Agent 身份用于本机协作归属和界面展示，不是独立的认证凭据；能够读取同一个 Connect token 的本机进程处于同一信任边界。

仓库提供三份示例配置：

- Codex：`plugins/infinite-canvas/.mcp.json`
- ZCode：`.agents/mcp.json`，可由 ZCode 直接读取或导入
- TraeCode：`.trae/mcp.json`

所有画布读取结果都包含 `projectId` 和 `revision`。调用画布写工具时必须把它们作为 `projectId` 和 `baseRevision` 原样传回；遇到 `CANVAS_REVISION_CONFLICT` 或 `CANVAS_REVISION_EXPIRED` 时重新读取再重试。不同节点的修改可以合并，同一节点的并发修改不会静默覆盖。

协作工具支持两种模式：

- `broadcast`：同一任务由多个目标 Agent 各自领取并提交结果。
- `orchestrated`：主 Agent 使用 `collaboration_delegate_task` 拆分带依赖的子任务，再通过 `collaboration_get_results` 汇总。

外部 MCP 客户端不会被服务端反向唤醒。每个 Agent 需要先调用 `collaboration_join`，再主动调用 `collaboration_list_tasks` / `collaboration_claim_task` 领取任务，长任务用 `collaboration_renew_claim` 续期。Codex 可在创建或分派任务时将 `codexDispatch` 设为 `active`，由本机 app-server 主动执行；默认仍为 `mailbox`。
