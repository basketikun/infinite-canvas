# Image 节点工作流迁移计划

## 背景

本计划参考 `/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow` 当前项目的 Image 节点交互逻辑，将其中适合 `infinite-canvas/web` 的部分迁移到目标项目画布中。

本轮范围按最新确认收窄：

```txt
只做 Image 节点
暂时不做 Video 节点
暂时不做 Image to Video
```

目标不是照搬 TwitCanva 的 `parentIds` 数据结构，也不是重写目标项目已有的图片生成、图片工具栏或图片编辑能力，而是在 `infinite-canvas/web` 现有 Next.js 画布结构上补齐一个更明确的 Image 工作流入口：

```txt
Image 节点内容区/菜单动作
  -> CanvasNode 把回调继续往上传
  -> canvas-client-page 挂载 useImageNodeHandlers
  -> useImageNodeHandlers 创建下游空 Image 节点和连接
  -> 用户在下游 Image 节点输入 prompt
  -> 点击下游 Image 节点 Generate
  -> canvas-node-generation 通过连接读取上游 Image 作为 referenceImages
  -> handleGenerateNode 调用 requestEdit
  -> 下游 Image 节点原地显示结果
```

## 当前结构观察

### TwitCanva 当前项目

相关文件主要是：

- `src/components/canvas/NodeContent.tsx`
- `src/components/canvas/NodeControls.tsx`
- `src/components/canvas/CanvasNode.tsx`
- `src/hooks/useImageNodeHandlers.ts`
- `src/hooks/useGeneration.ts`
- `src/types.ts`

TwitCanva 的 Image 节点有这些行为：

- 空 Image 节点内容区可显示操作入口。
- Image 节点可通过 `handleImageToImage` 创建右侧下游 Image 节点。
- 旧项目用 `parentIds` 表示节点输入关系。
- `useGeneration.ts` 会从 `parentIds` 查找上游 Image 节点，把上游图片作为 `imageBase64` 或 `imageBase64s` 传给生成服务。
- 上游 Text 节点提供 prompt，上游 Image 节点提供图片引用。
- Image to Image 动作只创建下游节点和连接，不立即生成。

TwitCanva 的核心逻辑简化为：

```ts
const newImageNode: NodeData = {
    id: newNodeId,
    type: NodeType.IMAGE,
    x: imageNode.x + NODE_WIDTH + GAP,
    y: imageNode.y,
    prompt: "",
    status: NodeStatus.IDLE,
    model: "Banana Pro",
    aspectRatio: "Auto",
    resolution: "Auto",
    parentIds: [nodeId],
};
```

迁移时不应照搬 `parentIds`，而是转为目标项目的 `CanvasConnection`。

### infinite-canvas 目标项目

目标项目画布核心文件是：

- `src/app/(user)/canvas/[id]/canvas-client-page.tsx`
- `src/app/(user)/canvas/components/canvas-node.tsx`
- `src/app/(user)/canvas/components/canvas-node-prompt-panel.tsx`
- `src/app/(user)/canvas/components/canvas-node-generation.ts`
- `src/app/(user)/canvas/components/canvas-node-hover-toolbar.tsx`
- `src/app/(user)/canvas/components/canvas-image-toolbar-tools.tsx`
- `src/app/(user)/canvas/types.ts`
- `src/app/(user)/canvas/constants.ts`

目标项目已有的重要能力：

- 节点类型使用 `CanvasNodeType.Image`。
- 图片内容保存在 `node.metadata.content`。
- 图片资源可能同时有 `metadata.storageKey`。
- 节点连接保存在独立数组 `CanvasConnection[]` 中：

```ts
export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
};
```

- `buildNodeGenerationInputs` 已能通过连接读取上游资源。
- `readReferenceImage` 已能把上游 Image 节点转换成 `ReferenceImage`。
- `buildNodeGenerationContext` 已能把上游 Image 放入 `referenceImages`。
- `handleGenerateNode` 的 image 分支已经支持：
  - 空 Image 节点原地生成。
  - 非空 Image 节点作为 source reference，生成右侧新 Image。
  - 有 `referenceImages` 时调用 `requestEdit`。
  - 无 `referenceImages` 时调用 `requestGeneration`。
  - 多图 count 生成和 batch root。
