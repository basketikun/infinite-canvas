# 框选、多选外框与建组点击逻辑迁移计划

## 背景

目标是在 `/Users/a1/Desktop/infinite-canvas/web` 项目中迁移 TwitCanva 项目的这套画布交互：

```txt
普通左键点击节点
  -> 单选当前节点

Shift + 点击节点
  -> 追加到当前选择

普通左键拖动画布空白区域
  -> 拉出框选区域
  -> 选中与框相交的节点

选中多个节点
  -> 显示多选外框
  -> 可点击 Group 建组

已建组
  -> 显示组外框
  -> 点击组外框选中整组并整体拖动
```

本次重点不是照搬视觉，而是改变目标项目当前的点击逻辑：把“空白左键默认平移 / Ctrl 或 Meta + 左键框选”改为“空白左键框选，Space + 左键或中键平移”，并补齐多选外框和建组链路。

本文档只写迁移方案，暂不执行代码改造。确认后再按文档逐步修改。

## 参考来源

源项目：

```txt
/Users/a1/Desktop/无限画布项目汇总/TwitCanva-Video-Workflow
```

源项目相关文件：

```txt
src/App.tsx
src/hooks/useSelectionBox.ts
src/hooks/useNodeDragging.ts
src/hooks/useGroupManagement.ts
src/hooks/useNodeManagement.ts
src/components/canvas/CanvasNode.tsx
src/components/canvas/SelectionBoundingBox.tsx
src/types.ts
```

源项目核心行为链路：

```txt
CanvasNode.onPointerDown
  -> App.tsx 更新 selectedNodeIds
  -> useNodeDragging 记录拖拽锚点

canvas-background.onPointerDown
  -> 左键 startSelection
  -> 清空旧选择

canvas-background.onPointerMove
  -> updateSelection 优先
  -> updateNodeDrag
  -> updateConnectionDrag
  -> updatePanning

canvas-background.onPointerUp
  -> endSelection
  -> setSelectedNodeIds(selectedIds)

selectedNodeIds.length > 1
  -> 渲染 SelectionBoundingBox
  -> Group 按钮调用 groupNodes

groupNodes
  -> 新增 NodeGroup
  -> 给节点写入同一个 groupId
```

源项目的组数据是双轨结构：

```ts
type NodeData = {
    id: string;
    groupId?: string;
};

type NodeGroup = {
    id: string;
    nodeIds: string[];
    label: string;
    storyContext?: unknown;
};
```

## 目标项目当前状态

目标项目画布核心代码：

```txt
src/app/(user)/canvas/[id]/canvas-client-page.tsx
src/app/(user)/canvas/components/infinite-canvas.tsx
src/app/(user)/canvas/components/canvas-node.tsx
src/app/(user)/canvas/stores/use-canvas-store.ts
src/app/(user)/canvas/types.ts
```

当前已有选中状态，在 `canvas-client-page.tsx` 中：

```ts
const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
const selectedNodeIdsRef = useRef(selectedNodeIds);
```

当前已有框选状态：

```ts
const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
const selectionBoxRef = useRef(selectionBox);
```

当前 `SelectionBox` 已定义在 `types.ts`：

```ts
export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};
```

当前框选命中逻辑已经存在于 `canvas-client-page.tsx`：

```ts
const intersects =
    rectX < node.position.x + node.width &&
    rectX + rectW > node.position.x &&
    rectY < node.position.y + node.height &&
    rectY + rectH > node.position.y;

if (intersects) nextSelected.add(node.id);
```

这比 TwitCanva 的固定 `340 x 300` 命中更适合目标项目，因为目标项目节点本身已经有真实的 `width / height`。

## 当前关键差异

### 1. 空白左键当前是平移，不是框选

`InfiniteCanvas` 当前逻辑：

```ts
if (event.button === 0 && (event.ctrlKey || event.metaKey) && isBackgroundClick) {
    onCanvasMouseDown?.(event);
    return;
}

if (event.button === 1 || (event.button === 0 && !isSpacePressed && isBackgroundClick)) {
    // start panning
    return;
}
```

也就是说：

| 当前操作 | 当前行为 |
| --- | --- |
| 空白左键拖动 | 平移画布 |
| Ctrl / Meta + 空白左键拖动 | 框选 |
| 空白左键单击 | 如果没有移动，mouseup 时取消选择 |

迁移后应改为：

| 操作 | 新行为 |
| --- | --- |
| 空白左键拖动 | 框选 |
| 空白左键单击 | 清空选中 |
| Shift + 空白左键拖动 | 追加框选 |
| Space + 空白左键拖动 | 平移画布 |
| 中键拖动 | 平移画布 |

### 2. 节点点击当前是 toggle 风格

目标项目当前 `handleNodeMouseDown`：

