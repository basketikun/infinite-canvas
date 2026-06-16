# TwitCanva 交互逻辑迁移计划

本文档用于对比 `/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src` 和本项目 `web/src/app/(user)/canvas/` 的画布交互差异，并沉淀后续迁移计划。

文档只保留对本项目有迁移价值的差异项。已经和本项目一致或本项目已有更合适实现的逻辑，不再逐条复述。

## 结论

本项目已经具备一批基础画布能力：

- 框选、多选、Shift 追加选择、多选拖拽。
- 节点拖拽时按当前缩放反算坐标。
- 独立 `connections` 数据结构、连线选中、连线删除、连接点拖拽建连线。
- 连接点拖空后打开创建节点菜单。
- 双击空白画布打开新建节点菜单。
- 复制、粘贴、删除、撤销、重做、Escape 取消选择。
- 分组、取消分组、组名编辑、组内排序、拖拽分组外框移动。
- 顶部标题双击编辑。
- 素材选择后插入当前视口中心。
- 助手面板、会话历史、选中节点作为助手引用。

因此，后续迁移重点不是重做这些基础能力，而是补齐体验差异：

1. 普通滚轮/触控板双指平移，`Ctrl/Cmd + wheel` 和触控板捏合缩放。已完成。
2. 节点内部滚动和浮层事件隔离。已完成。
3. 右键空白画布菜单和节点右键菜单补齐。已完成。
4. 连接点短按打开添加菜单，并按连接点方向落新节点。已完成。
5. 分组工具条中文化。已完成。
6. 图片预览弹窗内部缩放。已完成。
7. 节点内容拖拽到助手作为附件。
8. 按本项目节点类型重新设计连接类型校验。

图片编辑器、视频编辑器、Storyboard、Workflow、生成恢复、TikTok/X 发布属于较大的业务模块，不应混入基础画布交互迁移。

## 对照入口

TwitCanva 主要入口：

- 主入口：`src/App.tsx`
- 画布导航：`src/hooks/useCanvasNavigation.ts`
- 指针调度：`src/hooks/usePointerHandlers.ts`
- 节点拖拽和平移：`src/hooks/useNodeDragging.ts`
- 框选：`src/hooks/useSelectionBox.ts`
- 连线拖拽：`src/hooks/useConnectionDragging.ts`
- 节点创建：`src/hooks/useNodeManagement.ts`
- 右键菜单：`src/hooks/useContextMenuHandlers.ts`、`src/components/ContextMenu.tsx`
- 分组：`src/hooks/useGroupManagement.ts`、`src/components/canvas/SelectionBoundingBox.tsx`
- 快捷键：`src/hooks/useKeyboardShortcuts.ts`
- 面板状态：`src/hooks/usePanelState.ts`

本项目主要入口：

- 画布容器：`web/src/app/(user)/canvas/components/infinite-canvas.tsx`
- 画布页面：`web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`
- 节点组件：`web/src/app/(user)/canvas/components/canvas-node.tsx`
- 连线组件：`web/src/app/(user)/canvas/components/canvas-connections.tsx`
- 选择/分组外框：`web/src/app/(user)/canvas/components/canvas-selection-bounding-box.tsx`
- 右键菜单：`web/src/app/(user)/canvas/components/canvas-context-menu.tsx`
- 添加节点菜单：`web/src/app/(user)/canvas/components/canvas-add-nodes-menu.tsx`
- 助手面板：`web/src/app/(user)/canvas/components/canvas-assistant-panel.tsx`
- 类型定义：`web/src/app/(user)/canvas/types.ts`

## 已具备能力

这些交互在本项目中已经实现，后续不按 TwitCanva 重写。

### 选择、框选和拖拽

本项目已经支持：

- 空白画布左键拖拽框选。
- Shift 框选追加已有选择。
- Shift 点击追加选择节点。
- 多选节点一起拖拽。
- 拖拽位移按当前 `viewport.k` 反算画布坐标。
- 框选使用本项目节点真实 `width/height` 命中，比 TwitCanva 固定 `340 x 300` 更准确。

保留现状即可。

### 连线基础交互

本项目已经支持：

