# 画布前端重构综合指南：infinite-canvas 与 TwitCanva 对比吸收版

本文档基于当前 `infinite-canvas` 画布前端代码、历史对比材料和 TwitCanva 画布源码，作为后续重构 `infinite-canvas` 画布前端时的工作指南：

- `web/src/app/(user)/canvas/` 当前实现
- 历史对比材料：`docs/canvas-client-page-hooks-refactor.md`、`docs/canvas-frontend-comparison-twitcanva.md`
- 对 `/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src` 中画布相关源码的补充阅读

注意：历史对比材料只作为背景来源，后续执行不要依赖它们仍然存在；一切以当前项目代码为准。

目标不是重新比较两个项目谁更好，而是沉淀一个可执行结论：当前项目应该保留什么、从 TwitCanva 学什么、哪些东西坚决不要搬、下一步按什么顺序拆。

## 一句话结论

`infinite-canvas` 应继续作为主线画布底座；TwitCanva 应作为视频工作流、分组交互和 hook 拆分边界的参考库。

当前项目赢在：

- 画布数据结构更适合长期维护。
- 节点保存真实 `position / width / height`，适合无限画布命中、框选、连线、缩放和视口裁剪。
- 已与 Next.js App Router、Ant Design、Tailwind、Zustand、localforage、素材库、AI 配置、导入导出、本地媒体存储融合。
- 已有项目级 `groups` 持久化、分组选框、重命名、取消分组和排序，不再是空白能力。
- 已有 `ImageEditor`、`VideoEditor`、`Storyboard`、`CameraAngle`、本地模型节点类型占位，但多数内容仍是 `UnknownNodeContent`，应视为待实现入口。
- 不强绑定某个 Node 后端，更适合未来接入新的后端。

TwitCanva 赢在：

- 短视频创作链路更丰富。
- storyboard、分组、首尾帧、视频链式生成、图片/视频编辑器等产品形态更完整。
- 画布交互被拆成一组命名清楚的 hooks，适合参考当前项目大文件拆分。

因此后续路线应是：

1. 保留当前项目的数据结构、真实尺寸命中、持久化和技术栈。
2. 参考 TwitCanva 的功能域边界和产品形态。
3. 按当前项目规范重写/吸收需要的能力。
4. 不整体迁移 TwitCanva 的数据结构、后端接口和固定宽高算法。

## 当前项目最大问题

当前画布前端最大维护压力来自：

```text
web/src/app/(user)/canvas/[id]/canvas-client-page.tsx
```

该文件当前约 3600 行，集中承担了太多职责：

- 页面挂载壳
- 项目加载、恢复、保存、删除、重命名
- 节点、连线、分组、聊天会话、主题、视口状态
- 历史栈撤销/重做
- 视口转换、缩放、重置视图
- 节点创建、删除、复制、粘贴、清空
- 分组创建、重命名、取消分组、排序、分组选框拖拽
- 节点拖拽、框选、多选
- 连线拖拽、吸附、创建、删除、右键菜单
- 文件上传、拖入、系统剪贴板读取
- 图片裁剪、切图、局部编辑、放大、换角度、反推提示词
- 图片、视频、音频、文本生成和重试
- 画布助手插入图片/文本
- 素材库插入
- 顶栏、底部工具栏、缩放控件、小地图、节点 hover toolbar、各类弹窗组合
- 一批页面内类型、常量和纯工具函数

当前项目并不是完全没有拆分，已经有一些可延续的边界：

- `components/canvas-node-generation.ts` 负责生成上下文、输入解析和聊天消息构造。
- `hooks/use-text-node-handlers.ts` 负责文本节点发散到图片/视频的轻量工作流。
- `hooks/use-image-node-handlers.ts` 负责图片节点发散到视频的轻量工作流。
- `components/canvas-selection-bounding-box.tsx` 已承接分组选框 UI。
- `stores/use-canvas-store.ts` 已承接项目级持久化，且包含 `groups` 字段。
- `components/infinite-canvas.tsx` 已承接底层平移、滚轮和触控板缩放。

后续重构应延续这些已存在的边界，避免重新发明一套并行结构。

重构目标不是重写画布，而是把它从“所有逻辑集中组件”改成“页面编排组件”。

页面组件应保留：

- 路由参数和页面壳
- 主题和基础布局
- 顶栏、工具栏、弹窗组合
- 跨 hook 的 glue code
- 少量必须留在页面层的状态

hooks / utils 应承接：

- 状态读写
- 事件逻辑
- 历史
- 视口
- 连线
- 拖拽
- 框选
- 剪贴板
- 快捷键
- 文件节点
- 图片节点动作
- 生成流程

## TwitCanva 结构上真正可取的地方