```ts
if (event.shiftKey || event.metaKey || event.ctrlKey) {
    if (nextSelected.has(nodeId)) {
        nextSelected.delete(nodeId);
    } else {
        nextSelected.add(nodeId);
    }
} else if (!nextSelected.has(nodeId)) {
    nextSelected.clear();
    nextSelected.add(nodeId);
}
```

它的行为是：

| 当前操作 | 当前行为 |
| --- | --- |
| 普通点击未选中节点 | 单选该节点 |
| 普通点击已在多选里的节点 | 保持整组选中 |
| Shift / Ctrl / Meta 点击未选中节点 | 加入选择 |
| Shift / Ctrl / Meta 点击已选中节点 | 从选择中移除 |

TwitCanva 风格应改成：

| 操作 | 新行为 |
| --- | --- |
| 普通点击节点 | 永远单选该节点 |
| Shift 点击未选中节点 | 追加到当前选择 |
| Shift 点击已选中节点 | 不取消，只保持选中并可拖动 |

如果想保留目标项目原本的 Ctrl / Meta toggle 习惯，可以只把 Shift 改成 TwitCanva 风格，Ctrl / Meta 继续保留 toggle。但如果目标是完全迁移 TwitCanva 逻辑，建议只保留 Shift 追加。

### 3. 目标项目已有 world 坐标框选，不建议照搬源项目屏幕坐标方案

TwitCanva 的蓝色框选 UI 在缩放层外部，用屏幕坐标渲染；结束时再转换到画布坐标。

目标项目当前 `selectionBox` 已经是 world 坐标，并且渲染在 `InfiniteCanvas` 的缩放层内部：

```tsx
<div
    style={{
        left: Math.min(selectionBox.startWorldX, selectionBox.currentWorldX),
        top: Math.min(selectionBox.startWorldY, selectionBox.currentWorldY),
        width: Math.abs(selectionBox.currentWorldX - selectionBox.startWorldX),
        height: Math.abs(selectionBox.currentWorldY - selectionBox.startWorldY),
    }}
/>
```

这个方案和目标项目的 `position / width / height` 模型更契合。迁移时不要把它改成屏幕坐标覆盖层，只改触发方式和结束清理即可。

## 推荐目标行为

迁移完成后，建议行为如下：

| 用户操作 | 目标行为 |
| --- | --- |
| 点击空白画布 | 清空节点选择、连线选择、菜单、面板 |
| 拖动画布空白区域 | 显示框选框，选中与框相交的节点 |
| Shift + 拖动画布空白区域 | 保留原选区，并把框内节点加入选择 |
| Space + 拖动画布空白区域 | 平移画布 |
| 中键拖动画布空白区域 | 平移画布 |
| 普通点击节点 | 单选节点，清除连线选择和菜单 |
| Shift + 点击节点 | 追加节点到选区，不取消已选节点 |
| 多选后拖动多选外框 | 移动所有选中节点 |
| 多选后点击 Group | 创建组，并给节点写入同一个 `groupId` |
| 点击未选中的组外框 | 选中整组，并开始整体拖动 |
| 点击 Ungroup | 删除组，清除节点 `groupId` |

## 数据结构改造

### 1. 修改 `types.ts`

文件：

```txt
src/app/(user)/canvas/types.ts
```

给节点增加组归属字段：

```ts
export type CanvasNodeData = {
    id: string;
    type: CanvasNodeType;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
    groupId?: string;
};
```

新增组类型：

```ts
export type CanvasNodeGroup = {
    id: string;
    nodeIds: string[];
    label: string;
    storyContext?: unknown;
};
```

说明：

- `groupId` 建议放在 `CanvasNodeData` 顶层，不建议塞进 `metadata`。
- `metadata` 更偏生成内容、图片尺寸、批量生成信息；`groupId` 是画布结构关系，属于节点结构本身。

### 2. 修改项目持久化结构

文件：

```txt
src/app/(user)/canvas/stores/use-canvas-store.ts
```

修改导入：

```ts
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, CanvasNodeGroup, ViewportTransform } from "../types";
```

给 `CanvasProject` 增加：

```ts
groups: CanvasNodeGroup[];
```

创建项目时初始化：

```ts
groups: [],
```

导入项目时兜底：

```ts
groups: source.groups || [],
```

`updateProject` patch 需要加入 `groups`：

```ts
updateProject: (
    id: string,
    patch: Partial<
        Pick<
            CanvasProject,
            "nodes" | "connections" | "groups" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport"
        >
    >,
) => void;
```

## 页面状态改造

文件：

```txt
src/app/(user)/canvas/[id]/canvas-client-page.tsx
```

### 1. 增加 groups 状态和 ref

