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