### 1. hook 职责边界清楚

TwitCanva 的 `App.tsx` 仍然很大，但它把核心画布交互拆成了一批清楚的 hooks：

```text
src/hooks/useCanvasNavigation.ts
src/hooks/useNodeManagement.ts
src/hooks/useNodeDragging.ts
src/hooks/useConnectionDragging.ts
src/hooks/useSelectionBox.ts
src/hooks/useGroupManagement.ts
src/hooks/useHistory.ts
src/hooks/useGeneration.ts
src/hooks/useWorkflow.ts
```

这些 hook 的方向值得当前项目参考：

| TwitCanva hook | 当前项目可对应拆分 |
| --- | --- |
| `useCanvasNavigation` | `use-canvas-viewport` |
| `useNodeManagement` | `use-canvas-project-state` / 页面节点动作 |
| `useNodeDragging` | `use-canvas-selection-drag` |
| `useConnectionDragging` | `use-canvas-connections` |
| `useSelectionBox` | `use-canvas-selection-drag` |
| `useGroupManagement` | 抽出现有分组逻辑为 `use-canvas-groups` |
| `useHistory` | `use-canvas-history` |
| `useGeneration` | `use-canvas-generation` |
| `useWorkflow` | 只参考面板概念，不搬后端保存逻辑 |

当前项目拆 `canvas-client-page.tsx` 时，可以学习这个“领域命名”，但内部实现必须沿用当前项目的数据结构和真实尺寸。

### 2. 节点 UI 有外壳、内容、控制区、连接点的分层意识

TwitCanva 节点相关组件大致是：

```text
CanvasNode
  NodeConnectors
  NodeContent
  NodeControls
  ChangeAnglePanel
```

这个层次有可取之处：

- `CanvasNode` 做节点外壳、标题、特殊节点分支、拖拽入口。
- `NodeConnectors` 做左右连接点。
- `NodeContent` 做图片、视频、文本、上传、结果展示。
- `NodeControls` 做 prompt、模型、比例、分辨率、时长、高级参数。
- `ChangeAnglePanel` 做特定图片工具。

当前项目后续如果继续增强节点工具，不应把所有内容都塞进一个节点组件里。可以参考这个方向，把节点拆成“外壳、媒体内容、控制面板、工具动作”几个层次。

当前项目的 `CanvasNode` 已经有 `NodeContent` 和 `nodeContentRenderers`，这个方向可以继续推进；但 `ImageEditor`、`VideoEditor`、`Storyboard`、`CameraAngle`、本地模型节点目前仍使用 `UnknownNodeContent`，后续实现时应按真实产品能力补内容，不要新增只换名字的简单转发组件。

还要注意：TwitCanva 的 `CanvasNode.tsx` 和 `NodeControls.tsx` 本身已经过重，分别接近千行和一千四百行左右。它的分层方向值得学，文件体量不值得学。

### 3. 分组是一套完整产品交互

TwitCanva 的分组能力值得重点参考：

```text
src/hooks/useGroupManagement.ts
src/components/canvas/SelectionBoundingBox.tsx
src/types.ts -> NodeGroup
```

它提供了比较完整的闭环：

- 多选节点。
- 显示 selection bounding box。
- 创建分组。
- 分组后显示组框和标签。
- 重命名分组。
- 取消分组。
- 横向、纵向、网格排序。
- 分组与 storyboard / 批量视频入口结合。

当前项目已经有分组的第一版实现：

- `CanvasProject.groups`
- `CanvasNodeData.groupId`
- `CanvasNodeGroup`
- `CanvasSelectionBoundingBox`
- 多选分组、取消分组、重命名、横向/纵向/网格排序
- 分组进入项目保存和撤销/重做历史

因此后续不是“从零新增分组”，而是把现有分组逻辑从 `canvas-client-page.tsx` 中抽出来，并继续补齐 storyboard / 批量工作流需要的 `storyContext` 或 metadata。底层必须继续沿用当前项目自己的几何模型：

- 使用 `CanvasNodeData.position`
- 使用 `CanvasNodeData.width`
- 使用 `CanvasNodeData.height`
- 分组选框基于真实节点尺寸计算。
- 排列时考虑图片、视频、音频、配置节点不同尺寸。
- 分组操作进入撤销/重做历史。
- 分组不能破坏已有 `CanvasConnection`。
- 复制/粘贴节点时当前实现会清掉 `groupId`，如果未来希望复制分组，需要显式设计 `CanvasClipboard` 是否保存 group。

不要照搬 TwitCanva 中基于 `340`、`365`、`385`、`500` 等固定宽度估算的包围盒逻辑。

### 4. storyboard 到视频的工作流值得吸收

TwitCanva 更像短视频工作台，它的工作流方向是：