- 图片结果 hover toolbar 已有较多工具：
  - 复制提示词
  - 反推提示词
  - 替换图片
  - 局部编辑
  - 裁剪
  - 切图
  - 放大
  - 超分
  - 多角度
  - 查看大图

因此本次迁移不需要重写图片生成服务，也不需要重写现有图片结果工具栏。

## 目标交互

### Image to Image

用户在 Image 节点上选择 `Image to Image` 后：

1. 找到当前 Image 节点。
2. 在当前 Image 节点右侧创建一个空 Image 节点。
3. 创建一条连接：

```txt
Image -> Image
```

4. 新 Image 节点保持 idle，不立即生成。
5. 选中新 Image 节点，并打开它的生成面板。
6. 用户在新 Image 节点输入 prompt。
7. 点击 Generate 后：
   - 生成逻辑通过连接读取上游 Image。
   - 上游 Image 作为 `referenceImages`。
   - 新 Image 自己的 prompt 作为编辑指令。
   - 调用 `requestEdit`。
   - 新 Image 节点原地显示结果。

推荐事件流：

```txt
Image 节点菜单
  -> onImageToImage(node)
  -> CanvasNode props
  -> canvas-client-page
  -> useImageNodeHandlers.handleImageToImage
  -> 创建空 Image 子节点
  -> 创建 Image -> Image connection
  -> 选中新 Image 子节点并打开 prompt panel
  -> 用户输入编辑 prompt
  -> CanvasNodePromptPanel submit
  -> handleGenerateNode(child.id, "image", prompt)
  -> buildNodeGenerationContext 读取上游 Image
  -> requestEdit(...)
  -> 子 Image 节点原地显示生成结果
```

### 空 Image 节点的菜单

目标项目当前 `EmptyImageContent` 只显示：

```txt
空图片节点
```

建议改造成一个轻量操作菜单，第一阶段只放 Image 范围内的入口：

```txt
Try to:
  Upload Image
  Image to Image
```

说明：

- `Upload Image` 可复用目标项目已有上传逻辑，如果为了降低第一阶段改动，也可以先不放在内容区，只保留 hover toolbar 的上传入口。
- `Image to Image` 创建下游空 Image 节点和连接，不立即生成。
- `Image to Video` 暂时不显示，也不做 disabled 占位，避免用户误会本轮已支持 Video。

### 非空 Image 节点的入口

目标项目现在已经支持选中非空 Image 节点后，在生成面板里输入 prompt 并生成右侧新 Image。这个路径实际已经可以完成 Image to Image。

第一阶段推荐：

- 保留这个现有路径。
- 不急着在 hover toolbar 里新增 `以图生图` 工具，避免和现有 `编辑`、`局部编辑`、`反推提示词` 等工具产生概念重叠。
- 如果后续确认需要更显式的入口，再把 `Image to Image` 加入 `canvas-image-toolbar-tools.tsx` 的快捷工具系统。

## 关键设计原则

1. 不把 TwitCanva 的 `parentIds` 迁移到目标项目。
2. 目标项目继续使用 `CanvasConnection[]` 表达节点依赖。
3. 图片内容继续写在 `metadata.content`。
4. 图片文件元信息继续写在：

```ts
metadata.storageKey
metadata.naturalWidth
metadata.naturalHeight
metadata.bytes
metadata.mimeType
```

5. `Image to Image` 只创建下游空 Image 节点和连接，不立即调用接口。
6. 真正生成仍由下游 Image 节点自己的 `CanvasNodePromptPanel` 触发。
7. 生成时通过连接关系读取上游 Image，而不是把上游图片 URL 复制到子节点字段里。
8. 有上游 Image 时，下游 Image 的生成应走 `requestEdit`。
9. 子 Image 节点自己的 prompt 是编辑指令；上游 Image 是参考图。
10. 暂时不迁移 Video 相关能力，包括 `Image to Video`、视频模型筛选、motion control、frame-to-frame。
11. 不重复迁移目标项目已存在且更完整的图片工具栏能力。

## 拟新增或修改的文件

### 1. `src/app/(user)/canvas/hooks/use-image-node-handlers.ts`

新增 Image 节点动作 hook，承接 Image 节点工作流动作。

