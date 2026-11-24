# Infinite Canvas CLI

CLI 是完整的本地工作台，拥有独立的界面入口、路由和构建，通过 workbench 与纯 Web 复用画布能力。项目、素材、生成记录、聊天、脚本和插件数据写入指定目录。桌面版使用同一套界面、服务和工作区。

## 启动

> CLI 本地版仅适用于个人在本机使用，请不要部署到服务器或开放给他人访问。本地版没有登录保护，开放后任何能访问的人都可以查看作品、使用你的模型密钥，并在这台电脑上运行代码。需要多人访问请二次开发或者部署纯 Web 版。

需要 Node.js 22 或更高版本：

```bash
npx -y @basketikun/infinite-canvas@latest serve --data-dir ~/Canvas --open
```

默认目录是 `~/.infinite-canvas/workspace`，默认端口是 `17371`；需要时使用 `--port`。不传 `--open` 时在浏览器打开终端显示的「打开地址」即可。

从源码启动（在仓库根目录）：

```bash
pnpm install --frozen-lockfile
pnpm dev --data-dir ~/Canvas --open
```

界面由 Vite 热更新，服务由 tsx watch 自动重启，无需预先构建。页面、热更新和本地请求共用一个端口。

按 Ctrl+C 停止，服务会完成已接受的写入并释放目录锁。两个进程不能同时写同一目录；同一目录的服务已在运行时，再次执行 `serve` 会直接使用已有服务，加 `--open` 时打开它的页面。异常退出时系统也会自动释放目录锁，可直接重新启动；不要删除 `.canvas.lock` 文件。

插件导致启动问题时，退出当前服务后在原命令加 `--skip-plugins`。本次跳过第三方插件，保留启用选择、项目和素材，可进入插件设置逐个重新启用。相关视频任务暂停并保留记录。

渠道、模型密钥、WebDAV 和对象存储配置保存到工作区私有目录，模型调用由本地服务执行。页面负责发起操作与任务查询，关闭网页后不保证继续生成。媒体不自动回收，可在「设置 → 本地存储」清理未被引用的文件；备份时保留整个数据目录。

## MCP 连接

内置聊天无需 MCP。外部 Agent 使用页面「设置 → Agent配置」或终端输出的 MCP 配置：`mcp` 子命令读取 `~/.infinite-canvas/canvas-mcp.json`，连接已经启动的服务。

```bash
npx -y @basketikun/infinite-canvas@latest mcp
```

源码运行时，终端输出的配置使用当前 Node、tsx 与入口绝对路径。也可使用 HTTP MCP 地址 `http://127.0.0.1:17371/mcp`。纯 Web 版不支持外部 Agent 连接。

画布工具需要目标网页保持打开。首次读取后保留 `clientId` 和 `projectId`，后续调用持续传入，切换项目或断开时不会转交其他画布。

## 打包

```bash
pnpm --dir apps/cli pack
```

打包前自动执行构建；仅构建可使用根目录 `pnpm build:cli`。构建先生成 `ui/dist`，再将服务和 shared 打入 `dist/index.js`，并将界面复制到 `dist/ui`，运行时不需要仓库源码。本地验证安装包：`npx -y --package=./basketikun-infinite-canvas-<版本>.tgz infinite-canvas serve`。

[架构文档](../docs/content/docs/development/local-server-architecture.mdx) · [MCP 开发说明](../docs/content/docs/development/canvas-mcp.mdx)

## 插件安装

```bash
infinite-canvas plugin registry https://raw.githubusercontent.com/basketikun/infinite-canvas/plugins-dist-v1/index.json --data-dir ~/Canvas
infinite-canvas plugin add <包名>@<版本> --data-dir ~/Canvas
infinite-canvas plugin list --data-dir ~/Canvas
infinite-canvas plugin disable <插件ID> --data-dir ~/Canvas
infinite-canvas plugin remove <插件ID> --data-dir ~/Canvas
```

软件源按工作区保存，也可通过 `add --registry <地址>` 设置。命令行和管理页面共用安装器，插件解压到工作区 `plugins/<插件id>/`。关闭占用工作区的服务后使用命令行；运行中使用页面中的插件管理。

包必须包含预构建入口 `dist/client.js`（或根目录 `client.js`），插件 id 取包名。安装不执行生命周期脚本，client/host 配对版本，本地能力使用原有认证。官方示例和 SDK 尚未发布公共 npm；包格式与发布准备见 [插件开发文档](../docs/content/docs/development/plugin-development.mdx)。
