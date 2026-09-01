# MiniMax H3 画布插件

把旧画布 MiniMax H3 节点的核心操作迁移到新画布：

- 上游视频、图片和音频按连接顺序作为参考素材
- H3 提示词、时长、比例、步数和去噪强度
- Motion Context 与递进增噪开关
- 生成状态、错误信息和视频结果回写节点
- 兼容旧 `smart-minimax` 节点的 refs、角色资产和分段字段

插件通过宿主注入的 `ctx.ai.runLocalH3` 执行，由 Canvas Agent 代理本地 ComfyUI，不直连 ComfyUI，也不依赖旧画布 DOM。迁移的旧节点如果 `minimaxEngine` 为 `runninghub`，则自动改用 `ctx.ai.runRunningHubH3`，由 Agent 代理 RunningHub 的素材上传、任务提交、轮询和取消。支持多 Clip 串行、上一段视频作为 Motion Context、角色图片和参考音频。

RunningHub 凭据和工作流字段保存在 Agent 的运行时数据库中，可通过 Agent 的 `/runninghub/config` 配置；接口返回配置时会隐藏密钥。

## 开发

```bash
npm install
npm run typecheck
npm run dev
```

构建产物会同步到 `web/public/plugins/minimax-h3.js`，刷新新画布后在“节点插件”中启用即可。

## MCP 能力(双入口架构)

插件采用「前端插件 + Agent MCP 模块」双入口,把 H3 的执行能力同时暴露给浏览器节点与 Agent(MCP stdio 服务):

- **前端入口** `src/index.tsx` → `dist/minimax-h3.js`:渲染画布节点、参数面板、拖拽参考、结果写回。
- **Agent 入口** `src/mcp.ts` → `canvas-agent` 内建 MCP 模块:经 `KNOWN_FIRST_PARTY` 白名单加载,在 Agent 侧注册 7 个 `h3_*` 工具,复用 `ComfyUiBridge`、任务库与媒体代理,**不复制生成逻辑**。

### 暴露的 MCP 工具

| 工具 | 说明 |
| --- | --- |
| `h3_list_models` | 列出 H3 可用模型与 LoRA |
| `h3_get_node` | 按 id 读取画布 H3 节点及其片段/参考配置 |
| `h3_run_clip` | 运行单个片段(解析参考图/视频/音频并提交 ComfyUI) |
| `h3_get_task` | 查询生成任务状态/进度/结果 |
| `h3_cancel_task` | 取消运行中的任务 |
| `h3_update_clip` | 更新某片段字段并写回节点 metadata |
| `h3_run_all_clips` | 运行全部/指定 H3 节点的未完成片段 |

### 生命周期与安全边界

- 浏览器启用/禁用插件时,通过 `POST /api/plugins/mcp` 把声明同步给 Agent,持久化到 SQLite;Agent 的 MCP 进程冷启动加载、并轮询该声明,从而动态注册/注销工具,重启后仍生效。
- **MCP 不运行在浏览器插件代码里**,它由 Node.js stdio 服务(Agent)执行。
- **安全边界**:官方/本地插件(minimax-h3)自动加载其 MCP 模块;第三方远程插件仅加载前端节点,MCP 执行需经用户显式安装 + Agent 授权,未授权时只记录、不注册工具。MCP 模块只来自本地已安装包或受信插件目录,绝不执行任意网页脚本。

详见 `plugin.manifest.json` 与 `canvas-agent/src/server/plugin-mcp.ts`。