```text
故事/角色/场景
-> storyboard scenes
-> 分镜图片
-> 图片节点组
-> 批量图片转视频
-> 视频裁剪/导出
-> 素材复用/发布
```

当前项目如果未来强化视频创作，可以借鉴：

```text
src/hooks/useStoryboardGenerator.ts
src/components/modals/StoryboardGeneratorModal.tsx
src/components/modals/StoryboardVideoModal.tsx
```

当前项目已经有 `CanvasNodeType.Storyboard` 和默认尺寸占位，但内容层还是 `UnknownNodeContent`。后续 storyboard 不建议直接变成一个强绑定后端的大节点，更好的设计是：

- Storyboard 是前端编排器。
- 生成脚本后创建多个文本节点或配置节点。
- 每个 scene 可以创建图片节点，并自动连到对应配置节点。
- 之后批量创建视频节点，连接对应图片节点。
- Storyboard group 可以存在于分组 `storyContext` 或 metadata 中。
- 不引入 TwitCanva 那种根级大而全的 `NodeData` 字段。

### 5. 视频首尾帧和链式生成语义值得参考

TwitCanva 的视频节点字段中有一些有价值的语义：

- `lastFrame`
- `frameInputs`
- `videoMode: "standard" | "frame-to-frame" | "motion-control"`
- `videoDuration`
- `generateAudio`

这些概念适合当前项目未来支持：

- 图生视频。
- 首帧/尾帧视频生成。
- 视频生成后抽最后一帧作为下游输入。
- 多场景视频链式生成。
- motion reference / motion control。

但当前项目不要照搬 `parentIds`，因为当前项目已有独立 `CanvasConnection`。建议设计为：

```ts
type VideoFrameMetadataPatch = {
    frameRole?: "start" | "end";
    lastFrameStorageKey?: string;
    lastFrameUrl?: string;
    videoMode?: "standard" | "frame-to-frame" | "motion-control";
};
```

或由配置节点 / 连线顺序表达输入角色：

```text
Image A -- start frame --> Video
Image B -- end frame   --> Video
Text    -- prompt      --> Video
```

当前 `CanvasNodeMetadata` 已有 `generateAudio`、`seconds`、`vquality`、`watermark`、`storageKey`、`durationMs` 等媒体字段，新增视频语义时优先少量扩展现有 metadata；只有字段明显成组且会继续增长时，再考虑嵌套 `metadata.video`。

抽帧结果必须写入当前项目媒体存储，`lastFrameUrl` 只能作为远程资源兜底或展示缓存，不要只保留临时 URL。

### 6. 生成逻辑独立 hook 的方向值得学

TwitCanva 的 `useGeneration` 把生成入口收束到 `handleGenerate`，统一处理：

- 从连接的文本节点收集 prompt。
- 从父图节点收集多图参考。
- 从 storyboard 角色图收集参考。
- 根据节点类型走图片、视频、本地模型等分支。
- 成功后写回节点状态和结果。

当前项目已经有：

```text
components/canvas-node-generation.ts
hooks/use-text-node-handlers.ts
hooks/use-image-node-handlers.ts
canvas-client-page.tsx -> handleGenerateNode / handleRetryNode
```

当前项目生成能力更贴合自身配置体系，也已经把部分“节点发散工作流”和“生成输入构造”拆出去了；但 `handleGenerateNode` / `handleRetryNode` 仍然过大。后续可以抽成：

```text
web/src/app/(user)/canvas/[id]/hooks/use-canvas-generation.ts
```

拆分原则：

- 第一轮只搬出行为，不改算法。
- 不改变现有 API 调用行为。
- 不改变节点 metadata 和持久化格式。
- 继续使用当前项目的 `buildNodeGenerationContext`、`buildNodeGenerationInputs`、`buildNodeChatMessages` 等已有函数。
- 继续保留 `buildCanvasResourceReferences`、`buildNodeMentionReferences` 与配置节点 `@` 引用语义。
- 最后再考虑吸收 TwitCanva 的 `lastFrame`、`frameInputs`、storyboard references 等概念。

### 7. 面板状态可以独立管理

TwitCanva 有 `usePanelState` 管理：

- history panel
- chat panel
- asset library panel
- expanded media modal
- 节点拖入聊天面板状态

当前项目已有 `useCanvasUiStore`，但它主要服务画布库页面的项目选择、重命名和删除状态，不适合继续塞详情页所有浮层。详情页如果后续出现更多侧栏和浮层，例如：

- 画布助手
- 素材库
- 历史面板
- storyboard 面板
- 生成任务面板
- 节点详情面板

可以考虑增加页面私有 UI hook，专门处理面板开关、互斥关闭、定位和折叠，不要继续混在节点、连线、生成逻辑里。

