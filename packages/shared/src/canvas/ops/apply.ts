import { z } from "zod";
import { CanvasNodeType, canvasGraphSchema, canvasNodeSchema, connectionSchema, nodeMetadataSchema, type CanvasGraph, type CanvasNodeData, type CanvasNodeMetadata, type CanvasConnection } from "../schema/canvas.js";
import { applyGroupSelection, applyUngroupSelection, collectGroupMemberNodes, getGroupWrapRect, setGroupMembers } from "./groups.js";

export type CanvasDocumentOp =
    | { type: "add_node"; node: CanvasNodeData }
    | { type: "update_node"; id: string; patch?: Partial<Pick<CanvasNodeData, "type" | "title" | "position" | "width" | "height" | "metadata">>; metadata?: CanvasNodeMetadata }
    | { type: "move_nodes"; items: Array<{ id: string; x?: number; y?: number; dx?: number; dy?: number }> }
    | { type: "group_nodes"; ids: string[]; id: string; title: string }
    | { type: "ungroup_nodes"; ids: string[] }
    | { type: "set_group_members"; groupId: string; nodeIds: string[] }
    | { type: "delete_node"; ids: string[] }
    | { type: "delete_connections"; ids: string[]; all?: boolean }
    | { type: "connect_nodes"; connection: CanvasConnection }
    | { type: "replace_graph"; graph: CanvasGraph };

const nodePropertiesSchema = canvasNodeSchema.omit({ metadata: true });
const nodePatchSchema = canvasNodeSchema.pick({ type: true, title: true, position: true, width: true, height: true, metadata: true }).partial();

export const canvasDocumentOpSchema: z.ZodType<CanvasDocumentOp> = z.discriminatedUnion("type", [
    z.object({ type: z.literal("add_node"), node: canvasNodeSchema }).strict(),
    z.object({ type: z.literal("update_node"), id: z.string(), patch: nodePatchSchema.optional(), metadata: nodeMetadataSchema.optional() }).strict(),
    z.object({ type: z.literal("move_nodes"), items: z.array(z.object({ id: z.string(), x: z.number().finite().optional(), y: z.number().finite().optional(), dx: z.number().finite().optional(), dy: z.number().finite().optional() }).strict()) }).strict(),
    z.object({ type: z.literal("group_nodes"), ids: z.array(z.string()), id: z.string(), title: z.string() }).strict(),
    z.object({ type: z.literal("ungroup_nodes"), ids: z.array(z.string()) }).strict(),
    z.object({ type: z.literal("set_group_members"), groupId: z.string(), nodeIds: z.array(z.string()) }).strict(),
    z.object({ type: z.literal("delete_node"), ids: z.array(z.string()) }).strict(),
    z.object({ type: z.literal("delete_connections"), ids: z.array(z.string()), all: z.boolean().optional() }).strict(),
    z.object({ type: z.literal("connect_nodes"), connection: connectionSchema }).strict(),
    z.object({ type: z.literal("replace_graph"), graph: canvasGraphSchema }).strict(),
]);

/**
 * 只应用文档修改；不生成 ID、不读写存储、不触发 UI 或模型调用。
 * 任意操作失败时输入文档保持原样，调用者不会取得部分结果。
 */