- 从节点连接点拖拽创建连线。
- 拖拽时高亮可连接目标。
- 点击连线选中。
- `Delete` / `Backspace` 删除选中连线。
- 拖空后打开“引用该节点生成”的创建菜单。

注意：TwitCanva 用子节点 `parentIds` 表示连接，本项目使用独立 `CanvasConnection`。后续只迁移交互，不迁移 TwitCanva 的连接数据结构。

### 添加节点

本项目已经支持：

- 左侧菜单添加节点。
- 底部工具栏添加节点。
- 双击空白画布在鼠标位置打开添加节点菜单。
- 从素材库或我的素材插入到当前视口中心。
- 拖入本地图片、视频、音频到画布创建节点。
- 从系统剪贴板粘贴图片或文本创建节点。

这些能力不需要按 TwitCanva 重做。

### 快捷键和历史

本项目已经支持：

- `Ctrl/Cmd + Z` 撤销。
- `Ctrl/Cmd + Shift + Z`、`Ctrl/Cmd + Y` 重做。
- `Ctrl/Cmd + A` 全选节点。
- `Ctrl/Cmd + C` 复制选中节点。
- `Ctrl/Cmd + V` 粘贴节点，或从系统剪贴板创建文本/图片节点。
- `Delete` / `Backspace` 删除节点或连线。
- `Escape` 取消选择并关闭浮层。

本项目已经同时支持 `Ctrl` 和 `Cmd`，优于 TwitCanva 中部分只判断 `Ctrl` 的实现。

### 分组

本项目已经支持：

- 多选后显示选择外框。
- 创建分组。
- 取消分组。
- 双击组名编辑。
- 组内横向、纵向、网格排序。
- 拖拽分组外框移动整组。
- 自动清理少于 2 个节点的无效分组。

后续只需要做文案中文化和少量体验整理。

### 文本和图片节点快捷动作

本项目已经具备文本节点和图片节点的主要工作流入口：

- 文本节点编辑。
- 文本生图。
- 文本生视频。
- 图片生成相关工具栏动作。
- 图片裁剪、蒙版编辑、拆分、放大、角度变化等单点工具。

TwitCanva 的文本/图片节点基础快捷动作不需要单独迁移。完整图片编辑器属于另一个大模块，见后文“暂缓迁移”。

## 第一批：简单合并迁移

第一批只做体验补齐和小范围改动，避免触碰复杂业务模型。

### 普通滚轮平移，Ctrl/Cmd 滚轮和触控板捏合缩放

实现状态：已实现。

当前差异：

- TwitCanva：普通滚轮和触控板双指用于平移画布。
- TwitCanva：`Ctrl/Cmd + wheel` 和触控板捏合用于缩放。
- 本项目原先：`wheel` 无条件缩放；平移主要靠中键或空格拖拽。

迁移入口：

- `web/src/app/(user)/canvas/components/infinite-canvas.tsx`

实现说明：

- 修改 `handleWheel`。
- 事件目标在节点内部输入、弹窗、下拉、媒体控件中时直接忽略画布处理。
- 没有 `ctrlKey/metaKey` 时：
    - `viewport.x = viewport.x - event.deltaX`
    - `viewport.y = viewport.y - event.deltaY`
    - `viewport.k` 不变。
- 有 `ctrlKey/metaKey` 时：
    - 继续使用本项目当前以鼠标位置为锚点的缩放算法。
    - 缩放范围继续沿用本项目 `0.05 ~ 5`，不要直接改成 TwitCanva 的 `0.1 ~ 2`。
- 触控板捏合缩放：
    - Chromium 类浏览器通常会映射为 `ctrlKey + wheel`，走同一缩放逻辑。
    - Safari 额外监听 `gesturestart` / `gesturechange`，使用 `event.scale` 做缩放兜底。
- 更新快捷键弹窗文案：
    - “滚轮 / 双指：平移画布”
    - “Ctrl/Cmd + 滚轮 / 触控板捏合：缩放画布”

暂不迁移：

- TwitCanva 的“缩放时如果鼠标悬停在节点上，则以节点中心作为缩放锚点，并在放大时轻微把节点拉向视口中心”的智能聚焦增强。普通 `Ctrl/Cmd + wheel` 缩放和触控板捏合缩放已经实现。

### 节点内部滚轮和指针事件隔离

实现状态：已实现。

当前差异：