## 不建议从 TwitCanva 迁移的部分

以下内容不要直接迁移：

- `NodeData` 整体结构。
- `App.tsx` 总控结构。
- `NodeControls.tsx` 中大量模型硬编码。
- `http://localhost:3001` 工作流保存/加载逻辑。
- Twitter / TikTok 发布逻辑。
- 本地模型管理逻辑。
- face-api 人脸检测逻辑。
- 固定节点宽高命中算法。
- 直接依赖 `server/index.js` 的功能。

原因：

- 用户未来会接另一个后端，不用 TwitCanva 后端。
- 当前项目已有自己的 API、素材、配置、主题、存储、导入导出体系。
- TwitCanva 的 `NodeData` 根级字段过多，后续维护成本高。
- 固定宽高算法会破坏当前项目真实尺寸画布的优势。
- 直接迁移会引入大量无关依赖和旧模型协议耦合。

## 推荐新增的页面私有结构

当前项目应优先在页面目录下新增详情页私有 hooks，而不是塞进全局 `hooks/`。但已经存在的 `web/src/app/(user)/canvas/hooks/` 可继续放真正跨页面或跨节点复用的轻量工作流，例如文本节点、图片节点发散动作。

```text
web/src/app/(user)/canvas/[id]/canvas-page-types.ts
web/src/app/(user)/canvas/[id]/canvas-page-utils.ts
web/src/app/(user)/canvas/[id]/hooks/use-latest-canvas-refs.ts
web/src/app/(user)/canvas/[id]/hooks/use-canvas-project-state.ts
web/src/app/(user)/canvas/[id]/hooks/use-canvas-history.ts
web/src/app/(user)/canvas/[id]/hooks/use-canvas-viewport.ts
web/src/app/(user)/canvas/[id]/hooks/use-canvas-connections.ts
web/src/app/(user)/canvas/[id]/hooks/use-canvas-selection-drag.ts
web/src/app/(user)/canvas/[id]/hooks/use-canvas-groups.ts
web/src/app/(user)/canvas/[id]/hooks/use-canvas-clipboard.ts
web/src/app/(user)/canvas/[id]/hooks/use-canvas-keyboard-shortcuts.ts
web/src/app/(user)/canvas/[id]/hooks/use-canvas-file-nodes.ts
web/src/app/(user)/canvas/[id]/hooks/use-canvas-image-actions.ts
web/src/app/(user)/canvas/[id]/hooks/use-canvas-generation.ts
web/src/app/(user)/canvas/[id]/hooks/use-canvas-panels.ts
```

这些不需要一次全部创建。建议按风险从低到高逐步拆。

## 第一阶段：只做低风险拆分

第一阶段目标：让 `canvas-client-page.tsx` 明显瘦身，但不改变行为。

优先拆：

1. 类型、常量、纯函数。
2. latest refs 同步。
3. 项目加载和持久化 effects。
4. 历史栈。
5. 视口和坐标换算。
6. 连接逻辑。
7. 框选和拖拽。
8. 现有分组逻辑。
9. 剪贴板和快捷键。
10. 详情页面板开关状态。

暂缓拆：

- 生成逻辑。
- 图片工具。
- 素材插入。
- 画布助手插入。
- storyboard / 分组 metadata / 视频链式生成等新增能力。

这些暂缓项依赖 API、message、节点 metadata、连线、配置弹窗和文件存储，耦合更高，应在基础结构稳定后再动。

## 第一阶段具体拆分建议

### 1. `canvas-page-types.ts`

迁移页面私有类型：

- `CanvasClipboard`
- `PendingConnectionCreate`
- `AddNodesMenuState`
- `ConnectionDropTarget`
- `CanvasHistoryEntry`

原则：

- 只迁移页面私有类型。
- 已经在 `web/src/app/(user)/canvas/types.ts` 中稳定复用的类型不要挪。
- `CanvasHistoryEntry` 当前必须包含 `groups`、`chatSessions`、`activeChatId`、`backgroundMode`、`showImageInfo`。
- 不趁机改数据结构。

### 2. `canvas-page-utils.ts`

迁移页面私有常量和纯函数：

- `VIDEO_NODE_MAX_WIDTH`
- `VIDEO_NODE_MAX_HEIGHT`
- `CONNECTION_HANDLE_HIT_RADIUS`
- `CONNECTION_NODE_HIT_PADDING`
- `CONNECTION_TAP_MS`
- `CONNECTION_TAP_MOVE_PX`
- `CONNECTED_NODE_GAP`
- `NODE_STATUS_LOADING`
- `NODE_STATUS_SUCCESS`
- `NODE_STATUS_ERROR`
- `IMAGE_PROMPT_REVERSE_PRESET`
- `createCanvasNode`
- `imageMetadata`
- `videoMetadata`
- `buildGenerationConfig`
- `resetInterruptedGeneration`
- `hydrateCanvasImages`
- `hydrateAssistantImages`
- `applyNodeConfigPatch`
- `normalizeConnection`
- `getConnectionTargetAnchor`
- `isHiddenBatchChild`
- `isHiddenBatchConnectionEndpoint`