export function applyOps<T extends CanvasGraph>(document: T, ops: CanvasDocumentOp[]): T {
    let { nodes, connections } = document;
    for (const op of ops) {
        switch (op.type) {
            case "add_node": {
                if (nodes.some((node) => node.id === op.node.id)) throw new Error("NODE_ID_EXISTS");
                nodes = [...nodes, canvasNodeSchema.parse(structuredClone(op.node))];
                break;
            }
            case "update_node": {
                if (!nodes.some((node) => node.id === op.id)) throw new Error("NODE_NOT_FOUND");
                const patch = op.patch && nodePatchSchema.parse(structuredClone(op.patch));
                const metadata = op.metadata && nodeMetadataSchema.parse(structuredClone(op.metadata));
                if (patch?.position) nodes = moveNodes(nodes, [{ id: op.id, ...patch.position }]);
                nodes = nodes.map((node) => {
                    if (node.id !== op.id) return node;
                    const changes = { ...patch?.metadata, ...metadata };
                    const updated = { ...node, ...patch, metadata: patch?.metadata || metadata ? { ...node.metadata, ...changes, ...(changes.prompt !== undefined && changes.composerContent === undefined ? { composerContent: changes.prompt } : {}) } : node.metadata };
                    nodePropertiesSchema.parse(updated);
                    return updated;
                });
                break;
            }
            case "move_nodes": nodes = moveNodes(nodes, op.items); break;
            case "group_nodes": {
                if (op.ids.some((id) => !nodes.some((node) => node.id === id))) throw new Error("NODE_NOT_FOUND");
                if (nodes.some((node) => node.id === op.id)) throw new Error("NODE_ID_EXISTS");
                const members = collectGroupMemberNodes(new Set(op.ids), nodes);
                if (members.length < 2) throw new Error("GROUP_REQUIRES_MEMBERS");
                const rect = getGroupWrapRect(members);
                const group: CanvasNodeData = { id: op.id, type: CanvasNodeType.Group, title: op.title, position: { x: rect.x, y: rect.y }, width: rect.width, height: rect.height, metadata: {} };
                ({ nodes, connections } = applyGroupSelection(new Set(op.ids), nodes, connections, group)!);
                break;
            }
            case "ungroup_nodes": {
                if (op.ids.some((id) => !nodes.some((node) => node.id === id))) throw new Error("NODE_NOT_FOUND");
                const result = applyUngroupSelection(new Set(op.ids), nodes, connections);
                if (!result) throw new Error("GROUP_NOT_FOUND");
                ({ nodes, connections } = result);
                break;
            }
            case "set_group_members": ({ nodes, connections } = setGroupMembers(op.groupId, new Set(op.nodeIds), nodes, connections)); break;
            case "delete_node": {
                const ids = new Set(op.ids);
                if (op.ids.some((id) => !nodes.some((node) => node.id === id))) throw new Error("NODE_NOT_FOUND");
                nodes = nodes.filter((node) => !ids.has(node.id)).map((node) => node.metadata?.groupId && ids.has(node.metadata.groupId) ? { ...node, metadata: { ...node.metadata, groupId: undefined } } : node);
                connections = connections.filter((edge) => !ids.has(edge.fromNodeId) && !ids.has(edge.toNodeId));
                break;
            }
            case "delete_connections": connections = op.all ? [] : connections.filter((edge) => !op.ids.includes(edge.id)); break;
            case "connect_nodes": {
                const edge = op.connection;
                if (!nodes.some((node) => node.id === edge.fromNodeId) || !nodes.some((node) => node.id === edge.toNodeId)) throw new Error("NODE_NOT_FOUND");
                if (nodes.find((node) => node.id === edge.toNodeId)?.type === CanvasNodeType.Group) throw new Error("GROUP_CONNECTION_TARGET");
                if (!connections.some((item) => item.fromNodeId === edge.fromNodeId && item.toNodeId === edge.toNodeId)) {
                    if (connections.some((item) => item.id === edge.id)) throw new Error("CONNECTION_ID_EXISTS");
                    connections = [...connections, connectionSchema.parse(structuredClone(edge))];
                }
                break;
            }
            case "replace_graph": {
                const previousNodes = new Set(nodes);
                const previousById = new Map(nodes.map((node) => [node.id, node]));
                const previousConnections = new Set(connections);
                nodes = op.graph.nodes.map((node) => {
                    if (previousNodes.has(node)) return node;
                    const previous = previousById.get(node.id);
                    const sameContent = previous !== undefined && previous.metadata === node.metadata;
                    const parsed = canvasNodeSchema.parse(sameContent ? node : structuredClone(node));
                    if (previous?.position === node.position) parsed.position = previous.position;
                    if (sameContent) parsed.metadata = previous.metadata;
                    else if (parsed.metadata && previous?.metadata) {
                        for (const key of Object.keys(parsed.metadata)) {
                            if (node.metadata![key] === previous.metadata[key]) parsed.metadata[key] = previous.metadata[key];
                        }
                    }
                    return parsed;
                });
                connections = op.graph.connections.map((edge) => previousConnections.has(edge) ? edge : connectionSchema.parse(structuredClone(edge)));
                if (nodes.length === document.nodes.length && nodes.every((node, index) => node === document.nodes[index])) nodes = document.nodes;
                if (connections.length === document.connections.length && connections.every((edge, index) => edge === document.connections[index])) connections = document.connections;
                break;
            }
        }
    }
    const byId = new Map(nodes.map((node) => [node.id, node]));
    if (byId.size !== nodes.length) throw new Error("NODE_ID_EXISTS");
    for (const node of nodes) {
        const groupId = node.metadata?.groupId;
        if (groupId !== undefined && (node.type === CanvasNodeType.Group || byId.get(groupId)?.type !== CanvasNodeType.Group)) throw new Error("GROUP_MEMBER_INVALID");
    }
    if (new Set(connections.map((edge) => edge.id)).size !== connections.length) throw new Error("CONNECTION_ID_EXISTS");
    const links = new Set<string>();
    for (const edge of connections) {
        if (!byId.has(edge.fromNodeId) || !byId.has(edge.toNodeId)) throw new Error("NODE_NOT_FOUND");
        if (byId.get(edge.toNodeId)?.type === CanvasNodeType.Group) throw new Error("GROUP_CONNECTION_TARGET");
        const key = JSON.stringify([edge.fromNodeId, edge.toNodeId]);
        if (links.has(key)) throw new Error("CONNECTION_ID_EXISTS");
        links.add(key);
    }
    return nodes === document.nodes && connections === document.connections ? document : { ...document, nodes, connections };
}

function moveNodes(nodes: CanvasNodeData[], items: Extract<CanvasDocumentOp, { type: "move_nodes" }>["items"]) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const positions = new Map(items.map((item) => {
        const node = byId.get(item.id);
        if (!node) throw new Error("NODE_NOT_FOUND");
        return [item.id, { x: item.x ?? node.position.x + (item.dx ?? 0), y: item.y ?? node.position.y + (item.dy ?? 0) }] as const;
    }));
    return nodes.map((node) => {
        const position = positions.get(node.id);
        if (position) return { ...node, position };
        const group = node.metadata?.groupId ? byId.get(node.metadata.groupId) : undefined;
        const target = group && positions.get(group.id);
        return group?.type === CanvasNodeType.Group && target ? { ...node, position: { x: node.position.x + target.x - group.position.x, y: node.position.y + target.y - group.position.y } } : node;
    });
}
