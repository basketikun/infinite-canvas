import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { getNodeSpec, isRegisteredNodeType } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeTypeId, type ViewportTransform } from "@/types/canvas";

export type CanvasAgentOp =
    | { type: "add_node"; id?: string; nodeType?: CanvasNodeTypeId; title?: string; position?: { x: number; y: number }; x?: number; y?: number; width?: number; height?: number; metadata?: CanvasNodeMetadata }
    | { type: "update_node"; id: string; patch?: Partial<CanvasNodeData>; metadata?: CanvasNodeMetadata }
    | { type: "delete_node"; id?: string; ids?: string[]; nodeType?: CanvasNodeTypeId }
    | { type: "delete_connections"; id?: string; ids?: string[]; all?: boolean }
    | { type: "connect_nodes"; id?: string; fromNodeId: string; toNodeId: string }
    | { type: "set_viewport"; viewport: ViewportTransform }
    | { type: "select_nodes"; ids: string[] }
    | { type: "run_generation"; nodeId: string; mode?: "text" | "image" | "video" | "audio"; prompt?: string };

export type CanvasAgentSnapshot = {
    projectId: string;
    title: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: string[];
    viewport: ViewportTransform;
    revision: number;
};

export type CanvasChangeSet = { nodeIds: string[]; connectionIds: string[]; selection: boolean; viewport: boolean; allConnections?: boolean };
export type CanvasRevisionEntry = CanvasChangeSet & { revision: number };
export type CanvasAgentWriteRequest = { projectId: string; baseRevision: number; ops: CanvasAgentOp[] };

export class CanvasRevisionError extends Error {
    constructor(
        readonly code: "CANVAS_PROJECT_CHANGED" | "CANVAS_REVISION_CONFLICT" | "CANVAS_REVISION_EXPIRED",
        readonly detail: Record<string, unknown>,
    ) {
        super(code === "CANVAS_PROJECT_CHANGED" ? "当前画布已切换，请重新读取后重试" : code === "CANVAS_REVISION_EXPIRED" ? "画布版本已过期，请重新读取后重试" : "画布内容已变化，请重新读取后重试");
        this.name = "CanvasRevisionError";
    }
}

export function canvasSnapshotChanges(previous: CanvasAgentSnapshot, next: CanvasAgentSnapshot): CanvasChangeSet {
    const nodeIds = changedEntityIds(previous.nodes, next.nodes);
    const connectionIds = changedEntityIds(previous.connections, next.connections);
    return {
        nodeIds,
        connectionIds,
        selection: JSON.stringify(previous.selectedNodeIds) !== JSON.stringify(next.selectedNodeIds),
        viewport: JSON.stringify(previous.viewport) !== JSON.stringify(next.viewport),
    };
}

export function canvasOpsTouches(ops: CanvasAgentOp[]): CanvasChangeSet {
    const nodeIds = new Set<string>();
    const connectionIds = new Set<string>();
    let selection = false;
    let viewport = false;
    let allConnections = false;
    ops.forEach((op) => {
        if (op.type === "add_node" || op.type === "update_node") {
            if (op.id) nodeIds.add(op.id);
        }
        if (op.type === "run_generation") nodeIds.add(op.nodeId);
        if (op.type === "delete_node") (op.ids || (op.id ? [op.id] : [])).forEach((id) => nodeIds.add(id));
        if (op.type === "connect_nodes") {
            if (op.id) connectionIds.add(op.id);
            nodeIds.add(op.fromNodeId);
            nodeIds.add(op.toNodeId);
        }
        if (op.type === "delete_connections") {
            (op.ids || (op.id ? [op.id] : [])).forEach((id) => connectionIds.add(id));
            allConnections ||= Boolean(op.all);
        }
        if (op.type === "select_nodes") selection = true;
        if (op.type === "set_viewport") viewport = true;
    });
    return { nodeIds: [...nodeIds], connectionIds: [...connectionIds], selection, viewport, allConnections };
}