原则：

- 第一轮只移动，不重写。
- 保持函数签名和返回结构。
- 不改变持久化格式。

### 3. `use-latest-canvas-refs.ts`

负责维护拖拽、连线、键盘事件需要的最新 refs。

建议输入：

```ts
{
    nodes,
    connections,
    groups,
    selectedNodeIds,
    viewport,
    connectingParams,
    connectionTargetNodeId,
    selectionBox,
    pendingConnectionCreate,
}
```

建议返回：

```ts
{
    nodesRef,
    connectionsRef,
    groupsRef,
    selectedNodeIdsRef,
    viewportRef,
    connectingParamsRef,
    connectionTargetNodeIdRef,
    selectionBoxRef,
    pendingConnectionCreateRef,
}
```

注意：

- 继续使用 `useLayoutEffect` 同步。
- 不要改成普通 `useEffect`，避免 pointer / keyboard 事件读到旧状态。

### 4. `use-canvas-project-state.ts`

负责项目级数据：

- `nodes`
- `connections`
- `groups`
- `chatSessions`
- `activeChatId`
- `backgroundMode`
- `showImageInfo`
- `projectLoaded`
- `currentProject`
- 项目加载 effect
- 项目保存 effect
- 视口保存 debounce

第一版可以只抽“项目加载和保存 effects”，其他动作暂时留在页面。

风险点：

- 加载项目时会调用 `hydrateCanvasImages(resetInterruptedGeneration(project.nodes))`。
- 加载聊天会话时会调用 `hydrateAssistantImages(project.chatSessions || [])`。
- 加载和保存都必须包含 `groups`，当前 `CanvasProject` 已有项目级 `groups` 字段。
- 持久化时要保存 `nodes / connections / groups / chatSessions / activeChatId / backgroundMode / showImageInfo`。
- 视口保存目前有 debounce，不要改变节奏。

### 5. `use-canvas-history.ts`

负责：

- `historyRef`
- `lastHistoryRef`
- `historyCommitTimerRef`
- `applyingHistoryRef`
- `historyPausedRef`
- `historyState`
- `createHistoryEntry`
- `applyHistory`
- `undoCanvas`
- `redoCanvas`
- 初始历史重置

原则：

- 撤销/重做必须同时覆盖节点、连线和必要项目状态。
- 当前历史项已经覆盖 `groups`，抽离时不能漏掉。
- 不能把正在应用历史的状态再次写入历史栈。
- 拖拽中可以合并历史提交，避免每一帧都入栈。

### 6. `use-canvas-viewport.ts`

负责：

- 视口状态。
- screen/world 坐标转换。
- 缩放。
- 重置视图。
- 视口 bounds / 可见区域计算。

TwitCanva 的 `useCanvasNavigation` 可以参考职责边界，但不要照搬其中根据固定节点尺寸做 zoom cap 的逻辑。

当前项目应继续使用：

- 当前项目已有的坐标转换逻辑。
- 当前项目真实节点尺寸。
- 当前项目视口裁剪逻辑。
- `InfiniteCanvas` 中已有的平移、滚轮、触控板捏合缩放和 wheel ignore 规则；抽离时不要让页面 hook 与组件内部手势逻辑互相重复。

### 7. `use-canvas-connections.ts`

负责：

- 连线拖拽状态。
- 起点/终点计算。
- 命中检测。
- 连线创建。
- 连线删除。
- 右键菜单。
- 空白处放开时创建节点菜单。

可以参考 TwitCanva `useConnectionDragging` 的职责边界，但不要搬：

- `parentIds` 数据模型。
- 固定宽高命中。
- 旧模型连接规则。

当前项目应继续使用：

- `CanvasConnection`
- `CanvasNodeData.position / width / height`
- 当前项目的连接吸附和真实节点命中。

### 8. `use-canvas-selection-drag.ts`

负责：

- 单选、多选。
- 节点拖拽。
- 多选拖拽。
- 框选。
- selection box。
- 分组选框拖拽入口可以保留在这里，分组增删改排建议交给 `use-canvas-groups`。

TwitCanva `useNodeDragging` 和 `useSelectionBox` 的边界值得参考，但算法必须改成当前项目真实尺寸。

### 9. `use-canvas-groups.ts`