- TwitCanva 对节点内部滚动、textarea、按钮、下拉菜单、媒体预览做了更多事件隔离。
- 本项目已有部分 `data-canvas-no-zoom` 和 `onWheel.stopPropagation()`，但普通滚轮改为平移后需要补齐。

迁移入口：

- `web/src/app/(user)/canvas/components/infinite-canvas.tsx`
- `web/src/app/(user)/canvas/components/canvas-node.tsx`
- 画布内各类弹窗、浮层、下拉组件。

实现说明：

- 对节点内部可滚区域补 `onWheel={(event) => event.stopPropagation()}`。
- 对媒体控件、Ant Design 下拉、弹窗、Popover、Dropdown 保留或补充 `data-canvas-no-zoom`。
- 对节点内部按钮继续 `onPointerDown/onMouseDown.stopPropagation()`，避免触发节点拖拽。
- 确认图片预览、裁剪、蒙版、拆分等弹窗内滚轮不会平移画布。

### 右键空白画布全局菜单

实现状态：已实现。

当前差异：

- TwitCanva 右键空白画布会打开全局菜单。
- 本项目右键空白画布当前主要是阻止浏览器菜单并关闭已有菜单。

迁移入口：

- `web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`
- `web/src/app/(user)/canvas/components/canvas-context-menu.tsx`
- `web/src/app/(user)/canvas/types.ts`

实现说明：

- 扩展 `ContextMenuState`：

```ts
{
    type: "canvas";
    x: number;
    y: number;
    position: Position;
}
```

- 空白画布右键时记录屏幕坐标和画布坐标。
- 菜单动作复用本项目已有能力：
    - 添加文本节点。
    - 添加图片节点。
    - 添加视频节点。
    - 添加音频节点。
    - 添加配置节点。
    - 上传素材。
    - 打开我的素材。
    - 打开素材库。
    - 撤销。
    - 重做。
    - 粘贴。
- 菜单文案全部使用中文。

### 节点右键菜单补齐和中文化

实现状态：已实现。

当前差异：

- TwitCanva 节点右键菜单有复制、删除、保存素材等动作。
- 本项目节点右键菜单目前动作较少，并且 `Duplicate` / `Delete` 仍是英文。

迁移入口：

- `web/src/app/(user)/canvas/components/canvas-context-menu.tsx`
- `web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`

实现说明：

- `Duplicate` 改为“复制一份”。
- `Delete` 改为“删除”。
- 增加“复制节点”，接入当前复制逻辑。
- 增加“保存到我的素材”，复用现有节点保存素材逻辑。
- 连接菜单只保留连接相关动作，例如“删除连线”。

### 连接点短按打开添加菜单

实现状态：已实现。

当前差异：

- TwitCanva 短按连接点小于 `200ms` 且没有拖到目标节点，会打开添加节点菜单。
- 本项目已有拖空后创建菜单，但短按和落点布局还可以更贴近 TwitCanva。

迁移入口：

- `web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`
- `ConnectionCreateMenu`
- `createConnectedNode`

实现说明：

- 在 `handleConnectStart` 记录：
    - 开始时间。
    - 起点屏幕坐标。
    - 起点节点 id。
    - 连接点方向。
- 在 `handleGlobalMouseUp` 判断：
    - 持续时间小于 `200ms`。
    - 移动距离小于阈值，例如 `6px`。
    - 没有命中目标节点。
- 满足短按条件时打开连接创建菜单。
- 从连接点创建新节点时按方向落位：
    - 从右侧 `source` 创建：新节点放在源节点右侧。
    - 从左侧 `target` 创建：新节点放在源节点左侧。
- 间距按本项目节点尺寸计算，不复制 TwitCanva 固定 `340 / GAP 100`。
- 创建后继续写入本项目 `connections`。

### 分组工具条中文化

实现状态：已实现。

当前差异：

- 本项目分组交互完整，但部分默认文案仍是英文。

迁移入口：

- `web/src/app/(user)/canvas/components/canvas-selection-bounding-box.tsx`
- `web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`

实现说明：

- `New Group` 改为“新分组”。
- `Group` 改为“分组”。
- `Sort` 改为“排序”。
- `Horizontal` 改为“横向”。
- `Vertical` 改为“纵向”。
- `Grid` 改为“网格”。
- `Ungroup` 改为“取消分组”。

