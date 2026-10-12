# 让 AI 启动并连接 Infinite Canvas

把本文件发给有本机终端能力的 AI，并说：**“按照这份说明，帮我启动并连接画布。”**

以下是给 AI 的执行说明。获得用户启动授权后，直接执行可完成的步骤，不要只复述命令。安装依赖、修改 MCP 配置等操作仍遵循宿主权限审批。

## 1. 先确认执行环境

- 必须能访问用户电脑的终端和浏览器。云端容器里的 localhost 不是用户电脑；纯聊天 AI 也不能凭这份文档获得本机权限。无法执行时说明限制，只提供必要手动步骤，不宣称已启动。
- 检查当前目录是否包含 `scripts/dev.mjs`、`web/package.json` 和 `canvas-agent/package.json`。用户要求本地项目但找不到时，询问项目目录，不猜测仓库地址，不覆盖现有文件。
- 用户指定本地项目时走本地版；未指定且没有本地项目时默认在线版。已有连接优先复用，不另建画布打断当前工作。
- 检查 Node.js、npm；本地前端还应检查 `web/package.json` 和当前 Vite 的 Node 版本要求，不只按 Canvas Agent 的 Node >=18 判断。

## 2. 启动服务并保持运行

### 本地版

在项目根目录操作。前端依赖缺失时，按仓库锁文件选择包管理器，在 `web` 安装依赖，不随意生成另一种锁文件。

```sh
# 使用项目现有的包管理器，例如：
cd web
bun install
cd ..
node scripts/dev.mjs --agent
```

使用宿主支持的后台进程功能保存进程句柄和本地日志，不让前台工具超时杀掉服务。这个脚本启动前端、代理以及 npm 发布版 Canvas Agent，不是本地 Agent 源码版。不要为了连接擅自编译项目。

- 前端默认 `http://localhost:3000`，实际以 Vite 成功启动输出为准。
- 转发代理默认 `http://127.0.0.1:23210`，脚本对已有监听会复用；端口可连接不等于服务身份正确。
- `--agent` 使用 `npx -y @basketikun/canvas-agent@latest`。仓库新工具尚未发布时，不保证此版本具备它们。
- 3000 已占用时脚本会退出：先核实是否就是用户已运行的画布，能复用则复用；不要杀掉占用进程。
- 如已有完整服务，不重复启动。如只有部分服务存在，先读脚本并按缺失项分别启动，不盲目反复运行组合脚本。
- 进程退出、网络失败、缺依赖都要明确报告；看到“启动中”不等于启动成功。

### 在线版

在用户电脑的后台启动并保持运行：

```sh
npx -y @basketikun/canvas-agent@latest
```

网页使用 `https://canvas.best`。本地代理是否需要启动取决于生成供应商和网页配置；画布已连接不代表生成 API 或代理可用。

## 3. 取得连接信息并打开浏览器

Canvas Agent 将配置保存到用户主目录的 `.infinite-canvas/canvas-agent.json`，其中 `url` 是本地服务地址，`token` 是连接凭据。只在本机读取，勿输出整个配置、token 或包含 token 的完整 URL 到聊天、共享日志、提交文件或外部服务。

用 URL API / URLSearchParams 编码构造连接地址，形式为：

```text
<网页地址>/canvas?mode=new#agentUrl=<编码后的本地服务地址>&agentToken=<编码后的token>
```

通过本机浏览器打开能力传递该地址，而不是把凭据展示给用户。保留用户已有标签页，使用新标签页。已有已连接的画布优先复用；需要新建时才使用 `mode=new`。

没有浏览器操作能力时，给用户不含 token 的网页地址，让用户在网页连接设置中使用自动发现，必要时在本机手动填写。不要要求用户把 token 发回聊天。

## 4. 让当前 AI 能调用工具

**网页连接成功不等于当前 AI 已有 MCP 工具。** 普通 Canvas Agent 提供 HTTP/SSE 服务；`mcp` 子进程通过 stdio 提供工具并转发到该 HTTP 服务，两者读取同一份本地配置。

优先检查当前 AI 是否已有 `infinite-canvas` 工具。有则直接使用，不重复安装。

没有时，按宿主支持的方式注册 MCP，服务名 `infinite-canvas`：

```json
{
  "mcpServers": {
    "infinite-canvas": {
      "command": "npx",
      "args": ["-y", "@basketikun/canvas-agent@latest", "mcp"]
    }
  }
}
```

这是通用 stdio 配置示例，不是所有客户端的配置文件格式。Codex 使用自己的配置格式，Claude Code 也有自己的 MCP 管理命令：先检查当前客户端帮助与已有配置，再经用户批准追加服务；不能整文件覆盖。Windows 如果宿主不能直接执行 npx，可用 `cmd /c npx ...`。无需把 token 写进 MCP 配置。

MCP 子进程由 AI 客户端管理，不要把它当普通 HTTP 服务后台启动。新增配置可能需要重载 MCP 或新会话；文件写入成功不能当作本轮工具已加载。

### 临时 HTTP 路径：无需等待 MCP 重新加载

如果 AI 有本机 shell 但当前会话未加载 MCP，可通过同一个服务调用工具。下例可由 Node.js 执行，只输出结果，不输出凭据：

```js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.infinite-canvas/canvas-agent.json'), 'utf8'));
  const response = await fetch(`${config.url}/api/tools`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-canvas-agent-token': config.token },
    body: JSON.stringify({ name: 'canvas_get_state', input: {} }),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
  const state = body.result;
  console.log(JSON.stringify({ connected: true, projectId: state.projectId, title: state.title, nodeCount: state.nodes?.length }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
```

这条路径仅替代 MCP 传输，不代表 MCP 已安装。后续工具名和参数应来自当前工具清单或仓库 `canvas-agent/src/canvas/schemas.ts`，不要猜测。

## 5. 验收并交付

1. 服务进程持续运行，日志没有启动失败。
2. 浏览器打开画布并建立连接。
3. 当前 AI 用 MCP 或上述 HTTP 请求执行 `canvas_get_state` 成功，返回真实画布状态。仅端口连通、页面打开、MCP 列表出现都不足以证明可操作画布。
4. 不默认创建测试节点、不触发付费生成、不删除已有数据。
5. 告诉用户：网页地址（不含 token）、实际使用 MCP 还是临时 HTTP、服务由哪个后台任务维持，以及尚未完成的步骤。

API Key、生成服务配置、代理可用性、Codex 登录及 Blender 连接是独立事项。连接外部 Claude/Codex 到画布，不等于网页内置 Codex 对话已登录。遇到这些问题分开报告，勿将画布控制成功当成全部环境就绪。