```ts
const [groups, setGroups] = useState<CanvasNodeGroup[]>([]);
const groupsRef = useRef(groups);
```

在现有 `useLayoutEffect` 同步 ref：

```ts
groupsRef.current = groups;
```

### 2. 历史记录加入 groups

当前 `CanvasHistoryEntry` 是：

```ts
type CanvasHistoryEntry = Pick<CanvasClipboard, "nodes" | "connections"> & {
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
};
```

改为包含 `groups`：

```ts
type CanvasHistoryEntry = Pick<CanvasClipboard, "nodes" | "connections"> & {
    groups: CanvasNodeGroup[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
};
```

`createHistoryEntry` 增加：

```ts
groups: groupsRef.current,
```

对比 history 变化时也要比较 `groups`：

```ts
previous.groups === next.groups
```

`applyHistory` 时恢复：

```ts
setGroups(entry.groups);
```

### 3. 项目加载和保存加入 groups

项目加载时：

```ts
setGroups(project.groups || []);
```

`lastHistoryRef.current` 中也加入：

```ts
groups: project.groups || [],
```

自动保存时：

```ts
updateProject(projectId, {
    nodes,
    connections,
    groups,
    chatSessions,
    activeChatId,
    backgroundMode,
    showImageInfo,
});
```

依赖数组加入 `groups`。

## 点击逻辑改造

### 1. 修改 `InfiniteCanvas` 的空白左键逻辑

文件：

```txt
src/app/(user)/canvas/components/infinite-canvas.tsx
```

推荐把 `handlePointerDown` 调整成以下语义：

```ts
const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-canvas-no-zoom]")) return;
    if (target?.closest("[data-connection-create-menu]")) return;

    const isBackgroundClick = !target?.closest("[data-node-id],[data-connection-id],[data-selection-bounding-box]");

    if (!isBackgroundClick) return;

    if (event.button === 1 || (event.button === 0 && isSpacePressed)) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        panState.current = {
            isPanning: true,
            startX: event.clientX,
            startY: event.clientY,
            initialX: viewport.x,
            initialY: viewport.y,
            hasMoved: false,
        };
        document.body.style.cursor = "grabbing";
        return;
    }

    if (event.button === 0) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        onCanvasMouseDown?.(event);
    }
};
```

关键变化：

- `data-selection-bounding-box` 要排除，否则点多选/组外框会被当成空白画布。
- `Space + 左键` 和中键负责平移。
- 普通空白左键交给上层 `handleCanvasMouseDown` 开始框选。
- 旧的 `Ctrl / Meta + 左键才框选` 条件要删除。

### 2. 修改 `handleCanvasMouseDown`

当前逻辑要求 Ctrl / Meta 才开始框选：

```ts
if (!event.ctrlKey && !event.metaKey) {
    setSelectionBox(null);
    setSelectedNodeIds(new Set());
    setSelectedConnectionId(null);
    return;
}
```

迁移后应删除这段判断，普通左键也进入框选初始化。

推荐改成：

```ts
const handleCanvasMouseDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
        setContextMenu(null);
        setAddNodesMenu(null);
        setDialogNodeId(null);
        setEditingNodeId(null);
        if (pendingConnectionCreateRef.current) cancelPendingConnectionCreate();
        if (event.button !== 0) return;

        const world = screenToCanvas(event.clientX, event.clientY);
        const additive = event.shiftKey;
        const nextSelectionBox: SelectionBox = {
            startWorldX: world.x,
            startWorldY: world.y,
            currentWorldX: world.x,
            currentWorldY: world.y,
            additive,
            initialSelectedNodeIds: additive ? Array.from(selectedNodeIdsRef.current) : [],
        };

        selectionBoxRef.current = nextSelectionBox;
        setSelectionBox(nextSelectionBox);

        if (!additive) {
            setSelectedNodeIds(new Set());
        }

        setSelectedConnectionId(null);
    },
    [cancelPendingConnectionCreate, screenToCanvas],
);
```

说明：

- 空白单击时也会短暂创建 `selectionBox`，但没有移动时选区为空，mouseup 会清掉框，最终表现为清空选择。
- 如果不想单击时闪一下框，可以后续加 `hasMoved` 阈值，但第一版不必增加复杂度。

### 3. 修改节点点击逻辑

当前 `handleNodeMouseDown` 同时支持 Shift/Ctrl/Meta toggle。迁移 TwitCanva 风格后，推荐改成：

```ts
const currentSelected = selectedNodeIdsRef.current;
const currentNodes = nodesRef.current;
const nextSelected = new Set<string>();

if (event.shiftKey) {
    currentSelected.forEach((id) => nextSelected.add(id));
    nextSelected.add(nodeId);
} else {
    nextSelected.add(nodeId);
}

setSelectedNodeIds(nextSelected);
```

