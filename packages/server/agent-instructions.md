# Infinite Canvas MCP

你通过 MCP 操作用户当前打开的无限画布，推理与会话由当前 Agent 管理。

- 首次用 `canvas_get_state` 读取精简概览，记住 `projectId`，后续传入以防止画布被切换后误操作；切换画布后重新读取。
- 概览一次最多返回 200 个节点，超出时用 `offset` 翻页或用 `ids`、`types`、`selectedOnly`、`groupId`、`keyword` 缩小范围；不需要连线时传 `includeConnections: false`。完整文本、生成参数和媒体尺寸用 `canvas_get_nodes` 按 ID 读取（最多 50 个）；概览中的文本可能是带标记的预览。
- 写操作只返回本次变化：`createdNodeIds`、变化的 `nodes`、删除的 ID、新增与删除连线，以及发生变化的选区和视口。未返回的原有节点不代表被删除；不必每次修改后重读全图。
- 创建文本用 `canvas_create_text_nodes`；其余增删改、移动、分组、连线、选区、视口和提交生成都用 `canvas_apply_ops`，新节点可指定 ID，在同批后续操作中直接引用。组是真实分组，不要用文本标题代替；不支持嵌套组，组可作为生成参考与连线来源，不能作为连线目标。
- 所有位置均为画布绝对坐标。移动组同步移动成员，同批显式指定成员时以成员参数为准；改组尺寸只改变组框，删除组保留成员。
- 用 `canvas_list_models` 查询模型 ID 与用途，不猜模型名。统一用 `canvas_create_generation_flow` 创建文本、图片、视频或音频流程；`mode` 指定用途，`autoRun: true` 提交生成，省略或 false 只创建流程。已有节点用 `canvas_apply_ops` 的 `run_generation`。
- `submittedNodeIds` 只表示生成已提交，不代表成功；用 `generation_get_status` 携带 nodeIds 查询。失败或超时后先确认实际状态，不重复提交付费生成。
- 参考素材使用真实节点 ID；聊天上传图片用 `canvas_list_references` 查询，「我的素材」用 `assets_list` 查询，再用 `canvas_insert_media` 插入（传 `storageKey` 或 `assetId`）。需要判断图片内容或生成结果时用 `canvas_view_image` 查看，返回长边 1024 以内的缩略图。不要创建空图片占位节点或编造图片地址。
- 提示词库用 `prompts_search`，「我的素材」用 `assets_list`、`assets_add`；素材列表默认只给摘要，确需文本原文时按 ids 传 `includeContent: true`。
- 失败返回固定 `code` 和 `message`；节点不存在时重新读取所需节点，项目切换时重新确认目标，连接断开时停止操作。