export function assertCanvasWrite(request: CanvasAgentWriteRequest, current: CanvasAgentSnapshot, journal: CanvasRevisionEntry[]) {
    if (request.projectId !== current.projectId) throw new CanvasRevisionError("CANVAS_PROJECT_CHANGED", { projectId: current.projectId, currentRevision: current.revision, action: "read_and_retry" });
    const currentNodeIds = new Set(current.nodes.map((node) => node.id));
    const availableNodeIds = new Set(currentNodeIds);
    const currentConnectionIds = new Set(current.connections.map((connection) => connection.id));
    const invalidNodeIds = new Set<string>();
    const invalidConnectionIds = new Set<string>();
    request.ops.forEach((op) => {
        if (op.type === "add_node" && op.id) {
            if (availableNodeIds.has(op.id)) invalidNodeIds.add(op.id);
            else availableNodeIds.add(op.id);
        }
        if ((op.type === "update_node" || op.type === "run_generation") && !availableNodeIds.has(op.type === "run_generation" ? op.nodeId : op.id)) invalidNodeIds.add(op.type === "run_generation" ? op.nodeId : op.id);
        if (op.type === "delete_node") (op.ids || (op.id ? [op.id] : [])).forEach((id) => {
            if (!availableNodeIds.has(id)) invalidNodeIds.add(id);
            else availableNodeIds.delete(id);
        });
        if (op.type === "connect_nodes") {
            if (!availableNodeIds.has(op.fromNodeId)) invalidNodeIds.add(op.fromNodeId);
            if (!availableNodeIds.has(op.toNodeId)) invalidNodeIds.add(op.toNodeId);
            if (op.id && currentConnectionIds.has(op.id)) invalidConnectionIds.add(op.id);
            else if (op.id) currentConnectionIds.add(op.id);
        }
    });
    if (invalidNodeIds.size || invalidConnectionIds.size) throw new CanvasRevisionError("CANVAS_REVISION_CONFLICT", { baseRevision: request.baseRevision, currentRevision: current.revision, nodeIds: [...invalidNodeIds], connectionIds: [...invalidConnectionIds], action: "read_and_retry" });
    if (request.baseRevision > current.revision) throw new CanvasRevisionError("CANVAS_REVISION_CONFLICT", { baseRevision: request.baseRevision, currentRevision: current.revision, action: "read_and_retry" });
    if (request.baseRevision === current.revision) return;
    const firstRevision = journal[0]?.revision ?? current.revision;
    if (request.baseRevision < firstRevision - 1) throw new CanvasRevisionError("CANVAS_REVISION_EXPIRED", { baseRevision: request.baseRevision, currentRevision: current.revision, action: "read_and_retry" });
    const touched = canvasOpsTouches(request.ops);
    const changed = journal.filter((item) => item.revision > request.baseRevision);
    const changedNodes = new Set(changed.flatMap((item) => item.nodeIds));
    const changedConnections = new Set(changed.flatMap((item) => item.connectionIds));
    const nodeIds = touched.nodeIds.filter((id) => changedNodes.has(id));
    const connectionIds = touched.connectionIds.filter((id) => changedConnections.has(id));
    const connectionConflict = touched.allConnections && changed.some((item) => item.connectionIds.length || item.allConnections);
    const selectionConflict = touched.selection && changed.some((item) => item.selection);
    const viewportConflict = touched.viewport && changed.some((item) => item.viewport);
    if (nodeIds.length || connectionIds.length || connectionConflict || selectionConflict || viewportConflict) {
        throw new CanvasRevisionError("CANVAS_REVISION_CONFLICT", {
            baseRevision: request.baseRevision,
            currentRevision: current.revision,
            nodeIds,
            connectionIds,
            selection: selectionConflict,
            viewport: viewportConflict,
            action: "read_and_retry",
        });
    }
}