行为变化：

- 普通点击任何节点，都会变成单选。
- Shift 点击只追加，不从选择里移除。
- 如果要保留 Ctrl/Meta toggle，可以单独加：

```ts
if (event.metaKey || event.ctrlKey) {
    currentSelected.forEach((id) => nextSelected.add(id));
    if (nextSelected.has(nodeId)) nextSelected.delete(nodeId);
    else nextSelected.add(nodeId);
} else if (event.shiftKey) {
    currentSelected.forEach((id) => nextSelected.add(id));
    nextSelected.add(nodeId);
} else {
    nextSelected.add(nodeId);
}
```

但完全贴近 TwitCanva 时，不建议让 Ctrl/Meta 继续承担框选入口；框选入口已经改成普通左键空白拖动。

### 4. 多选拖拽的取舍

目标项目当前有一个体验：多选后直接按住其中一个节点拖动，可以移动全部选中节点，因为普通点击已选节点不会缩成单选。

TwitCanva 迁移后，如果普通点击节点永远单选，这个体验会变化：拖动多选应通过“多选外框”完成。

推荐按 TwitCanva 方式处理：

- 节点本体普通点击负责单选。
- 多选整体移动通过 `SelectionBoundingBox` 完成。
- 点击组外框负责选中整组并整体移动。

如果希望兼容两种体验，可以增加更复杂的点击/拖拽判定：

```txt
pointerdown 在已选节点上时先不缩成单选
mousemove 超过 3px -> 保持多选并拖动全部
mouseup 未移动 -> 缩成单选并打开面板
```

但这会改变当前 `handleNodeMouseDown / finishNodeDrag` 的时序，第一版不建议这么做。先按 TwitCanva 的外框拖拽模型实现更稳。

## 组管理逻辑

可以在 `canvas-client-page.tsx` 内先写局部函数；后续再抽成 hook。

### 1. 创建组

```ts
const groupSelectedNodes = useCallback(() => {
    const nodeIds = Array.from(selectedNodeIdsRef.current);
    if (nodeIds.length < 2) return;

    const groupId = nanoid();
    const newGroup: CanvasNodeGroup = {
        id: groupId,
        nodeIds,
        label: "New Group",
    };

    setGroups((prev) => [...prev, newGroup]);
    setNodes((prev) => prev.map((node) => (nodeIds.includes(node.id) ? { ...node, groupId } : node)));
}, []);
```

### 2. 拆组

```ts
const ungroupNodes = useCallback((groupId: string) => {
    setGroups((prev) => prev.filter((group) => group.id !== groupId));
    setNodes((prev) => prev.map((node) => (node.groupId === groupId ? { ...node, groupId: undefined } : node)));
}, []);
```

### 3. 判断当前选区是否属于同一组

建议以 `node.groupId` 为准，避免 `groups[].nodeIds` 和节点字段不同步时 UI 判断异常：

```ts
const getCommonGroup = useCallback((nodeIds: Iterable<string>) => {
    const ids = Array.from(nodeIds);
    if (!ids.length) return undefined;

    const firstNode = nodesRef.current.find((node) => node.id === ids[0]);
    const groupId = firstNode?.groupId;
    if (!groupId) return undefined;

    const allInSameGroup = ids.every((id) => nodesRef.current.find((node) => node.id === id)?.groupId === groupId);
    if (!allInSameGroup) return undefined;

    return groupsRef.current.find((group) => group.id === groupId);
}, []);
```

说明：

- TwitCanva 的 `getCommonGroup` 是通过 `groups[].nodeIds` 查。
- 目标项目建议以 `node.groupId` 为主，因为组外框渲染也会通过 `node.groupId` 找成员。

### 4. 清理无效组

新增 effect：

```ts
useEffect(() => {
    const invalidGroupIds = groups
        .filter((group) => nodes.filter((node) => node.groupId === group.id).length < 2)
        .map((group) => group.id);

    if (!invalidGroupIds.length) return;

    setGroups((prev) => prev.filter((group) => !invalidGroupIds.includes(group.id)));
    setNodes((prev) =>
        prev.map((node) => (node.groupId && invalidGroupIds.includes(node.groupId) ? { ...node, groupId: undefined } : node)),
    );
}, [groups, nodes]);
```

### 5. 重命名组

```ts
const renameGroup = useCallback((groupId: string, label: string) => {
    const nextLabel = label.trim();
    if (!nextLabel) return;

    setGroups((prev) => prev.map((group) => (group.id === groupId ? { ...group, label: nextLabel } : group)));
}, []);
```

### 6. 排序组节点

第一版可以只做水平 / 垂直 / 网格排序：

