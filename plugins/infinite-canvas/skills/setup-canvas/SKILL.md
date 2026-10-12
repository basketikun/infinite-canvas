---
name: setup-canvas
description: 自动启动本地 Infinite Canvas 前端、转发代理与 Canvas Agent，打开并连接浏览器画布，通过 MCP 或本机 HTTP 验证当前 AI 能读取画布。用户要求启动项目、连接画布或配置画布工具时使用。
---

# 启动并连接画布

获得用户授权后直接执行，不只给出命令。需要用户本机终端能力；云端 shell 和纯聊天 AI 不能直接操作用户的 localhost，缺能力时明确说明。

## 执行流程

1. 已有 `canvas_get_state` 工具时先尝试读取，成功则复用当前连接。用户明确要求新项目才新建画布。
2. 找到本地项目根目录，确认 `scripts/dev.mjs`、`web/package.json` 存在。找不到时询问目录，不猜路径或克隆来源。
3. 本地仓库中的 `docs/setup-canvas.md` 是完整操作说明，存在时先读取，按其中的环境检查、服务复用和凭据保护步骤执行。
4. 检查 Node 与前端依赖版本要求；依赖缺失时依照锁文件用现有包管理器安装 `web` 依赖。不要为连接运行构建或测试。
5. 没有服务时从根目录后台启动 `node scripts/dev.mjs --agent`，保存后台任务句柄并检查就绪与错误日志。脚本使用 npm 发布版 Agent，不保证包含未发布的仓库工具。已有服务先核实后复用；不要杀占用端口的进程。
6. 仅本机读取 `~/.infinite-canvas/canvas-agent.json` 的 `url` 与 `token`。用 URLSearchParams 编码为网页 hash：`#agentUrl=...&agentToken=...`，在本机浏览器新标签页打开连接地址。默认本地网页 `http://localhost:3000/canvas?mode=new`，以实际服务输出为准。不要在聊天或共享日志展示 token 或完整连接 URL。
7. 当前 AI 没有画布 MCP 时，经用户批准通过宿主 MCP 管理方式追加 `npx -y @basketikun/canvas-agent@latest mcp`，保留其他配置。stdio MCP 由宿主启动，与普通 HTTP 服务是两个进程；配置成功不意味着当前会话已经加载工具。
8. 无法立即加载 MCP 时可用本机 HTTP 临时调用：从本地配置读取凭据，POST `${config.url}/api/tools`，请求头 `x-canvas-agent-token: config.token`，JSON 为 `{ "name": "canvas_get_state", "input": {} }`。检查 HTTP 状态与响应 `ok`，不打印凭据。
9. 必须读取到真实画布状态才报告已连接。说明本轮使用 MCP 还是 HTTP、后台任务和不含凭据的网页地址。不要擅自生成测试资产、付费生图、配置 API Key 或启动 Blender。

## 分发与加载

本文件放在插件技能目录，不代表所有 Claude Code 会话自动发现它。可把文件直接交给 AI 按说明执行，或经用户授权安装到客户端支持的技能目录；不要声称未安装的 slash 命令已可用。没有本地仓库时，使用 `open-canvas` 的在线版流程。