负责：

- `groups`
- `getCommonGroup`
- `groupSelectedNodes`
- `ungroupNodes`
- `renameGroup`
- `sortGroupNodes`
- 分组节点列表同步和孤儿 `groupId` 清理

原则：

- 这是抽出现有能力，不是新增数据模型。
- 继续使用项目级 `CanvasProject.groups` 和节点级 `CanvasNodeData.groupId`。
- 分组排序继续基于真实节点尺寸和当前位置。
- 分组变更必须被项目保存和历史栈捕获。
- 如果未来扩展 storyboard metadata，先补 `CanvasNodeGroup` 类型，再同步导入导出和历史。

### 10. `use-canvas-clipboard.ts`

负责：

- 复制节点。
- 粘贴节点。
- 系统剪贴板图片读取。
- 画布内部 clipboard 格式。

原则：

- 保持当前 `CanvasClipboard` 格式。
- 保持节点 id、位置偏移、连线复制规则不变。
- 当前复制/粘贴不会保留分组，粘贴节点会清掉 `groupId`；除非明确要新增“复制分组”，否则第一轮不要改变这个行为。
- 不改变用户现有快捷键行为。

### 11. `use-canvas-keyboard-shortcuts.ts`

负责：

- Delete / Backspace 删除。
- Cmd/Ctrl + C 复制。
- Cmd/Ctrl + V 粘贴。
- Cmd/Ctrl + Z 撤销。
- Cmd/Ctrl + Shift + Z / Cmd/Ctrl + Y 重做。
- Escape 退出状态。

原则：

- 输入框、textarea、contenteditable 中不要误触发画布快捷键。
- 弹窗打开时不要误触发底层画布操作。
- 快捷键只调用外部传入动作，不直接知道太多节点业务。

### 12. `use-canvas-panels.ts`

负责详情页私有 UI 开关状态：

- `dialogNodeId`
- `editingNodeId`
- `infoNodeId`
- `cropNodeId`
- `maskEditNodeId`
- `splitNodeId`
- `upscaleNodeId`
- `superResolveNodeId`
- `angleNodeId`
- `previewNodeId`
- `assistantCollapsed`
- `assistantMounted`
- `titleEditing`
- `titleDraft`
- `addNodesMenu`
- `contextMenu`

原则：

- 只管理打开、关闭、互斥和必要的派生选择，不处理节点生成、文件上传、连线算法。
- 和 `useCanvasUiStore` 分开；`useCanvasUiStore` 当前服务画布库页面，详情页私有弹窗不应塞进去。
- 如果某个弹窗只属于图片动作，例如裁剪、遮罩、放大，也可以先留在 `use-canvas-image-actions`，不要为了统一面板状态制造更复杂的依赖。

## 第二阶段：生成和图片动作拆分

当基础 hooks 稳定后，再拆高耦合逻辑。

### `use-canvas-generation.ts`

负责：

- `handleGenerateNode`
- `handleRetryNode`
- 生成前上下文构造。
- 图片、视频、音频、文本生成分支。
- 生成状态更新。
- 生成结果写入节点。
- 错误处理。

原则：

- 第一版只搬迁，不重写。
- 继续使用当前项目已有 generation utils。
- 不引入 TwitCanva 服务调用。
- 后续再吸收首尾帧、last frame、storyboard references。

### `use-canvas-image-actions.ts`

负责：

- 图片裁剪。
- 切图。
- 局部编辑。
- 放大/超分。
- 换角度。
- 反推提示词。
- 图生图。
- 图生视频。

可参考 TwitCanva：

```text
src/hooks/useImageNodeHandlers.ts
src/hooks/useImageEditor.ts
src/hooks/useImageEditorDrawing.ts
src/hooks/useImageEditorArrows.ts
src/hooks/useImageEditorText.ts
src/hooks/useImageEditorHistory.ts
src/hooks/useImageEditorCrop.ts
```

但当前项目结果仍应：

- 写入当前项目媒体存储。
- 创建新图片/视频节点。
- 与原节点建立当前项目的 `CanvasConnection`。
- 进入历史栈。

### `use-canvas-file-nodes.ts`

负责：

- 文件上传。
- 文件拖入画布。
- 图片/视频/音频 metadata 解析。
- 媒体存储。
- 创建对应节点。

原则：

- 继续使用当前项目文件存储服务。
- 不依赖 TwitCanva 后端文件路径。

## 第三阶段：吸收 TwitCanva 的视频工作流能力

这一阶段是新增能力，不应和第一阶段结构重构混在一起。

### 分组增强

```text
web/src/app/(user)/canvas/[id]/hooks/use-canvas-groups.ts
web/src/app/(user)/canvas/components/canvas-selection-bounding-box.tsx
```