```ts
const sortGroupNodes = useCallback((groupId: string, direction: "horizontal" | "vertical" | "grid") => {
    const groupNodes = nodesRef.current.filter((node) => node.groupId === groupId);
    if (groupNodes.length < 2) return;

    const sorted = [...groupNodes].sort((a, b) => {
        const numA = Number(a.title.match(/\d+/)?.[0] || 0);
        const numB = Number(b.title.match(/\d+/)?.[0] || 0);
        return numA - numB;
    });

    const minX = Math.min(...sorted.map((node) => node.position.x));
    const minY = Math.min(...sorted.map((node) => node.position.y));
    const gapX = 96;
    const gapY = 56;
    const columns = 3;

    const updates = new Map<string, Position>();
    sorted.forEach((node, index) => {
        if (direction === "horizontal") {
            updates.set(node.id, { x: minX + index * (node.width + gapX), y: minY });
        } else if (direction === "vertical") {
            updates.set(node.id, { x: minX, y: minY + index * (node.height + gapY) });
        } else {
            const col = index % columns;
            const row = Math.floor(index / columns);
            updates.set(node.id, {
                x: minX + col * (node.width + gapX),
                y: minY + row * (node.height + gapY),
            });
        }
    });

    setNodes((prev) => prev.map((node) => (updates.has(node.id) ? { ...node, position: updates.get(node.id)! } : node)));
}, []);
```

## 多选/组外框组件

新增文件：

```txt
src/app/(user)/canvas/components/canvas-selection-bounding-box.tsx
```

建议组件名：

```ts
export function CanvasSelectionBoundingBox(...)
```

### Props

```ts
type CanvasSelectionBoundingBoxProps = {
    selectedNodes: CanvasNodeData[];
    group?: CanvasNodeGroup;
    viewport: ViewportTransform;
    onGroup: () => void;
    onUngroup: () => void;
    onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
    onRenameGroup?: (groupId: string, label: string) => void;
    onSortNodes?: (direction: "horizontal" | "vertical" | "grid") => void;
};
```

### 外框计算

目标项目节点已有真实尺寸，所以不需要 TwitCanva 的 `getNodeWidth/getNodeHeight` 估算：

```ts
const PADDING_X = 48;
const PADDING_TOP = 32;
const PADDING_BOTTOM = 48;

const minX = Math.min(...selectedNodes.map((node) => node.position.x)) - PADDING_X;
const minY = Math.min(...selectedNodes.map((node) => node.position.y)) - PADDING_TOP;
const maxX = Math.max(...selectedNodes.map((node) => node.position.x + node.width)) + PADDING_X;
const maxY = Math.max(...selectedNodes.map((node) => node.position.y + node.height)) + PADDING_BOTTOM;
```

### 样式建议

外框渲染在 `InfiniteCanvas` 的缩放层内，因此位置使用 world 坐标：

```tsx
<div
    data-selection-bounding-box
    className="absolute pointer-events-auto cursor-move"
    style={{
        left: minX,
        top: minY,
        width,
        height,
        zIndex: 5,
        border: isGrouped ? `2px solid ${theme.canvas.selectionStroke}` : `2px dashed ${theme.canvas.selectionStroke}`,
        background: isGrouped ? "rgba(47,128,255,0.08)" : "transparent",
        borderRadius: 16,
    }}
    onMouseDown={(event) => {
        if (event.target === event.currentTarget) onMouseDown(event);
    }}
/>
```

按钮区需要按缩放反向缩放，避免画布缩放时按钮过大或过小：

```ts
const uiScale = Math.min(1 / viewport.k, 1.5);
```

未建组多选时显示：

```txt
Group
```

已建组时显示：

```txt
组名 / Sort / Ungroup
```

如果要保持目标项目风格，按钮可以使用现有主题 `canvasThemes` 和 lucide 图标，不必照搬 TwitCanva 的 SVG。

## 外框渲染位置

文件：

```txt
src/app/(user)/canvas/[id]/canvas-client-page.tsx
```

在 `<InfiniteCanvas>` 内部，建议顺序：

```txt
Connections SVG
Nodes
当前选区外框
所有未选中组外框
selectionBox 蓝色拖拽框
pendingConnectionCreate 菜单
```

当前代码中节点渲染后紧接着渲染 `selectionBox`。迁移后可以在节点和 `selectionBox` 之间插入：

