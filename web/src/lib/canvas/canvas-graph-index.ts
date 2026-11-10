import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export type CanvasGraphIndex = {
    readonly nodeById: ReadonlyMap<string, CanvasNodeData>;
    readonly incoming: ReadonlyMap<string, readonly CanvasConnection[]>;
    readonly outgoing: ReadonlyMap<string, readonly CanvasConnection[]>;
    readonly children: ReadonlyMap<string, readonly CanvasNodeData[]>;
    readonly connectedNodes: ReadonlyMap<string, CanvasNodeData[]>;
};

function indexBy<T>(items: readonly T[], keyOf: (item: T) => string | undefined) {
    const result = new Map<string, T[]>();
    for (const item of items) {
        const key = keyOf(item);
        if (key === undefined) continue;
        const bucket = result.get(key);
        if (bucket) bucket.push(item);
        else result.set(key, [item]);
    }
    return result;
}

// O(V + E) time and space. Buckets hold references, never copies of node/media data.
export function createCanvasGraphIndex(nodes: readonly CanvasNodeData[], connections: readonly CanvasConnection[]): CanvasGraphIndex {
    const nodeById = new Map<string, CanvasNodeData>();
    for (const node of nodes) nodeById.set(node.id, node);
    const incoming = indexBy(connections, (edge) => edge.toNodeId);
    const outgoing = indexBy(connections, (edge) => edge.fromNodeId);
    const children = indexBy(nodes, (node) => node.metadata?.groupId || undefined);
    const connectedNodes = new Map<string, CanvasNodeData[]>();
    for (const [id, edges] of incoming) {
        const sources: CanvasNodeData[] = [];
        for (const edge of edges) {
            const node = nodeById.get(edge.fromNodeId);
            if (node) sources.push(node);
        }
        if (sources.length) connectedNodes.set(id, sources);
    }
    return { nodeById, incoming, outgoing, children, connectedNodes };
}

export function getCanvasRelatedHighlight(graph: CanvasGraphIndex, activeNodeId: string | null) {
    const nodeIds = new Set<string>();
    const connectionIds = new Set<string>();
    if (!activeNodeId) return { nodeIds, connectionIds };
    const expandedGroups = new Set<string>();
    const addNode = (id: string) => {
        nodeIds.add(id);
        if (graph.nodeById.get(id)?.type !== CanvasNodeType.Group || expandedGroups.has(id)) return;
        expandedGroups.add(id);
        graph.children.get(id)?.forEach((child) => nodeIds.add(child.id));
    };
    const addEdge = (edge: CanvasConnection) => {
        connectionIds.add(edge.id);
        addNode(edge.fromNodeId);
        addNode(edge.toNodeId);
    };
    addNode(activeNodeId);
    graph.incoming.get(activeNodeId)?.forEach(addEdge);
    graph.outgoing.get(activeNodeId)?.forEach(addEdge);
    return { nodeIds, connectionIds };
}