建议文件结构：

```txt
src/app/(user)/canvas/hooks/use-image-node-handlers.ts
```

核心 API：

```ts
export function useImageNodeHandlers({
    nodesRef,
    connectionsRef,
    setNodes,
    setConnections,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setDialogNodeId,
    effectiveConfig,
}: UseImageNodeHandlersOptions) {
    return {
        handleImageToImage,
    };
}
```

建议 options：

```ts
type UseImageNodeHandlersOptions = {
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    setNodes: (nodes: CanvasNodeData[]) => void;
    setConnections: (connections: CanvasConnection[]) => void;
    setSelectedNodeIds: (nodeIds: Set<string>) => void;
    setSelectedConnectionId: (connectionId: string | null) => void;
    setDialogNodeId: (nodeId: string | null) => void;
    effectiveConfig: AiConfig;
};
```

#### handleImageToImage

逻辑：

1. 只接受 `CanvasNodeType.Image`。
2. 从 `nodesRef.current` 读取最新 source Image 节点。
3. 创建一个空 Image 子节点，位置在 source 右侧：

```txt
x = source.position.x + source.width + 96
y = source.position.y + source.height / 2 - image.height / 2
```

4. 子节点 metadata 使用当前全局图片配置初始化：

```ts
{
    content: "",
    status: "idle",
    prompt: "",
    model: effectiveConfig.imageModel || effectiveConfig.model,
    size: effectiveConfig.size,
    quality: effectiveConfig.quality,
    count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
}
```

5. 创建连接：

```ts
{ fromNodeId: source.id, toNodeId: child.id }
```

6. 更新 source 节点：

```ts
metadata.linkedOutputNodeId = child.id;
```

这个字段 `types.ts` 里已经存在，可复用为通用下游节点记录；如果不想持久化该字段，也可以省略。

7. 更新 nodes / connections。
8. 选中新 Image 子节点：

```ts
setSelectedNodeIds(new Set([child.id]));
setSelectedConnectionId(null);
setDialogNodeId(child.id);
```

9. 不调用 `handleGenerateNode`，不请求生成接口。

#### 重复连接策略

如果每次点击都创建一个新子节点，则不会出现同一 child 的重复连接问题。

仍建议新增连接前使用防重逻辑：

```ts
const exists = connectionsRef.current.some(
    (connection) =>
        connection.fromNodeId === source.id &&
        connection.toNodeId === child.id,
);
```

如果后续支持“复用已有下游节点”，则必须检查：

```ts
connections.some(
    (connection) =>
        connection.fromNodeId === source.id &&
        connection.toNodeId === existingChild.id,
)
```

### 2. `src/app/(user)/canvas/components/canvas-node.tsx`

在 `CanvasNodeProps` 中新增 Image 动作回调：

```ts
onImageToImage?: (node: CanvasNodeData) => void;
```

在 `NodeContentRendererProps` 中继续传递：

```ts
onImageToImage?: (node: CanvasNodeData) => void;
```

然后传给内部 `EmptyImageContent` 或新的 `ImageNodeActionMenu`。

当前 `EmptyImageContent` 可以从：

```txt
图标
空图片节点
```

改成：

```txt
Try to:
  Upload Image
  Image to Image
```

推荐新增一个小组件：

```tsx
function ImageNodeActionItem(...)
```

风格可复用 `TextNodeActionItem` 的轻量菜单样式，避免再引入新的视觉系统。

第一阶段推荐最小改动：

- `Image to Image` 调用 `onImageToImage?.(node)`。
- `Upload Image` 如果接线成本较高，可以暂时不放在内容菜单里，继续使用 hover toolbar 的上传入口。
- 不显示 `Image to Video`。

需要注意：

- 当前 `NodeContentRendererProps` 没有 `isSelected` 字段。
- 如果希望空 Image 菜单只在选中时显示，可以把 `isSelected` 从 `CanvasNode` 传入 `NodeContent`。
- 如果不想增加 props，也可以让空 Image 节点始终显示菜单；这更接近 Text 空态菜单的体验。

### 3. `src/app/(user)/canvas/[id]/canvas-client-page.tsx`

挂载新 hook：