```tsx
{selectedNodeIds.size > 1 && !selectionBox ? (
    <CanvasSelectionBoundingBox
        selectedNodes={nodes.filter((node) => selectedNodeIds.has(node.id) && !isHiddenBatchChild(node, nodes, collapsingBatchIds))}
        group={getCommonGroup(selectedNodeIds)}
        viewport={viewport}
        onGroup={groupSelectedNodes}
        onUngroup={() => {
            const group = getCommonGroup(selectedNodeIds);
            if (group) ungroupNodes(group.id);
        }}
        onMouseDown={(event) => {
            event.stopPropagation();
            startBoundingBoxDrag(event, Array.from(selectedNodeIdsRef.current));
        }}
        onRenameGroup={renameGroup}
        onSortNodes={(direction) => {
            const group = getCommonGroup(selectedNodeIds);
            if (group) sortGroupNodes(group.id, direction);
        }}
    />
) : null}
```

再渲染所有未选中组：

```tsx
{groups.map((group) => {
    const groupNodes = nodes.filter((node) => node.groupId === group.id && !isHiddenBatchChild(node, nodes, collapsingBatchIds));
    if (groupNodes.length < 2) return null;

    const isSelected = groupNodes.every((node) => selectedNodeIds.has(node.id));
    if (isSelected) return null;

    return (
        <CanvasSelectionBoundingBox
            key={group.id}
            selectedNodes={groupNodes}
            group={group}
            viewport={viewport}
            onGroup={() => {}}
            onUngroup={() => ungroupNodes(group.id)}
            onMouseDown={(event) => {
                event.stopPropagation();
                const nodeIds = groupNodes.map((node) => node.id);
                setSelectedNodeIds(new Set(nodeIds));
                startBoundingBoxDrag(event, nodeIds);
            }}
            onRenameGroup={renameGroup}
            onSortNodes={(direction) => sortGroupNodes(group.id, direction)}
        />
    );
})}
```

## 外框拖拽实现

目标项目已有节点拖拽结构：

```ts
dragRef.current = {
    isDraggingNode: true,
    hasMoved: false,
    startX: event.clientX,
    startY: event.clientY,
    initialSelectedNodes: currentNodes.filter((node) => dragIds.has(node.id)).map(...),
};
```

建议复用这套拖拽机制，新增一个 helper：

```ts
const startBoundingBoxDrag = useCallback((event: ReactMouseEvent, nodeIds: string[]) => {
    const dragIds = new Set(nodeIds);
    nodesRef.current.forEach((node) => {
        if (dragIds.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => dragIds.add(childId));
    });

    dragRef.current = {
        isDraggingNode: true,
        hasMoved: false,
        startX: event.clientX,
        startY: event.clientY,
        initialSelectedNodes: nodesRef.current
            .filter((node) => dragIds.has(node.id))
            .map((node) => ({
                id: node.id,
                x: node.position.x,
                y: node.position.y,
            })),
    };

    historyPausedRef.current = true;
    nodeDraggingRef.current = true;
    setIsNodeDragging(true);
}, []);
```

这样 `handleGlobalMouseMove` 和 `finishNodeDrag` 不需要重写，因为它们已经根据 `dragRef.current.initialSelectedNodes` 移动多个节点。

## 复制、粘贴、删除与组的关系

### 1. 复制/粘贴不要继承旧组

`pasteCopiedNodes` 中创建新节点时，需要清掉 `groupId`：

```ts
return {
    ...node,
    id,
    groupId: undefined,
    ...
};
```

`duplicateNode` 同理：

```ts
const next: CanvasNodeData = {
    ...source,
    id,
    groupId: undefined,
    title: `${source.title} Copy`,
    position: { x: source.position.x + 36, y: source.position.y + 36 },
};
```

原因：如果复制出来的新节点继承旧 `groupId`，它会被渲染到原组外框里，但 `groups[].nodeIds` 又不一定包含它，容易出现脏数据。

### 2. 删除节点后清理组

现有 `deleteNodes` 删除节点后会清空选择和连接。新增组以后，不一定要在 `deleteNodes` 内同步清理，可以依赖前面的 `cleanupInvalidGroups` effect。

如果希望删除时立即清理，也可以在 `deleteNodes` 末尾加：

```ts
setGroups((prev) =>
    prev
        .map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => !allIds.has(id)) }))
        .filter((group) => group.nodeIds.length >= 2),
);
```

但如果以 `node.groupId` 为主，effect 清理已经足够。

### 3. Ctrl/Cmd + A

当前全选：

```ts
setSelectedNodeIds(new Set(nodesRef.current.map((node) => node.id)));
```

建议改成只选可见节点，避免选中折叠批量图里的隐藏子节点：

```ts
setSelectedNodeIds(new Set(nodesRef.current.filter((node) => !isHiddenBatchChild(node, nodesRef.current)).map((node) => node.id)));
```

这和框选逻辑保持一致。

## 与现有功能的冲突点

### 1. 平移手势变化

迁移后，用户不能再用普通左键拖动画布平移，必须使用：

```txt
Space + 左键拖动
中键拖动
滚轮缩放
```

这属于明确的点击逻辑改变，需要接受这个交互调整。

