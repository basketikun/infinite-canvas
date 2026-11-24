import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "../schema/canvas.js";

export function nodeBounds(nodes: CanvasNodeData[]) {
    return nodes.reduce(
        (acc, node) => ({
            left: Math.min(acc.left, node.position.x),
            top: Math.min(acc.top, node.position.y),
            right: Math.max(acc.right, node.position.x + node.width),
            bottom: Math.max(acc.bottom, node.position.y + node.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
}

function centerInside(outer: CanvasNodeData, inner: CanvasNodeData) {
    const centerX = inner.position.x + inner.width / 2;
    const centerY = inner.position.y + inner.height / 2;
    return centerX >= outer.position.x && centerX <= outer.position.x + outer.width && centerY >= outer.position.y && centerY <= outer.position.y + outer.height;
}

// 节点中心落在组内，或节点比组大、盖住了组的中心，都视为放入该组。
function containsCenter(group: CanvasNodeData, node: CanvasNodeData) {
    return centerInside(group, node) || centerInside(node, group);
}

export function findGroupDropTarget(movedIds: Set<string>, nodes: CanvasNodeData[]) {
    if (nodes.some((node) => movedIds.has(node.id) && node.type === CanvasNodeType.Group)) return null;
    const movingNodes = nodes.filter((node) => movedIds.has(node.id) && node.type !== CanvasNodeType.Group);
    if (!movingNodes.length) return null;
    // Walk backwards instead of copying and reversing; this runs on every drag frame.
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const group = nodes[index];
        if (group.type !== CanvasNodeType.Group || movedIds.has(group.id)) continue;
        if (movingNodes.some((node) => containsCenter(group, node))) return group;
    }
    return null;
}

export function snapNodesIntoGroup(movedIds: Set<string>, nodes: CanvasNodeData[], group: CanvasNodeData) {
    const movingNodes = nodes.filter((node) => movedIds.has(node.id) && node.type !== CanvasNodeType.Group);
    if (!movingNodes.length) return nodes;
    const pad = 24;
    const bounds = nodeBounds(movingNodes);
    const left = group.position.x + pad;
    const top = group.position.y + pad;
    const right = group.position.x + group.width - pad;
    const bottom = group.position.y + group.height - pad;
    // 节点比组大时扩大组去包住所有成员，而不是把节点挤进原来的范围。
    const oversized = bounds.right - bounds.left > right - left || bounds.bottom - bounds.top > bottom - top;
    const wrap = oversized ? getGroupWrapRect([...nodes.filter((node) => node.metadata?.groupId === group.id && !movedIds.has(node.id)), ...movingNodes]) : null;
    const grown = wrap ? { x: Math.min(group.position.x, wrap.x), y: Math.min(group.position.y, wrap.y), right: Math.max(group.position.x + group.width, wrap.x + wrap.width), bottom: Math.max(group.position.y + group.height, wrap.y + wrap.height) } : null;
    const dx = oversized ? 0 : bounds.left < left ? left - bounds.left : bounds.right > right ? right - bounds.right : 0;
    const dy = oversized ? 0 : bounds.top < top ? top - bounds.top : bounds.bottom > bottom ? bottom - bounds.bottom : 0;
    return nodes.map((node) => {
        if (grown && node.id === group.id) return { ...node, position: { x: grown.x, y: grown.y }, width: grown.right - grown.x, height: grown.bottom - grown.y };
        if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group) return node;
        return { ...node, position: { x: node.position.x + dx, y: node.position.y + dy }, metadata: { ...node.metadata, groupId: group.id } };
    });
}

export const GROUP_WRAP_PADDING = 24;
export const GROUP_WRAP_TOP_PADDING = 52;

function selectedGroupIds(selectedIds: Set<string>, nodes: CanvasNodeData[]) {
    return new Set(nodes.filter((node) => selectedIds.has(node.id) && node.type === CanvasNodeType.Group).map((node) => node.id));
}

export function collectGroupMemberNodes(selectedIds: Set<string>, nodes: CanvasNodeData[]) {
    const groups = selectedGroupIds(selectedIds, nodes);
    return nodes.filter((node) => node.type !== CanvasNodeType.Group && (selectedIds.has(node.id) || (node.metadata?.groupId != null && groups.has(node.metadata.groupId))));
}

export function getGroupWrapRect(members: CanvasNodeData[]) {
    const bounds = nodeBounds(members);
    return {
        x: bounds.left - GROUP_WRAP_PADDING,
        y: bounds.top - GROUP_WRAP_TOP_PADDING,
        width: bounds.right - bounds.left + GROUP_WRAP_PADDING * 2,
        height: bounds.bottom - bounds.top + GROUP_WRAP_TOP_PADDING + GROUP_WRAP_PADDING,
    };
}

export function canGroupSelectedNodes(selectedIds: Set<string>, nodes: CanvasNodeData[]) {
    const members = collectGroupMemberNodes(selectedIds, nodes);
    if (members.length < 2) return false;
    const groupId = members[0].metadata?.groupId;
    return !groupId || members.some((node) => node.metadata?.groupId !== groupId);
}

export function canUngroupSelectedNodes(selectedIds: Set<string>, nodes: CanvasNodeData[]) {
    return nodes.some((node) => selectedIds.has(node.id) && (node.type === CanvasNodeType.Group || Boolean(node.metadata?.groupId)));
}

function emptyGroupIds(nodes: CanvasNodeData[], candidates: Set<string>) {
    const used = new Set(nodes.flatMap((node) => (node.type !== CanvasNodeType.Group && node.metadata?.groupId ? [node.metadata.groupId] : [])));
    return new Set(nodes.filter((node) => node.type === CanvasNodeType.Group && candidates.has(node.id) && !used.has(node.id)).map((node) => node.id));
}

function withoutRemoved(nodes: CanvasNodeData[], connections: CanvasConnection[], removedIds: Set<string>) {
    return {
        nodes: nodes.filter((node) => !removedIds.has(node.id)),
        connections: connections.filter((connection) => !removedIds.has(connection.fromNodeId) && !removedIds.has(connection.toNodeId)),
    };
}

export function applyGroupSelection(selectedIds: Set<string>, nodes: CanvasNodeData[], connections: CanvasConnection[], group: CanvasNodeData) {
    const members = collectGroupMemberNodes(selectedIds, nodes);
    if (members.length < 2) return null;
    const memberIds = new Set(members.map((node) => node.id));
    const previousGroupIds = new Set(members.flatMap((node) => node.metadata?.groupId ? [node.metadata.groupId] : []));
    const flattenedGroupIds = selectedGroupIds(selectedIds, nodes);
    const updated = nodes.filter((node) => !flattenedGroupIds.has(node.id)).map((node) => (memberIds.has(node.id) ? { ...node, metadata: { ...node.metadata, groupId: group.id } } : node));
    const insertAt = updated.findIndex((node) => memberIds.has(node.id));
    const withGroup = insertAt < 0 ? [...updated, group] : [...updated.slice(0, insertAt), group, ...updated.slice(insertAt)];
    const next = withoutRemoved(withGroup, connections, new Set([...flattenedGroupIds, ...emptyGroupIds(withGroup, previousGroupIds)]));
    return { ...next, selectedIds: [group.id] };
}

export function applyUngroupSelection(selectedIds: Set<string>, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const flattenedGroupIds = selectedGroupIds(selectedIds, nodes);
    if (!flattenedGroupIds.size && !nodes.some((node) => selectedIds.has(node.id) && node.metadata?.groupId)) return null;
    const releasedIds = new Set<string>();
    const previousGroupIds = new Set<string>();
    const updated = nodes
        .filter((node) => !flattenedGroupIds.has(node.id))
        .map((node) => {
            const groupId = node.metadata?.groupId;
            if (!groupId) return node;
            if (!flattenedGroupIds.has(groupId) && !selectedIds.has(node.id)) return node;
            releasedIds.add(node.id);
            previousGroupIds.add(groupId);
            return { ...node, metadata: { ...node.metadata, groupId: undefined } };
        });
    const next = withoutRemoved(updated, connections, new Set([...flattenedGroupIds, ...emptyGroupIds(updated, previousGroupIds)]));
    return { ...next, selectedIds: next.nodes.filter((node) => selectedIds.has(node.id) || releasedIds.has(node.id)).map((node) => node.id) };
}

export function setGroupMembers(groupId: string, memberIds: Set<string>, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const group = nodes.find((node) => node.id === groupId);
    if (group?.type !== CanvasNodeType.Group) throw new Error("GROUP_NOT_FOUND");
    const members = nodes.filter((node) => memberIds.has(node.id));
    if (members.length !== memberIds.size || members.some((node) => node.type === CanvasNodeType.Group)) throw new Error("GROUP_MEMBER_INVALID");
    const previousGroupIds = new Set(members.flatMap((node) => node.metadata?.groupId && node.metadata.groupId !== groupId ? [node.metadata.groupId] : []));
    const rect = members.length ? getGroupWrapRect(members) : null;
    const updated = nodes.map((node) => {
        if (node.id === groupId && rect) return { ...node, position: { x: rect.x, y: rect.y }, width: rect.width, height: rect.height };
        if (memberIds.has(node.id)) return { ...node, metadata: { ...node.metadata, groupId } };
        if (node.metadata?.groupId === groupId) return { ...node, metadata: { ...node.metadata, groupId: undefined } };
        return node;
    });
    return withoutRemoved(updated, connections, emptyGroupIds(updated, previousGroupIds));
}

export function findContainingGroupId(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    // Called once per moved node when a drag ends, so avoid copying the node list each time.
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const group = nodes[index];
        if (group.type === CanvasNodeType.Group && group.id !== node.id && containsCenter(group, node)) return group.id;
    }
    return undefined;
}