```ts
const { handleImageToImage } = useImageNodeHandlers({
    nodesRef,
    connectionsRef,
    setNodes,
    setConnections,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setDialogNodeId,
    effectiveConfig,
});
```

然后传给 `CanvasNode`：

```tsx
<CanvasNode
    ...
    onImageToImage={handleImageToImage}
/>
```

建议放置位置：

- import 放在 `useTextNodeHandlers` 附近。
- hook 调用放在 `useTextNodeHandlers` 附近。
- props 传递放在已有 `onTextToImage` / `onTextToVideo` 附近。

### 4. `src/app/(user)/canvas/components/canvas-node-prompt-panel.tsx`

第一阶段不必改。

当前提交逻辑：

```ts
const canSubmit = Boolean(prompt.trim() || canGenerateFromConnectedInputs);
```

页面层当前传入：

```tsx
canGenerateFromConnectedInputs={Boolean(
    generationInputsById
        .get(panelNode.id)
        ?.some((input) => input.type === "text" && input.text?.trim())
)}
```

这意味着：

- 有上游 Text 时，子 Image prompt 为空也能生成。
- 只有上游 Image 时，仍需要子 Image 自己的 prompt。

这对 Image to Image 是合理的，因为图片编辑通常需要“把这张图改成什么”的文字指令。除非后续产品希望支持“只给参考图，无 prompt 也生成变体”，否则不要改这里。

如果后续要支持纯 reference image 生成变体，可另行设计：

```ts
canGenerateFromConnectedInputs={Boolean(
    inputs.some((input) => input.type === "text" && input.text?.trim()) ||
    inputs.some((input) => input.type === "image")
)}
```

但这会改变空 prompt 的语义，建议本次不做。

### 5. `src/app/(user)/canvas/components/canvas-node-generation.ts`

第一阶段不必改。

当前能力已经满足 Image to Image：

- `buildNodeGenerationInputs` 会读取上游 Image。
- `readReferenceImage` 会把 Image 节点转成 `ReferenceImage`。
- `buildNodeGenerationContext` 会输出 `referenceImages`。

关键逻辑已经存在：

```ts
const referenceImages = inputs
    .map((input) => input.image)
    .filter((image): image is ReferenceImage => Boolean(image));
```

需要保持：

- Image 节点正文内容仍是图片 URL / data URL。
- Text 节点内容仍是 prompt 输入。
- 不把 Image URL 拼进 prompt 字符串。

### 6. `src/app/(user)/canvas/components/canvas-node-hover-toolbar.tsx`

第一阶段不建议改。

目标项目图片 hover toolbar 已经有较完整工具集。非空 Image 节点选中后，当前 prompt panel 本身已经能完成 image edit 并生成右侧子图。

如果后续需要更显式的 `以图生图` 入口，可在第二阶段做：

1. `CanvasNodeHoverToolbarProps` 新增：

```ts
onImageToImage: (node: CanvasNodeData) => void;
```

2. `canvas-image-toolbar-tools.tsx` 新增 tool id：

```ts
export type ImageNodeActionToolId =
    | "imageToImage"
    | ...
```

3. hover toolbar 对非空 Image 增加按钮：

```txt
以图生图
```

4. 点击后只创建下游空 Image 节点和连接，不生成。

但该入口可能与现有 `编辑` 按钮和 prompt panel 语义重叠，所以建议等第一阶段确认后再加。

## 推荐实现顺序

### 第一步：新增 Image 动作 hook

新增：

- `src/app/(user)/canvas/hooks/use-image-node-handlers.ts`

实现：

- `handleImageToImage`
- `createWorkflowImageNode`
- `addImageWorkflowNode`
- `getGenerationCount`

注意复用目标项目字段：

```ts
CanvasNodeType.Image
CanvasConnection
CanvasNodeMetadata
getNodeSpec(CanvasNodeType.Image)
```

### 第二步：CanvasNode props 接线

修改：

- `canvas-node.tsx`

新增：

- `onImageToImage` prop
- `NodeContentRendererProps.onImageToImage`
- `EmptyImageContent` 或 `ImageNodeActionMenu`

### 第三步：空 Image 节点内容区菜单

修改：

- `canvas-node.tsx`

将 `EmptyImageContent` 从单纯 placeholder 改成 Image 动作菜单。