### 2. 多选直接拖节点的行为变化

如果普通点击节点永远单选，多选后直接拖某个节点会变成拖单个节点。整体拖动应通过多选外框完成。

如果产品上更想保留原目标项目的体验，可以采用“pointerdown 不立即缩成单选，mouseup 未移动才单选”的高级方案，但实现复杂度更高。

### 3. 节点面板打开时机

当前 `finishNodeDrag` 在单击节点后会打开 `dialogNodeId`。多选外框拖拽不应该触发节点面板。

`startBoundingBoxDrag` 复用 `dragRef` 时，`finishNodeDrag` 会计算：

```ts
const wasClick = !dragRef.current.hasMoved && dragRef.current.initialSelectedNodes.length === 1;
```

外框拖拽传入多个节点时不会打开单节点面板。组里只有一个节点的外框不渲染，因此也没问题。

### 4. 连接创建菜单和框选

`InfiniteCanvas` 已经排除了：

```ts
[data-connection-create-menu]
```

新增外框后也要排除：

```ts
[data-selection-bounding-box]
```

否则点击外框按钮可能被误判为空白画布操作。

### 5. 批量图片节点

目标项目有批量图片折叠/展开逻辑：

```ts
metadata.isBatchRoot
metadata.batchRootId
metadata.batchChildIds
```

框选、外框、组成员渲染都应沿用现有规则：

```ts
!isHiddenBatchChild(node, nodes, collapsingBatchIds)
```

不要把折叠状态下不可见的 batch child 显示到组外框里。

## 推荐实施顺序

### 第 1 步：先改空白画布点击语义

修改：

```txt
src/app/(user)/canvas/components/infinite-canvas.tsx
src/app/(user)/canvas/[id]/canvas-client-page.tsx
```

目标：

- 普通左键空白拖动开始框选。
- Space + 左键或中键才平移。
- 删除 `Ctrl / Meta + 左键才框选` 的限制。
- 保留现有 `SelectionBox` world 坐标实现。

验证：

```txt
空白左键单击 -> 清空选择
空白左键拖动 -> 框选节点
Shift + 空白左键拖动 -> 追加框选
Space + 左键拖动 -> 平移画布
中键拖动 -> 平移画布
```

### 第 2 步：改节点点击语义

修改：

```txt
src/app/(user)/canvas/[id]/canvas-client-page.tsx
```

目标：

- 普通点击节点永远单选。
- Shift 点击节点只追加，不取消。
- 清理菜单、连线选择、hover toolbar 的现有行为保留。

验证：

```txt
普通点 A -> 只选 A
普通点 B -> 只选 B
Shift 点 A，再 Shift 点 B -> A+B 被选中
Shift 再点 A -> A+B 仍被选中
```

### 第 3 步：加入组数据结构和持久化

修改：

```txt
src/app/(user)/canvas/types.ts
src/app/(user)/canvas/stores/use-canvas-store.ts
src/app/(user)/canvas/[id]/canvas-client-page.tsx
```

目标：

- `CanvasNodeData.groupId`
- `CanvasNodeGroup`
- `CanvasProject.groups`
- history / load / save / import / create project 全部支持 groups。

验证：

```txt
新建项目 groups 是 []
保存并刷新后 groups 不丢失
撤销/重做可以恢复组状态
导入旧项目没有 groups 也不报错
```

### 第 4 步：实现组管理函数

修改：

```txt
src/app/(user)/canvas/[id]/canvas-client-page.tsx
```

目标：

- `groupSelectedNodes`
- `ungroupNodes`
- `getCommonGroup`
- `renameGroup`
- `sortGroupNodes`
- invalid group cleanup

验证：

```txt
两个以上节点可建组
拆组后 groupId 清空
删除组内节点后，少于 2 个节点的组自动清理
```

### 第 5 步：新增外框组件

新增：

```txt
src/app/(user)/canvas/components/canvas-selection-bounding-box.tsx
```

目标：

- 多选未建组显示虚线外框和 Group 按钮。
- 已建组显示实线外框、组名、Sort、Ungroup。
- 工具按钮使用 `uiScale = Math.min(1 / viewport.k, 1.5)` 保持可用尺寸。

验证：

```txt
多选两个节点 -> 出现虚线外框
点 Group -> 变实线组外框
缩放画布 -> 外框位置正确，按钮大小可用
双击组名 -> 可以重命名
```

### 第 6 步：接入外框拖拽

修改：

```txt
src/app/(user)/canvas/[id]/canvas-client-page.tsx
```

目标：

- 新增 `startBoundingBoxDrag`
- 多选外框拖动移动所有选中节点
- 未选中的组外框按下时，先选中整组，再整体拖动

验证：