只改文案，不改分组数据结构。

### 图片预览弹窗内部缩放

实现状态：已实现。

当前差异：

- TwitCanva 媒体预览弹窗支持内部滚轮缩放。
- 本项目图片详情弹窗目前只展示静态图片。

迁移入口：

- `web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`

实现说明：

- 给图片详情 Modal 增加局部 `previewScale` 状态。
- 弹窗内部 `onWheel`：
    - `event.preventDefault()`。
    - `event.stopPropagation()`。
    - 调整 `previewScale`。
- 图片使用 `transform: scale(...)` 或按最大宽高计算缩放。
- 可先只支持图片，视频仍使用原生 controls。

## 第二批：需要单独确认的迁移

第二批会影响业务规则或跨组件状态，迁移前需要先确认设计。

### 连接类型校验矩阵

当前差异：

- TwitCanva 有一套节点类型连接规则。
- 本项目当前连接规则主要只禁止配置节点互连，其余连接基本允许。

迁移入口：

- `web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`
- `normalizeConnection`
- `CanvasNodeType`

迁移原则：

- 不直接复制 TwitCanva 规则。
- 按本项目节点类型重新定义：
    - `Text`
    - `Image`
    - `Video`
    - `Audio`
    - `Config`
    - `ImageEditor`
    - `VideoEditor`
    - `Storyboard`
    - `CameraAngle`
    - `LocalImageModel`
    - `LocalVideoModel`
- 继续保留 `Config -> 生成节点` 的现有能力，因为它已经参与本项目生成上下文。
- 非法连接给出明确中文提示，例如“音频节点暂不能作为图片生成输入”。

建议实现：

- 新增 `isValidCanvasConnection(fromType, toType)`。
- `normalizeConnection` 只负责方向归一。
- 连接校验和错误提示放在 `connectNodes` / `createConnectedNode` 调用处。

### 节点内容拖拽到助手作为附件

当前差异：

- TwitCanva 可以把节点图片或视频拖入 ChatPanel 作为附件。
- 本项目助手引用主要来自选中节点；节点图片当前不可拖拽。

迁移入口：

- `web/src/app/(user)/canvas/components/canvas-node.tsx`
- `web/src/app/(user)/canvas/components/canvas-assistant-panel.tsx`
- `web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`

轻量方案：

- 节点内容开始拖拽时写入 `dataTransfer`：
    - `nodeId`
    - `nodeType`
- 助手面板 `drop` 后把该节点加入 `selectedNodeIds`。
- 复用现有助手引用 chips。

完整方案：

- 给 `CanvasAssistantPanel` 增加独立附件状态。
- 拖入附件只影响当前输入，不改变画布选择。
- 发送消息时把附件写入当前消息 references。

建议：

- 和 `web/CHAT_WINDOW_POPUP_MIGRATION_PLAN.md` 合并设计。
- 优先做轻量方案，确认交互有效后再决定是否引入独立附件状态。

### 素材库 panel 形态和面板互斥

当前差异：

- TwitCanva 的 Workflow、Assets、History、Chat 面板有互斥关系。
- 本项目目前主要使用素材选择 Modal，助手侧栏可同时存在。

迁移入口：

- `web/src/app/(user)/canvas/components/asset-picker-modal.tsx`
- `web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`
- `CanvasLeftMenu`
- `CanvasToolbar`

建议：

- 如果保留本项目当前风格，不需要迁移 TwitCanva 面板互斥。
- 如果要改成侧栏/浮层素材库，需要先决定：
    - 打开素材库是否收起助手。
    - 素材库是固定侧栏、浮层，还是继续 Modal。
    - 历史生成记录是否并入“我的素材”。

当前建议保留 Modal，不做第二套面板系统。

### 粘贴落点策略

当前差异：

- TwitCanva 粘贴使用固定偏移。
- 本项目粘贴会把复制内容放到当前视口中心。

建议：

- 不迁移 TwitCanva 固定偏移。
- 本项目当前“粘贴到视口中心”更符合无限画布体验。
- 继续区分两个动作：
    - “复制一份”：在原节点附近偏移。
    - “粘贴”：放到当前视口中心。