export function summarizeCanvasAgentOps(ops?: CanvasAgentOp[]) {
    const counts = (Array.isArray(ops) ? ops : []).reduce<Record<string, number>>((acc, op) => {
        if (!op?.type) return acc;
        acc[op.type] = (acc[op.type] || 0) + 1;
        return acc;
    }, {});
    return Object.entries(counts)
        .map(([type, count]) => `${opLabel(type)} ${count}`)
        .join("，");
}

function changedEntityIds<T extends { id: string }>(previous: T[], next: T[]) {
    const left = new Map(previous.map((item) => [item.id, JSON.stringify(item)]));
    const right = new Map(next.map((item) => [item.id, JSON.stringify(item)]));
    return [...new Set([...left.keys(), ...right.keys()])].filter((id) => left.get(id) !== right.get(id));
}

export function applyCanvasAgentOps(snapshot: CanvasAgentSnapshot, ops?: CanvasAgentOp[]) {
    let nodes = snapshot.nodes;
    let connections = snapshot.connections;
    let selectedNodeIds = snapshot.selectedNodeIds;
    let viewport = snapshot.viewport;

    (Array.isArray(ops) ? ops : []).forEach((op, index) => {
        if (!op?.type) return;
        if (op.type === "add_node") {
            const nodeType = op.nodeType && isRegisteredNodeType(op.nodeType) ? op.nodeType : CanvasNodeType.Text;
            const spec = getNodeSpec(nodeType);
            const node: CanvasNodeData = {
                id: op.id || `${nodeType}-${Date.now()}-${index}`,
                type: nodeType,
                title: op.title || spec.title,
                position: op.position || { x: op.x ?? index * 36, y: op.y ?? index * 36 },
                width: op.width || spec.width,
                height: op.height || spec.height,
                metadata: { ...spec.metadata, ...op.metadata },
            };
            nodes = [...nodes, node];
            selectedNodeIds = [node.id];
        }
        if (op.type === "update_node") {
            if (!op.id) return;
            nodes = nodes.map((node) => (node.id === op.id ? { ...node, ...op.patch, metadata: { ...node.metadata, ...op.patch?.metadata, ...op.metadata } } : node));
        }
        if (op.type === "delete_node") {
            const ids = new Set(op.ids || (op.id ? [op.id] : op.nodeType ? nodes.filter((node) => node.type === op.nodeType).map((node) => node.id) : []));
            nodes = nodes.filter((node) => !ids.has(node.id));
            connections = connections.filter((conn) => !ids.has(conn.fromNodeId) && !ids.has(conn.toNodeId));
            selectedNodeIds = selectedNodeIds.filter((id) => !ids.has(id));
        }
        if (op.type === "delete_connections") {
            const ids = new Set(op.ids || (op.id ? [op.id] : []));
            connections = op.all ? [] : connections.filter((conn) => !ids.has(conn.id));
        }
        if (op.type === "connect_nodes") {
            if (!op.fromNodeId || !op.toNodeId) return;
            const exists = connections.some((conn) => conn.fromNodeId === op.fromNodeId && conn.toNodeId === op.toNodeId);
            const hasNodes = nodes.some((node) => node.id === op.fromNodeId) && nodes.some((node) => node.id === op.toNodeId);
            if (!exists && hasNodes) connections = [...connections, { id: op.id || nanoid(), fromNodeId: op.fromNodeId, toNodeId: op.toNodeId }];
        }
        if (op.type === "set_viewport" && op.viewport) viewport = op.viewport;
        if (op.type === "select_nodes") selectedNodeIds = (op.ids || []).filter((id) => nodes.some((node) => node.id === id));
    });

    return { ...snapshot, nodes, connections, selectedNodeIds, viewport };
}

function opLabel(type: string) {
    return i18n.t(`canvas.agentOps.${type}`, { defaultValue: type });
}
