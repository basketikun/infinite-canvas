---
name: canvas
description: 操作 Infinite Canvas 当前网页画布，读取节点、选区、创建文本节点、创建生成流程（含 3D）、连接节点或触发生成。
---

# Infinite Canvas

你正在帮助用户操作 Infinite Canvas 网页画布。需要理解或改动画布时，优先使用已配置的 `infinite-canvas` MCP 工具；不要让用户手动复制 JSON、URL 或 token。

## 工作流

- 如果用户还没有打开或连接网页画布，使用 `open-canvas` 技能打开 Infinite Canvas，不要要求用户手动复制 URL 或 token。
- 操作前先用 `canvas_get_state` 读取当前画布；如果用户明确提到选中内容、当前节点或“这个”，先用 `canvas_get_selection`。
- 创建单个文本内容优先用 `canvas_create_text_node`。
- 创建生成内容优先用 `canvas_generate_text`、`canvas_generate_image`、`canvas_generate_video`、`canvas_generate_audio`、`canvas_generate_model3d`。
- 用户要求生成 3D / 模型时用 `canvas_generate_model3d`，不要改走生图。仅有提示词走文生 3D；已有图片节点时把 ID 放入 `referenceNodeIds`（1 张图生 3D，2–4 张多视图生 3D）。需要贴图、PBR、面数、四边面时通过 `model3dTexture`、`model3dPbr`、`model3dTextureQuality`、`model3dFaceLimit`、`model3dQuad` 传入，未指定则沿用画布当前 3D 设置。
- 需要把提示词、配置和生成节点串成流程时，使用 `canvas_create_generation_flow`（`mode` 可为 text / image / video / audio / model3d）或项目已有的流程工具。
- 创建空 3D 占位节点用 `canvas_create_node`，`nodeType` 为 `model3d`。已有模型可用 `canvas_import_to_blender` 导入 Blender；用 `canvas_download_nodes` 下载画布媒体。两个工具均可传 `nodeIds`，省略则使用当前选区；返回“已启动/已触发”不代表导入完成或文件已落盘。打开 Bambu Studio 仍是画布 UI 操作。
- 需要批量增删改、移动、连接节点或设置视口时，使用 `canvas_apply_ops`。
- 不要模拟鼠标点击，不要要求用户手动复制 JSON。
- 写入画布的操作会由网页侧边栏做二次确认，按当前工具结果继续推进即可。

## 风格

- 页面文案和画布节点内容默认使用中文。
- 生成节点、配置节点和提示词节点要保持结构清晰，方便用户继续编辑。
- 批量创建节点时注意给节点留出间距，不要堆叠在同一个位置。
- 图片、视频、音频、3D 等媒体节点默认保留原始比例；只有用户明确要求自由变形时才改变比例。
- 生成流程尽量少而清楚，优先让用户一眼能看懂节点关系。
