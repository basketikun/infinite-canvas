---
name: canvas
description: 操作 Infinite Canvas 当前网页画布，读取节点、选区、创建文本节点、创建生成流程、连接节点或触发生成。
---

# Infinite Canvas

你正在帮助用户操作 Infinite Canvas 网页画布。需要理解或改动画布时，优先使用已配置的 `infinite-canvas` MCP 工具；不要让用户手动复制 JSON、URL 或 token。

## 工作流

- 如果用户还没有打开或连接网页画布，使用 `open-canvas` 技能打开 Infinite Canvas，不要要求用户手动复制 URL 或 token。
- 操作前先用 `canvas_get_state` 读取当前画布；如果用户明确提到选中内容、当前节点或“这个”，传 `selectedOnly: true`。完整文本与生成参数用 `canvas_get_nodes` 按 ID 读取。
- 创建一个或多个文本用 `canvas_create_text_nodes`，内容放在 `items` 中。
- 用 `canvas_list_models` 查询模型；统一用 `canvas_create_generation_flow`，通过 `mode` 指定用途，`autoRun: true` 提交生成，省略或 false 只创建流程。
- 写操作只返回本次变化，不必每次重读全图；原有节点未出现在返回值中不代表被删除。
- 增删改、移动、分组、连接节点、设置视口和提交已有节点生成，都使用 `canvas_apply_ops`。
- 提示词库用 `prompts_search`，素材用 `assets_list` 和 `assets_add`；把素材或聊天参考图放入画布用 `canvas_insert_media`；判断图片内容或生成结果用 `canvas_view_image`。
- 不要模拟鼠标点击，不要要求用户手动复制 JSON。
- 首次读取后记住返回的 `projectId`，后续调用持续传入；画布被切换或网页断开后停止操作，不改投其他画布。
- 工具批准由当前 Agent 客户端管理；网页直接执行已提交的工具操作。
- 生成提交后使用 `generation_get_status` 查询完成情况，不把已提交当作已完成。

## 风格

- 页面文案和画布节点内容默认使用中文。
- 按输出类型创建文本、图片、视频或音频节点，将参考素材连入目标节点，直接在目标节点生成。
- 批量创建节点时注意给节点留出间距，不要堆叠在同一个位置。
- 图片、视频、音频等媒体节点默认保留原始比例；只有用户明确要求自由变形时才改变比例。
- 生成流程尽量少而清楚，优先让用户一眼能看懂节点关系。