## 第三批：暂缓迁移的大模块

以下内容不是基础画布交互，不能简单复制。后续如要做，应单独立项。

### 完整图片编辑器

TwitCanva 图片编辑器包含：

- 选择工具。
- 画笔工具。
- 裁剪工具。
- 文字工具。
- 箭头工具。
- 编辑器内部历史。

本项目已有裁剪、蒙版、拆分、放大、角度变化等单点工具，但还不是完整编辑器。

暂缓原因：

- 需要独立画布编辑状态。
- 需要确定编辑结果如何回写节点。
- 需要确定编辑历史是否进入主画布历史。
- 需要和当前图片节点工具栏整合。

### 视频编辑器时间轴

TwitCanva 视频编辑器包含：

- 播放/暂停。
- 跳到开头/结尾。
- 拖拽 playhead。
- 拖拽 trim start / trim end。
- 导出裁剪结果并回写节点。

暂缓原因：

- 需要视频时间轴 UI。
- 需要文件裁剪和导出策略。
- 需要明确浏览器本地处理还是后端处理。

### Storyboard 生成和批量视频

TwitCanva Storyboard 包含：

- 多步故事板生成。
- 自动创建多个图片节点。
- 自动分组并写入 `storyContext`。
- 基于组内图片批量生成视频。
- 新视频节点整体放到故事板组右侧，并保持相对布局。

本项目已有 `Storyboard` 节点类型，但尚未形成完整故事板工作流。

暂缓原因：

- 需要先定义本项目 `storyContext` 数据结构。
- 需要和本项目生成队列、批量节点、分组工具条统一设计。

### Workflow、远端保存和自动保存

TwitCanva 有远端 Workflow、dirty 状态、手动保存、60 秒自动保存。

本项目当前画布主要保存在浏览器本地，使用 localforage 持久化。

暂缓原因：

- 两者保存模型不同。
- 当前不应引入 TwitCanva workflow API。
- 如果未来要做云端画布，应重新设计项目、版本、保存和恢复模型。

### 生成恢复和视频最后帧提取

TwitCanva 支持刷新后恢复生成中节点，并给视频补 last frame。

本项目当前更简单：刷新后把 loading 节点标记为失败，提示用户重新生成。

暂缓原因：

- 需要生成任务 ID。
- 需要轮询或恢复协议。
- 需要视频 metadata 补全策略。
- 属于生成系统能力，不是基础 UI 交互。

### TikTok 导入、X/TikTok 发布

TwitCanva 集成 TikTok 导入和 X/TikTok 发布。

暂缓原因：

- 依赖外部平台授权。
- 依赖平台发布接口。
- 与本项目当前基础画布交互关系不大。

## 不要直接复制的内容

- 不复制 TwitCanva 节点尺寸常量，例如 `340 / 365 / 385 / 500 / GAP 100`。
- 不复制 TwitCanva `parentIds` 连接模型，本项目继续使用独立 `connections`。
- 不复制 TwitCanva 只判断 `Ctrl` 的快捷键逻辑，本项目保持 `Ctrl/Cmd` 都支持。
- 不复制 TwitCanva Workflow、TikTok、X、Storyboard 等业务 API。
- 不为了兼容 TwitCanva 写旧字段兼容或数据迁移，本项目尚未上线，按本项目当前结构直接设计。

## 推荐迁移顺序

第一批：

1. 已完成：普通滚轮平移，`Ctrl/Cmd + wheel` 和触控板捏合缩放。
2. 已完成：节点内部滚轮和指针事件隔离。
3. 已完成：快捷键弹窗文案调整。
4. 已完成：右键空白画布全局菜单。
5. 已完成：节点右键菜单补齐和中文化。
6. 已完成：连接点短按打开添加菜单。
7. 已完成：分组工具条中文化。
8. 已完成：图片预览弹窗内部缩放。

第二批：

1. 连接类型校验矩阵。
2. 节点内容拖拽到助手作为附件。
3. 是否保留素材库 Modal 或改为侧栏/浮层。

第三批：

1. 完整图片编辑器。
2. 视频编辑器时间轴。
3. Storyboard 生成和批量视频。
4. 云端 Workflow 或远端画布保存。
5. 生成恢复。
6. 平台导入和发布。
