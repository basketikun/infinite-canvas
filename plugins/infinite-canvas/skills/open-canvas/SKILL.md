---
name: open-canvas
description: 打开 Cozy Tv 网页画布并自动连接本地 Canvas Agent。用户要求打开、启动、进入、使用 Cozy Tv 或画布时使用。
---

# Open Cozy Tv

当用户要求打开、启动、进入或使用 Cozy Tv 时，不要把 URL 交给用户手动复制，不要通过浏览器点击“新建画布”。优先快速拉起本地画布和本地 Canvas Agent，然后直接打开带 `mode`、`agentUrl`、`agentToken` 的 URL，让网页自动创建或选择画布并连接 Agent。

## 默认打开方式

- 新建画布：`<画布网页地址>/canvas?mode=new&agentUrl=<Local URL>&agentToken=<Connect token>`
- 最近画布：`<画布网页地址>/canvas?mode=recent&agentUrl=<Local URL>&agentToken=<Connect token>`
- 自己选择：`<画布网页地址>/canvas?mode=choose&agentUrl=<Local URL>&agentToken=<Connect token>`

默认打开新建本地画布；只有用户明确要求线上地址、最近画布或自己选择时，才改用对应模式。

## 工作流

1. 如果当前仓库是 Cozy Tv 项目，优先使用当前仓库的 `web/` 前端。
2. 先检查本地端口归属：如果 `3000`、`3001` 等端口已被占用，必须用 `lsof`/`ps` 或服务输出确认监听进程的工作目录属于当前仓库的 `web/`，不能只因为端口存在就当成本地画布。
3. 如果已有当前仓库的 Next dev 服务，复用它并记录真实画布地址，例如 `http://localhost:3001`。
4. 如果没有当前仓库的服务，启动本地画布开发服务，默认在 `web/` 下运行 `bun run dev`；若默认端口被其他项目占用，改用空闲端口启动，例如 `bunx next dev --webpack -H 0.0.0.0 -p <空闲端口>`。不要执行构建或测试。
5. 启动本地 Canvas Agent，必须带上第 3/4 步得到的真实画布地址：`CANVAS_URL=<真实画布地址> npx -y @basketikun/canvas-agent`。如果 Agent 已经在运行，则读取 `~/.infinite-canvas/canvas-agent.json` 或 `/config` 获取 `Local URL` 和 token。
6. 读取 Agent 输出或配置中的 `Local URL` 和 `Connect token`，不要让用户手动复制。
7. 不走本地 Agent 的 `/open` 跳转；直接构造并打开最终 URL：`<真实画布地址>/canvas?mode=new&agentUrl=<Local URL>&agentToken=<Connect token>`。
8. 画布网页会自动新建具体画布、打开本机 Agent 面板并连接本地 Agent；不要用浏览器点击新建画布。
9. 打开后再使用 `canvas_get_state` 检查画布是否已经连接；如果尚未连接，等待片刻再检查，不要改用线上站点，除非用户明确要求。

## 用户只安装插件时

- 如果当前工作区不是 Cozy Tv 源码仓库，优先提示用户先打开或启动 Cozy Tv 网页，再连接本地 Agent。
- 可以使用线上画布地址或用户给出的本地地址作为 `<画布网页地址>`，但仍要通过本地 Canvas Agent 获取 token 后再打开最终 URL。
- 不要假设用户已经安装本仓库依赖；插件的 MCP 会通过 `npx -y @basketikun/canvas-agent mcp` 使用已发布的 Canvas Agent。

不要要求用户手动填写 URL、token 或复制 JSON。