当前项目已经有：

```ts
type CanvasNodeGroup = {
    id: string;
    nodeIds: string[];
    label: string;
    storyContext?: unknown;
};
```

如果要服务 storyboard / 批量视频工作流，可以把 `storyContext?: unknown` 改成明确结构，或按项目习惯改为 `metadata`：

```ts
type CanvasNodeGroup = {
    id: string;
    nodeIds: string[];
    label: string;
    storyContext?: {
        storyboard?: {
            story?: string;
            sceneCount?: number;
            styleAnchor?: string;
            characterRefs?: string[];
        };
    };
};
```

注意事项：

- 不需要重新评估是否项目级保存；当前 `CanvasProject.groups` 已经是项目字段。
- 仍要保留节点级 `groupId`，它让节点渲染和命中更直接。
- 导入导出当前导出整个 `CanvasProject`，会带上 `groups`；如果新增 group 内媒体引用字段，才需要额外检查 zip 媒体收集。
- 分组操作必须进入撤销/重做。
- 如果从“复制节点”扩展到“复制分组”，需要同步调整 `CanvasClipboard`，当前粘贴行为会清空 `groupId`。

### Storyboard

建议把 storyboard 设计为“创建节点的工作流”，不是强绑定后端的重型节点。

可能流程：

1. 打开 Storyboard 生成弹窗。
2. 输入故事、角色、场景数量、风格。
3. 生成 scenes。
4. 在画布中批量创建文本节点或配置节点。
5. 为每个 scene 创建图片节点，并自动连接对应 prompt/config。
6. 生成分镜图。
7. 批量创建视频节点，连接每张分镜图。
8. 可选创建 group，保存 storyboard metadata。

### 首尾帧 / 视频链式生成

建议先做最小闭环：

1. 视频节点支持 start frame 输入。
2. 视频节点支持 end frame 输入。
3. 视频生成后可抽取 last frame。
4. last frame 存入当前项目媒体存储。
5. 可以一键创建下游视频节点，并连接 last frame。

不要直接照搬 TwitCanva 的 `parentIds`。

## 当前项目与 TwitCanva 的结构对照

### 当前项目更适合保留的能力

- 通用无限画布基础交互。
- 真实节点尺寸。
- 视口裁剪。
- 节点缩放。
- 连线吸附。
- 图片、文本、配置、视频、音频五类基础节点。
- Storyboard、Image Editor、Video Editor、Camera Angle、本地模型节点类型占位。
- 项目级分组保存、分组选框、重命名、取消分组和排序。
- 批量图片生成后的图片组展示。
- 连接节点到配置节点后的资源引用解析。
- 生成上下文支持图片、视频、音频、文本资源编号。
- 画布助手会话和项目一起保存。
- localforage 本地持久化。
- zip 导入导出。
- 当前项目素材库和 AI 配置体系。

### TwitCanva 更适合作为参考的能力

- 画布 hooks 拆分边界。
- 分组 hook 和分组选框。
- 分组排序。
- storyboard 生成流程。
- storyboard 图片批量转视频。
- 图片编辑器的画笔、箭头、文字、裁剪、编辑历史。
- 视频编辑器的裁剪/导出。
- 视频 last frame 提取。
- 首帧/尾帧视频生成。
- 多图参考输入。
- 多面板工作台形态。

## 文件索引

### 当前项目主线文件

```text
/Users/a1/Desktop/infinite-canvas/web/src/app/(user)/canvas/[id]/canvas-client-page.tsx
/Users/a1/Desktop/infinite-canvas/web/src/app/(user)/canvas/types.ts
/Users/a1/Desktop/infinite-canvas/web/src/app/(user)/canvas/constants.ts
/Users/a1/Desktop/infinite-canvas/web/src/app/(user)/canvas/stores/use-canvas-store.ts
/Users/a1/Desktop/infinite-canvas/web/src/app/(user)/canvas/stores/use-canvas-ui-store.ts
/Users/a1/Desktop/infinite-canvas/web/src/app/(user)/canvas/components/infinite-canvas.tsx
/Users/a1/Desktop/infinite-canvas/web/src/app/(user)/canvas/components/canvas-node.tsx
/Users/a1/Desktop/infinite-canvas/web/src/app/(user)/canvas/components/canvas-connections.tsx
/Users/a1/Desktop/infinite-canvas/web/src/app/(user)/canvas/components/canvas-toolbar.tsx
/Users/a1/Desktop/infinite-canvas/web/src/app/(user)/canvas/components/canvas-node-hover-toolbar.tsx
/Users/a1/Desktop/infinite-canvas/web/src/app/(user)/canvas/components/canvas-config-node-panel.tsx
/Users/a1/Desktop/infinite-canvas/web/src/app/(user)/canvas/components/canvas-node-generation.ts
/Users/a1/Desktop/infinite-canvas/web/src/app/(user)/canvas/utils/canvas-resource-references.ts
/Users/a1/Desktop/infinite-canvas/web/src/app/(user)/canvas/utils/canvas-node-size.ts
/Users/a1/Desktop/infinite-canvas/web/src/app/(user)/canvas/utils/canvas-image-data.ts
/Users/a1/Desktop/infinite-canvas/web/src/app/(user)/canvas/utils/canvas-export.ts
```