第一阶段菜单：

```txt
Try to:
  Image to Image
```

如上传入口接线成本可控，再加入：

```txt
Upload Image
```

暂不加入：

```txt
Image to Video
```

### 第四步：页面挂载 hook

修改：

- `canvas-client-page.tsx`

挂载 `useImageNodeHandlers`，把 `handleImageToImage` 传给 `CanvasNode`。

### 第五步：验证生成链路

不改生成层，直接验证现有链路：

```txt
child Image Generate
  -> handleGenerateNode(child.id, "image", prompt)
  -> buildNodeGenerationContext(child.id, nodes, connections, prompt)
  -> referenceImages 包含 parent Image
  -> requestEdit(...)
```

如果发现空 Image 子节点的 prompt panel 没有自动打开，再检查：

```ts
setDialogNodeId(child.id)
```

是否被后续状态逻辑覆盖。

## 详细事件流

### Image to Image

```txt
ImageContent / EmptyImageContent 菜单按钮
  -> onImageToImage(node)
  -> CanvasNode props
  -> canvas-client-page
  -> useImageNodeHandlers.handleImageToImage
  -> 创建空 Image 子节点
  -> 创建 Image -> Image connection
  -> 选中子 Image
  -> 打开子 Image prompt panel
  -> 用户输入 prompt
  -> CanvasNodePromptPanel submit
  -> handleGenerateNode(child.id, "image", prompt)
  -> buildNodeGenerationContext 读取上游 Image
  -> generationContext.referenceImages.length > 0
  -> requestEdit(generationConfig, prompt, referenceImages)
  -> uploadImage(...)
  -> imageMetadata(uploaded)
  -> 子 Image 节点原地显示结果
```

### Source Image 为空时

如果允许空 Image 节点点击 `Image to Image`，需要明确它是“预搭工作流”：

```txt
空 Image -> 空 Image
```

此时用户必须先给 source Image 上传或生成图片，再去子 Image 输入 prompt 生成。

否则，如果 source Image 仍为空而子 Image 已输入 prompt，现有生成逻辑会因为没有上游 reference image 而走 text-to-image。这可能不符合用户对 Image to Image 的预期。

因此第一阶段有两种可选策略：

### 策略 A：只允许非空 Image 使用 Image to Image

优点：

- 语义最清晰。
- 不会误触发 text-to-image。
- 生成链路最稳定。

缺点：

- 空 Image 节点菜单无法完全复刻 TwitCanva 的“先搭 workflow 再补输入”体验。

推荐用于第一阶段。

### 策略 B：允许空 Image 预搭 Image to Image

优点：

- 更接近 TwitCanva 当前空态菜单。
- 用户可以先搭好画布结构，再补资源。

缺点：

- 需要在 prompt panel 或生成前增加校验，避免 source 为空时子节点误走 text-to-image。
- 可能需要给子节点 metadata 增加轻量标记，例如：

```ts
requiresImageInput?: boolean;
```

目标项目当前 `CanvasNodeMetadata` 没有这个字段，不建议第一阶段引入。

第一阶段推荐采用策略 A。

## 建议的第一阶段产品口径

为了避免和 Text 节点三选项完全照搬造成误解，Image 节点第一阶段建议这样定义：

```txt
非空 Image 节点
  -> 可通过 Image to Image 创建下游空 Image
  -> 下游 Image 读取上游图片作为参考
  -> 下游 Image 自己的 prompt 决定如何编辑

空 Image 节点
  -> 继续作为上传/生成占位
  -> 暂不支持 Image to Image，除非先有图片内容
```

如果确认更想要 TwitCanva 那种“空节点也能先搭 workflow”，再采用策略 B。

## 需要避免的问题

### 1. 不要迁移 `parentIds`

TwitCanva 使用：

```ts
parentIds: [nodeId]
```

目标项目应该使用：

```ts
connections: [{ fromNodeId: source.id, toNodeId: child.id }]
```

### 2. 不要让 Image to Image 直接调用生成

这个动作只创建下游节点和连接。真正生成由子 Image 节点自己的 Generate 按钮触发。

### 3. 不要把上游图片 URL 写入子节点 prompt

图片引用应该通过连接读取为 `referenceImages`，不要拼进 prompt 字符串。

