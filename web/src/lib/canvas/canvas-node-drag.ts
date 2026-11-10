import { CanvasNodeType, type CanvasNodeData, type Position } from "@/types/canvas";
import { findContainingGroupId, findGroupDropTarget, snapNodesIntoGroup } from "./canvas-node-geometry";

export type CanvasDragPreview = {
    readonly positions: ReadonlyMap<string, Position>;
    readonly offset: Position;
};

export function createCanvasDragPositions(selectedIds: ReadonlySet<string>, nodes: readonly CanvasNodeData[]) {
    const groups = new Set(nodes.filter((node) => selectedIds.has(node.id) && node.type === CanvasNodeType.Group).map((node) => node.id));
    const positions = new Map<string, Position>();
    for (const node of nodes) {
        if (selectedIds.has(node.id) || (node.metadata?.groupId && groups.has(node.metadata.groupId))) positions.set(node.id, node.position);
    }
    return positions;
}

export function canvasDragPosition(node: CanvasNodeData, preview: CanvasDragPreview | null): Position {
    const initial = preview?.positions.get(node.id);
    return initial && preview ? { x: initial.x + preview.offset.x, y: initial.y + preview.offset.y } : node.position;
}

export function translateCanvasDrag(nodes: readonly CanvasNodeData[], preview: CanvasDragPreview) {
    return nodes.map((node) => {
        const position = canvasDragPosition(node, preview);
        return position.x === node.position.x && position.y === node.position.y ? node : { ...node, position };
    });
}

export function findCanvasDragTarget(nodes: readonly CanvasNodeData[], preview: CanvasDragPreview) {
    const moving = nodes.filter((node) => preview.positions.has(node.id));
    if (moving.some((node) => node.type === CanvasNodeType.Group)) return null;
    const groups = nodes.filter((node) => node.type === CanvasNodeType.Group && !preview.positions.has(node.id));
    const projected = translateCanvasDrag(moving, preview);
    return findGroupDropTarget(new Set(preview.positions.keys()), [...groups, ...projected]);
}

export function finishCanvasDrag(options: { nodes: readonly CanvasNodeData[]; preview: CanvasDragPreview; resolveGroups: boolean }) {
    const moved = translateCanvasDrag(options.nodes, options.preview);
    if (!options.resolveGroups) return moved;
    const movedIds = new Set(options.preview.positions.keys());
    const target = findCanvasDragTarget(options.nodes, options.preview);
    if (target) return snapNodesIntoGroup(movedIds, moved, target);
    // Keep the original reverse stacking order, but inspect groups rather than every node for each member.
    const groups = moved.filter((node) => node.type === CanvasNodeType.Group);
    return moved.map((node) => {
        if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group) return node;
        const groupId = findContainingGroupId(node, groups);
        return node.metadata?.groupId === groupId ? node : { ...node, metadata: { ...node.metadata, groupId } };
    });
}
