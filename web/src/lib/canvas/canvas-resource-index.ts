import type { CanvasGraphIndex } from "./canvas-graph-index";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type CanvasResourceIndex = {
    readonly graph: CanvasGraphIndex;
    readonly resourceIds: ReadonlySet<string>;
    readonly groupResources: ReadonlyMap<string, readonly CanvasNodeData[]>;
    readonly inputs: ReadonlyMap<string, readonly CanvasNodeData[]>;
    readonly firstConfig: ReadonlyMap<string, string>;
};

const EMPTY_NODES: readonly CanvasNodeData[] = Object.freeze([]);

export function isIndexedCanvasReferenceNode(index: Pick<CanvasResourceIndex, "resourceIds" | "groupResources">, node: CanvasNodeData) {
    return index.resourceIds.has(node.id) || (node.type === CanvasNodeType.Group && index.groupResources.has(node.id));
}

export function createCanvasResourceIndex(graph: CanvasGraphIndex, isResource: (node: CanvasNodeData) => boolean): CanvasResourceIndex {
    const resourceIds = new Set<string>();
    for (const node of graph.nodeById.values()) {
        if (isResource(node)) resourceIds.add(node.id);
    }
    const groupResources = new Map<string, readonly CanvasNodeData[]>();
    for (const [id, children] of graph.children) {
        const resources = children.filter((node) => resourceIds.has(node.id));
        if (resources.length) groupResources.set(id, resources);
    }
    const eligibility = { resourceIds, groupResources };
    const inputs = new Map<string, readonly CanvasNodeData[]>();
    for (const [id, sources] of graph.connectedNodes) {
        const resources = sources.filter((node) => isIndexedCanvasReferenceNode(eligibility, node));
        if (resources.length) inputs.set(id, resources);
    }
    const firstConfig = new Map<string, string>();
    for (const [id, edges] of graph.outgoing) {
        const edge = edges.find((edge) => graph.nodeById.get(edge.toNodeId)?.type === CanvasNodeType.Config);
        if (edge) firstConfig.set(id, edge.toNodeId);
    }
    return { graph, resourceIds, groupResources, inputs, firstConfig };
}

function configInputs(index: CanvasResourceIndex, nodeId: string) {
    const configId = index.firstConfig.get(nodeId);
    if (!configId) return EMPTY_NODES;
    return index.inputs.get(configId)?.filter((node) => node.id !== nodeId) || EMPTY_NODES;
}

export function getIndexedGenerationResourceNodes(index: CanvasResourceIndex, nodeId: string) {
    const peers = configInputs(index, nodeId);
    return peers.length ? peers : index.inputs.get(nodeId) || EMPTY_NODES;
}

function expandResources(index: CanvasResourceIndex, nodes: readonly CanvasNodeData[]) {
    if (!nodes.length) return EMPTY_NODES;
    if (nodes.length === 1 && nodes[0].type !== CanvasNodeType.Group) return nodes;
    const resources = new Map<string, CanvasNodeData>();
    for (const node of nodes) {
        if (node.type !== CanvasNodeType.Group) resources.set(node.id, node);
        else index.groupResources.get(node.id)?.forEach((child) => resources.set(child.id, child));
    }
    return [...resources.values()];
}

export function getIndexedMentionResourceNodes(index: CanvasResourceIndex, nodeId: string) {
    const peers = expandResources(index, configInputs(index, nodeId));
    if (peers.length) return peers;
    const own = expandResources(index, index.inputs.get(nodeId) || EMPTY_NODES);
    if (own.length) return own;
    const node = index.graph.nodeById.get(nodeId);
    return node && index.resourceIds.has(nodeId) ? [node] : EMPTY_NODES;
}