### 4. 不要重复实现已有图片工具

目标项目已有图片工具栏能力，第一阶段不迁移或重写：

- 裁剪
- 切图
- 超分
- 多角度
- 局部编辑
- 反推提示词
- 查看大图
- 保存素材
- 下载图片

### 5. 不要引入 Video 逻辑

本轮不做：

- `Image to Video`
- Video 节点空态菜单
- Video prompt panel 模型筛选
- motion control
- frame-to-frame
- 视频上传/导出工具迁移

### 6. 不要改变现有 Text 工作流

Text 节点三选项计划已经有单独文档，Image 迁移不要回头改 Text 的字段语义或生成合并顺序。

## 验证清单

### 手动验证

1. 准备一个已有内容的 Image 节点，可以通过上传图片或生成图片得到。
2. 在该 Image 节点上触发 `Image to Image`。
3. 右侧出现新的空 Image 节点。
4. 出现连接：

```txt
source Image -> child Image
```

5. 新 Image 节点被选中。
6. 新 Image 节点 prompt panel 自动打开。
7. 不输入 prompt 时，Generate 不应可用，除非未来明确支持纯图片变体。
8. 输入 prompt，例如：

```txt
把画面改成夜晚霓虹街景，保持主体姿态和构图一致
```

9. 点击 Generate。
10. 子 Image 节点进入 loading。
11. 请求应走 `requestEdit`，不是 `requestGeneration`。
12. 子 Image 节点原地显示生成结果。
13. 子 Image 的 `metadata.generationType` 应为 `edit`。
14. 子 Image 的 `metadata.references` 应包含上游图片引用。
15. 原 source Image 不应被覆盖。
16. 删除 source Image 时，连接也应被现有删除逻辑清理。
17. 多选、拖拽、缩放、minimap 不应受影响。
18. Text to Image 工作流仍然可用。
19. Config 节点 composer 生成不受影响。

### 回归验证

1. 上传图片后 hover toolbar 仍可用。
2. 图片下载仍可用。
3. 保存到素材仍可用。
4. 反推提示词仍能创建 Text + Config。
5. 裁剪后仍能创建子 Image。
6. 切图后仍能创建多个子 Image。
7. 放大/超分/多角度不受影响。
8. 非空 Image 节点原本通过 prompt panel 直接编辑生成右侧子图的路径不受影响。

### 命令验证

目标项目可执行：

```bash
bun run format:check
bun run build
```

如果只想快速检查类型：

```bash
bunx tsc --noEmit
```

## 风险评估

### 中风险：空 Image 节点是否允许预搭 workflow

如果允许空 Image 创建 Image -> Image，用户可能在 source 还没有图片时对子 Image Generate，导致实际走 text-to-image。

建议第一阶段只允许非空 Image 触发 Image to Image，或者在生成前增加明确校验。

### 中风险：入口与现有 prompt panel 语义重叠

目标项目已有“选中非空 Image 后输入 prompt 生成子图”的能力。新增 `Image to Image` 入口可能与现有 `编辑` 按钮产生概念重叠。

建议第一阶段先把入口放在空态/明确菜单中，不急着加入 hover toolbar 快捷工具。

### 低风险：生成上下文已有基础

目标项目已经能通过连接读取上游 Image，并根据 `referenceImages.length` 选择 `requestEdit`，生成层改动很小。

### 低风险：图片结果工具栏已有实现

现有图片工具栏功能丰富，本次不重写，可降低回归风险。

## 预期最终效果

第一阶段完成后，Image 节点会补齐一个更明确的连接式工作流入口：

```txt
已有图片的 Image 节点
  -> Image to Image
  -> 创建右侧空 Image 子节点
  -> 自动建立 Image -> Image 连接
  -> 子节点输入编辑 prompt
  -> 子节点 Generate
  -> 使用上游图片作为参考生成新图
```

同时保持目标项目现有能力：

```txt
Text -> Image
Config composer
图片上传
图片结果工具栏
图片裁剪/切分/超分/多角度/局部编辑
图片批量生成
```

Video 相关迁移暂缓，后续如果要做，再单独写 `VIDEO_NODE_WORKFLOW_MIGRATION_PLAN.md`。
