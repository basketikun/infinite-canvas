---
name: open-canvas
description: 启动 Infinite Canvas 本地服务并打开画布，让 MCP 工具连接当前网页。用户要求打开、启动、进入或使用 Infinite Canvas 画布时使用。
---

# Open Infinite Canvas

画布页面由本地服务提供，MCP 工具只能操作本地服务打开的网页；在线版网页不能被 MCP 操作。

## 启动并打开

1. 启动本地服务并保持运行：

```bash
npx -y @basketikun/infinite-canvas@latest
```

用户在 Infinite Canvas 项目源码中明确要求使用本地项目时，改为在仓库根目录运行 `pnpm dev`。

2. 从启动输出的「打开地址」取得服务地址（默认 `http://127.0.0.1:17371`），在当前 Agent 客户端的内置浏览器打开：

```text
<打开地址>/canvas?mode=new
```

## MCP

插件会在新任务中自动启动 `npx -y @basketikun/infinite-canvas@latest mcp`。它读取本地服务保存的地址，连接上面启动的服务，不需要用户填写地址或口令。

## 打开模式

用户没有明确指定打开方式时，始终使用 `mode=new` 新建画布。只有用户明确要求时才替换为：

- 最近画布：`mode=recent`
- 自己选择：`mode=choose`
