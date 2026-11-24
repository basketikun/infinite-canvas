import { nanoid } from "nanoid";
import { applyOps, type CanvasDocumentOp } from "@infinite-canvas/shared/canvas/ops/apply";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@infinite-canvas/shared/canvas/schema/canvas";
import type { CanvasAgentOp } from "@infinite-canvas/shared/canvas/tools/types";
import { getNodeDefinition } from "./node-registry";
import { getNodeSpec } from "@workbench/constant/canvas";
import type { ViewportTransform } from "@workbench/types/canvas";
import { canvasApply, nodeGenerate } from "@infinite-canvas/plugin-sdk/builtin";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { executeCommand } from "@workbench/lib/plugins/commands";
import { workspaceBinding } from "@workbench/lib/plugins/registry";
import type { CanvasSession } from "./canvas-session";

export type CanvasAgentSnapshot = {
    projectId: string;
    title: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: string[];
    viewport: ViewportTransform;
};

const NODE_GAP = 40;

/** 新节点与已有节点重叠时向右顺延，保持原有行排布；分组框与其成员的重叠属于正常包含，不处理。 */
function avoidOverlap(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    const others = nodes.filter((item) => item.type !== CanvasNodeType.Group);
    let hit: CanvasNodeData | undefined;
    while (hit = others.find((item) => node.position.x < item.position.x + item.width && item.position.x < node.position.x + node.width && node.position.y < item.position.y + item.height && item.position.y < node.position.y + node.height)) {
        node.position = { x: hit.position.x + hit.width + NODE_GAP, y: node.position.y };
    }
}

/**
 * 网页负责补齐操作数据和应用交互状态，文档变更统一交给 shared 的画布模块。
 */
export function prepareCanvasAgentOps(snapshot: CanvasAgentSnapshot, ops: CanvasAgentOp[]) {
    let graph = { nodes: snapshot.nodes, connections: snapshot.connections };
    let selectedNodeIds = snapshot.selectedNodeIds;
    let viewport = snapshot.viewport;
    const documentOps: CanvasDocumentOp[] = [];
    for (const [index, op] of ops.entries()) {
        if (op.type === "run_generation") continue;
        if (op.type === "set_viewport") { viewport = op.viewport; continue; }
        if (op.type === "select_nodes") { selectedNodeIds = op.ids.filter((id) => graph.nodes.some((node) => node.id === id)); continue; }
        let documentOp: CanvasDocumentOp;
        if (op.type === "add_node") {
            const type = op.nodeType ?? CanvasNodeType.Text;
            const spec = getNodeSpec(type);
            const node: CanvasNodeData = { id: op.id ?? nanoid(), type, title: op.title ?? spec.title, position: op.position ?? { x: op.x ?? index * 36, y: op.y ?? index * 36 }, width: op.width ?? spec.width, height: op.height ?? spec.height, metadata: { ...spec.metadata, ...op.metadata } };
            if (node.type !== CanvasNodeType.Group) avoidOverlap(node, graph.nodes);
            documentOp = { type: "add_node", node };
            selectedNodeIds = [node.id];
        } else if (op.type === "group_nodes") {
            documentOp = { ...op, id: op.id ?? nanoid(), title: op.title ?? "组" };
            selectedNodeIds = [documentOp.id];
        } else if (op.type === "connect_nodes") {
            documentOp = { type: "connect_nodes", connection: { id: op.id ?? nanoid(), fromNodeId: op.fromNodeId, toNodeId: op.toNodeId } };
        } else if (op.type === "delete_node") {
            documentOp = { type: "delete_node", ids: op.ids ?? (op.id ? [op.id] : graph.nodes.filter((node) => node.type === op.nodeType).map((node) => node.id)) };
        } else if (op.type === "delete_connections") {
            documentOp = { type: "delete_connections", ids: op.ids ?? (op.id ? [op.id] : []), all: op.all };
        } else {
            documentOp = op;
            if (op.type === "set_group_members") selectedNodeIds = [op.groupId];
            if (op.type === "ungroup_nodes") selectedNodeIds = graph.nodes.filter((node) => op.ids.includes(node.id) || (node.metadata?.groupId && op.ids.includes(node.metadata.groupId))).map((node) => node.id);
        }
        graph = applyOps(graph, [documentOp]);
        documentOps.push(documentOp);
        selectedNodeIds = selectedNodeIds.filter((id) => graph.nodes.some((node) => node.id === id));
    }
    const generations = ops.flatMap((op) => {
        if (op.type !== "run_generation") return [];
        const node = graph.nodes.find((item) => item.id === op.nodeId);
        if (!node) throw new Error("NODE_NOT_FOUND");
        const mode = node.type === "text" || node.type === "image" || node.type === "audio" || node.type === "video" ? node.type : getNodeDefinition(node.type)?.useBuiltinPanel?.mode;
        if (!mode || op.mode && op.mode !== mode) throw new Error("INVALID_ARGUMENTS");
        return [{ nodeId: node.id, mode, prompt: op.prompt ?? node.metadata?.composerContent ?? node.metadata?.prompt ?? "" }];
    });
    return { snapshot: { ...snapshot, ...graph, selectedNodeIds, viewport }, documentOps, generations };
}

export async function executeCanvasAgentOps(session: CanvasSession, title: string, ops: CanvasAgentOp[]) {
    session.signal.throwIfAborted();
    const before = session.getSnapshot();
    const prepared = prepareCanvasAgentOps({ projectId: session.projectId, title, nodes: before.nodes, connections: before.connections, selectedNodeIds: before.selection.nodeIds, viewport: before.viewport }, ops);
    const scope = Object.freeze({ ...workspaceBinding, kind: "project" as const, projectId: session.projectId, signal: session.signal });
    const controller = new AbortController();
    const signal = AbortSignal.any([session.signal, controller.signal]);
    const unsubscribe = session.on("document.committed", (event) => { if (event.operation !== "transact") controller.abort(new PluginError("PLUGIN_INACTIVE")); });
    try {
        await executeCommand(canvasApply, { ops: prepared.documentOps, selection: { nodeIds: prepared.snapshot.selectedNodeIds, connectionId: null }, viewport: prepared.snapshot.viewport }, { scope, session, signal, source: { kind: "agent" } });
        await session.flush();
        signal.throwIfAborted();
        for (const operation of prepared.generations) void executeCommand(nodeGenerate, operation, { scope, session, signal, source: { kind: "agent" } }).catch((error) => console.error("[canvas] generation command", error));
        const current = session.getSnapshot();
        return { projectId: session.projectId, title, nodes: current.nodes, connections: current.connections, selectedNodeIds: current.selection.nodeIds, viewport: current.viewport };
    } finally { unsubscribe(); }
}