### TwitCanva 可参考文件

```text
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/App.tsx
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/types.ts
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/components/canvas/CanvasNode.tsx
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/components/canvas/NodeContent.tsx
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/components/canvas/NodeControls.tsx
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/components/canvas/NodeConnectors.tsx
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/components/canvas/ConnectionsLayer.tsx
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/components/canvas/SelectionBoundingBox.tsx
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/hooks/useCanvasNavigation.ts
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/hooks/useNodeManagement.ts
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/hooks/useNodeDragging.ts
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/hooks/useConnectionDragging.ts
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/hooks/useSelectionBox.ts
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/hooks/useGroupManagement.ts
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/hooks/useHistory.ts
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/hooks/useGeneration.ts
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/hooks/useStoryboardGenerator.ts
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/hooks/useVideoFrameExtraction.ts
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/components/modals/StoryboardGeneratorModal.tsx
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/components/modals/StoryboardVideoModal.tsx
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/components/modals/ImageEditorModal.tsx
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow/src/components/modals/VideoEditorModal.tsx
```

## 重构执行 checklist

每次开始一个重构小步前，检查：

- 是否只改画布前端。
- 是否没有改后端。
- 是否没有改变持久化格式。
- 是否没有改变节点/连线行为。
- 是否没有漏保存或误清理 `groups` / `groupId`。
- 是否没有把页面私有状态塞进全局 store。
- 是否没有把 TwitCanva 的固定宽高算法搬进来。
- 是否没有引入 TwitCanva 的后端接口。
- 是否没有顺手重构无关模块。

每次完成一个小步后，检查：

- 页面能否继续读懂。
- hook 是否只负责一个领域。
- hook 返回的状态和动作是否足够页面渲染。
- 页面 JSX 是否比之前更接近编排层。
- 历史、拖拽、连线、框选、快捷键是否理论上保持行为不变。
- 分组、分组选框、分组排序、取消分组是否理论上保持行为不变。
- 新增文件是否放在 `web/src/app/(user)/canvas/[id]/hooks/`、页面私有 utils/types，或确实复用时放在 `web/src/app/(user)/canvas/hooks/` 中。

## 推荐重构顺序

建议按以下顺序逐步推进：

```text
1. canvas-page-types.ts
2. canvas-page-utils.ts
3. hooks/use-latest-canvas-refs.ts
4. hooks/use-canvas-viewport.ts
5. hooks/use-canvas-history.ts
6. hooks/use-canvas-connections.ts
7. hooks/use-canvas-selection-drag.ts
8. hooks/use-canvas-groups.ts
9. hooks/use-canvas-clipboard.ts
10. hooks/use-canvas-keyboard-shortcuts.ts
11. hooks/use-canvas-panels.ts
12. hooks/use-canvas-file-nodes.ts
13. hooks/use-canvas-image-actions.ts
14. hooks/use-canvas-generation.ts
15. 后续增强 storyboard / 视频链式生成能力
```

前 1-11 步是结构拆分，目标是低风险瘦身。

第 12-14 步开始触及文件、图片和生成逻辑，需要更谨慎。

第 15 步属于新增能力，应在基础重构稳定后再做。

## 最终目标状态

理想状态下，`canvas-client-page.tsx` 不需要完全消失，但应该变成：

- 页面壳。
- 页面级状态编排。
- hooks 组合。
- 顶栏、画布、工具栏、弹窗 JSX 组合。
- 少量跨领域 glue code。

画布核心行为应分布到：

```text
types.ts                     -> 跨画布类型
constants.ts                 -> 跨画布常量
stores/                      -> 项目级持久化和 UI store
utils/                       -> 跨组件纯工具
components/                  -> 画布视觉组件
[id]/canvas-page-types.ts    -> 页面私有类型
[id]/canvas-page-utils.ts    -> 页面私有工具
[id]/hooks/                  -> 页面私有交互、分组、面板和业务 hooks
```

TwitCanva 的价值是提醒我们：画布不只是一张无限白板，它还可以是一条视频创作流水线。但当前项目的优势是底座更稳。重构时要把这两件事分开：先稳底座，再吸收工作流。
