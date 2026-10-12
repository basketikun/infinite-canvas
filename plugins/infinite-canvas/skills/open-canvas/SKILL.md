---
name: open-canvas
description: 打开 Infinite Canvas 在线或本地画布，并自动连接本地 Canvas Agent。用户要求打开、启动、进入或使用 Infinite Canvas 画布时使用。
---

# Open Infinite Canvas

默认打开在线版。只有用户明确要求使用本地项目时，才启动本地前端。

## 在线版

1. 启动本地 Canvas Agent 并保持运行：

```bash
npx -y @basketikun/canvas-agent@latest
```

2. 从启动输出取得 `Local URL` 和 `Connect token`。

3. 在 Codex 右侧浏览器打开：

```text
https://canvas.best/canvas?mode=new#agentUrl=<Local URL>&agentToken=<Connect token>
```

## 本地版

有本机 shell 时直接执行，优先遵循 `setup-canvas` 技能或仓库 `docs/setup-canvas.md`，不只向用户复述命令。

1. 确认项目目录，检查 Node 与 Vite 版本要求；前端依赖缺失时依照仓库锁文件安装 `web` 依赖。
2. 核实已有服务并优先复用，不杀占用端口的进程。没有服务时在项目根目录后台启动：

```bash
node scripts/dev.mjs --agent
```

脚本同时启动前端、代理与 npm 发布版 Canvas Agent；不保证发布版包含仓库尚未发布的功能。保持后台任务运行，确认成功日志后再继续。

3. 在本机读取 `~/.infinite-canvas/canvas-agent.json` 中的 `url` 和 `token`，用 URLSearchParams 编码构造连接地址，并在本机浏览器新标签页打开：

```text
<Vite Local 地址>/canvas?mode=new#agentUrl=<编码后的 Local URL>&agentToken=<编码后的 token>
```

不在聊天、共享日志或提交文件中展示 token。无法打开浏览器时提供不含凭据的网页地址，让用户使用网页自动发现连接。纯聊天 AI 没有本机 shell 时须说明限制并提供必要命令，不声称已执行。

4. 用当前 AI 的 `canvas_get_state` 验证真实连接。MCP 尚未加载但有本机 shell 时，可按 `docs/setup-canvas.md` 经鉴权调用 `/api/tools`；明确这是临时 HTTP 通道，不代表 MCP 已注册。只看到网页打开或端口监听不能算连接成功。

## MCP 与连接地址

插件在新的 Codex 任务中加载时会自动启动 `npx -y @basketikun/canvas-agent@latest mcp`。这个 MCP 进程负责提供画布工具，不提供网页连接服务；
上面启动的普通 Canvas Agent 负责提供 `Local URL` 和 `Connect token`。两个进程读取同一份本地配置，因此不需要用户手动填写地址或 token。

## 打开模式

用户没有明确指定打开方式时，始终使用 `mode=new` 新建画布。只有用户明确要求时才替换为：

- 最近画布：`mode=recent`
- 自己选择：`mode=choose`