```txt
框选多个节点 -> 拖外框 -> 所有节点移动
点击未选中的组外框 -> 整组被选中
拖组外框 -> 整组移动
拖动时 history 暂停，松手后记录一次历史
```

### 第 7 步：处理复制、粘贴、删除边界

修改：

```txt
src/app/(user)/canvas/[id]/canvas-client-page.tsx
```

目标：

- duplicate / paste 清空 `groupId`
- delete 后组自动清理
- Ctrl/Cmd + A 只选可见节点

验证：

```txt
复制组内节点再粘贴 -> 新节点不属于原组
删除组内节点到只剩 1 个 -> 组消失
全选不选中隐藏 batch child
```

## 回归检查清单

### 选择与框选

- [ ] 点击空白画布会清空节点选择、连接选择、菜单和节点面板。
- [ ] 空白拖动可以框选节点。
- [ ] 框选命中使用节点真实 `position / width / height`。
- [ ] 框选不会选中折叠状态下不可见的 batch child。
- [ ] Shift 框选会追加，不覆盖旧选区。
- [ ] Escape 清空节点选择、连接选择、框选框和菜单。

### 节点点击

- [ ] 普通点击任意节点，只选中该节点。
- [ ] Shift 点击未选中节点，会追加。
- [ ] Shift 点击已选中节点，不会取消。
- [ ] 点击节点不会触发空白画布框选。
- [ ] 双击图片预览、双击 batch root 展开/收起仍正常。
- [ ] 节点 resize handle 不会触发框选。
- [ ] 节点连接 handle 不会触发框选。

### 平移与缩放

- [ ] Space + 左键拖动画布可以平移。
- [ ] 中键拖动画布可以平移。
- [ ] 普通左键拖动画布不再平移，而是框选。
- [ ] 滚轮缩放仍以鼠标为中心。
- [ ] 缩放后框选命中正确。

### 多选外框

- [ ] 选中 2 个以上节点时出现多选外框。
- [ ] 单选节点不显示多选外框。
- [ ] 多选外框不会遮挡节点基础点击。
- [ ] 拖动多选外框可以移动所有选中节点。
- [ ] 多选外框的按钮在不同缩放下可点击。

### 建组

- [ ] 多选未建组时显示 Group 按钮。
- [ ] 点击 Group 后创建 `CanvasNodeGroup`，节点写入同一个 `groupId`。
- [ ] 已建组外框显示实线和半透明背景。
- [ ] 点击未选中的组外框会选中整组。
- [ ] 拖动组外框会移动整组。
- [ ] Ungroup 后删除 group 并清空节点 `groupId`。
- [ ] 重命名组后刷新页面仍保留。
- [ ] Sort 后节点位置变化并进入历史记录。

### 数据持久化

- [ ] 新项目 `groups` 初始化为空数组。
- [ ] 旧项目没有 `groups` 字段时可以正常打开。
- [ ] 建组后刷新页面，组仍存在。
- [ ] 撤销/重做能恢复 nodes、connections、groups。
- [ ] 导入/同步画布数据时 groups 不丢失。

### 复制与删除

- [ ] 复制/粘贴组内节点不会继承原 `groupId`。
- [ ] duplicate 单节点不会继承原 `groupId`。
- [ ] 删除组内节点后无效组会清理。
- [ ] 删除整个组内所有节点后，组不会残留。

## 最小代码改动范围

第一版建议只改这些文件：

```txt
src/app/(user)/canvas/types.ts
src/app/(user)/canvas/stores/use-canvas-store.ts
src/app/(user)/canvas/components/infinite-canvas.tsx
src/app/(user)/canvas/components/canvas-selection-bounding-box.tsx
src/app/(user)/canvas/[id]/canvas-client-page.tsx
```

不建议第一版就拆 hook。等功能跑通后，再考虑抽出：

```txt
src/app/(user)/canvas/hooks/use-canvas-selection.ts
src/app/(user)/canvas/hooks/use-canvas-groups.ts
```

原因是当前 `canvas-client-page.tsx` 中很多逻辑依赖本地 refs：

```ts
nodesRef
selectedNodeIdsRef
viewportRef
dragRef
historyPausedRef
nodeDraggingRef
```

先在当前页面内接通链路，风险更低。

## 一句话迁移方案

保留目标项目已有的 world 坐标 `SelectionBox` 和真实节点尺寸命中；把 `InfiniteCanvas` 的普通空白左键从平移改为框选，把平移迁到 `Space + 左键 / 中键`；把节点点击改成普通点击单选、Shift 点击追加；新增 `CanvasNodeGroup + node.groupId`，在多选时渲染 `CanvasSelectionBoundingBox`，点击 Group 写入组数据，之后通过组外框完成整组选中、拖拽、拆组、排序和重命名。
