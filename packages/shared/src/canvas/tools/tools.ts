import { toolInputSchemas, toolNames, type ToolName } from "./schemas.js";
import type { CanvasNode, CanvasSnapshot } from "./types.js";

export function isToolName(name: unknown): name is ToolName {
    return typeof name === "string" && toolNames.includes(name as ToolName);
}

export function parseToolInput(name: ToolName, input: unknown) {
    return toolInputSchemas[name].parse(input ?? {});
}

type StateFilter = { ids?: string[]; types?: string[]; selectedOnly?: boolean; groupId?: string; keyword?: string; includeConnections?: boolean; offset?: number };
const STATE_NODE_LIMIT = 200;

/** 概览只提供定位与判断需要的字段，详情按节点读取。 */
export function compactCanvasState(state: CanvasSnapshot, input: StateFilter = {}) {
    const selected = new Set(state.selectedNodeIds);
    const requested = input.ids && new Set(input.ids);
    const keyword = input.keyword?.toLowerCase();
    const matched = state.nodes.filter((node) => (!requested || requested.has(node.id))
        && (!input.types || input.types.includes(node.type))
        && (!input.selectedOnly || selected.has(node.id))
        && (input.groupId === undefined || node.metadata?.groupId === input.groupId)
        && (!keyword || [node.title, node.type === "text" ? node.metadata?.content : undefined].some((value) => typeof value === "string" && value.toLowerCase().includes(keyword))));
    const nodes = matched.slice(input.offset ?? 0, (input.offset ?? 0) + STATE_NODE_LIMIT);
    const ids = new Set(nodes.map((node) => node.id));
    return {
        projectId: state.projectId, title: state.title, nodeCount: state.nodes.length, matchedCount: matched.length, ...(matched.length > (input.offset ?? 0) + nodes.length ? { truncated: true, nextOffset: (input.offset ?? 0) + nodes.length } : {}),
        selectedNodeIds: state.selectedNodeIds, viewport: state.viewport,
        nodes: compactNodes(nodes, state.nodes),
        ...(input.includeConnections === false ? {} : { connections: state.connections.filter((edge) => ids.has(edge.fromNodeId) || ids.has(edge.toNodeId)) }),
    };
}

export function readCanvasNodes(state: CanvasSnapshot, ids: string[]) {
    const requested = new Set(ids);
    const nodes = state.nodes.filter((node) => requested.has(node.id));
    const found = new Set(nodes.map((node) => node.id));
    return { projectId: state.projectId, nodes: compactNodes(nodes, state.nodes, true), missingIds: ids.filter((id) => !found.has(id)) };
}

/** 白名单输出，不序列化图片编码、临时链接、脚本或原始错误。 */
function compactNodes(nodes: CanvasNode[], allNodes: CanvasNode[], detail = false) {
    const members = new Map<string, string[]>();
    for (const node of allNodes) {
        const groupId = node.metadata?.groupId as string | undefined;
        if (groupId && node.type !== "group") {
            const group = members.get(groupId);
            if (group) group.push(node.id);
            else members.set(groupId, [node.id]);
        }
    }
    return nodes.map((node) => {
        const data = node.metadata ?? {};
        const content = node.type === "text" ? data.content as string | undefined : undefined;
        const truncated = !detail && content !== undefined && content.length > 240;
        const keys = detail
            ? ["status", "groupId", "generationType", "model", "reasoningEffort", "size", "quality", "background", "count", "textCount", "seconds", "vquality", "generateAudio", "watermark", "videoMode", "audioVoice", "audioFormat", "audioSpeed", "audioInstructions", "naturalWidth", "naturalHeight", "durationMs", "mimeType", "storageKey", "primaryImageId", "primaryTextId", "freeResize", "fontSize"]
            : ["status", "groupId"];
        return {
            id: node.id, type: node.type, title: node.title, position: node.position, width: node.width, height: node.height,
            metadata: {
                ...Object.fromEntries(keys.filter((key) => data[key] !== undefined).map((key) => [key, data[key]])),
                ...(content === undefined ? {} : { content: truncated ? `${content.slice(0, 120)}...` : content, ...(truncated ? { contentTruncated: true } : {}) }),
                ...(detail && (data.composerContent !== undefined || data.prompt !== undefined) ? { prompt: data.composerContent ?? data.prompt } : {}),
                ...(detail && Array.isArray(data.images) ? { images: data.images.map((item) => ({ id: item.id, status: item.status, storageKey: item.storageKey, naturalWidth: item.naturalWidth, naturalHeight: item.naturalHeight })) } : {}),
                ...(detail && Array.isArray(data.texts) ? { texts: data.texts.map((item) => ({ id: item.id, status: item.status, content: item.content })) } : {}),
            },
            ...(node.type === "group" ? { memberIds: members.get(node.id) ?? [] } : {}),
        };
    });
}

/** 写操作只回传变化；未变化的画布不再反复进入模型上下文。 */
export function summarizeCanvasChanges(before: CanvasSnapshot, after: CanvasSnapshot, ops: Array<{ type: string; nodeId?: string }>) {
    const oldNodes = new Map(before.nodes.map((node) => [node.id, node]));
    const nextIds = new Set(after.nodes.map((node) => node.id));
    const changedGroups = new Set<unknown>();
    for (const node of after.nodes) {
        if (oldNodes.get(node.id) !== node) {
            changedGroups.add(oldNodes.get(node.id)?.metadata?.groupId);
            changedGroups.add(node.metadata?.groupId);
        }
    }
    const deletedNodeIds = before.nodes.filter((node) => !nextIds.has(node.id)).map((node) => { changedGroups.add(node.metadata?.groupId); return node.id; });
    const changed = after.nodes.filter((node) => oldNodes.get(node.id) !== node || changedGroups.has(node.id));
    const createdNodeIds = changed.filter((node) => !oldNodes.has(node.id)).map((node) => node.id);
    const oldEdges = new Set(before.connections.map((edge) => edge.id));
    const nextEdges = new Set(after.connections.map((edge) => edge.id));
    const addedConnections = after.connections.filter((edge) => !oldEdges.has(edge.id));
    const deletedConnectionIds = before.connections.filter((edge) => !nextEdges.has(edge.id)).map((edge) => edge.id);
    const submittedNodeIds = ops.filter((op) => op.type === "run_generation").map((op) => op.nodeId);
    return {
        projectId: after.projectId,
        ...(createdNodeIds.length ? { createdNodeIds } : {}),
        ...(changed.length ? { nodes: compactNodes(changed, after.nodes) } : {}),
        ...(deletedNodeIds.length ? { deletedNodeIds } : {}),
        ...(addedConnections.length ? { addedConnections } : {}),
        ...(deletedConnectionIds.length ? { deletedConnectionIds } : {}),
        ...(before.selectedNodeIds.length !== after.selectedNodeIds.length || before.selectedNodeIds.some((id, index) => id !== after.selectedNodeIds[index]) ? { selectedNodeIds: after.selectedNodeIds } : {}),
        ...(before.viewport !== after.viewport ? { viewport: after.viewport } : {}),
        ...(submittedNodeIds.length ? { submittedNodeIds } : {}),
    };
}

export function nextCanvasX(state: CanvasSnapshot | null) {
    const nodes = state?.nodes ?? [];
    return nodes.length ? Math.max(...nodes.map((node) => node.position.x + node.width)) + 80 : 0;
}
