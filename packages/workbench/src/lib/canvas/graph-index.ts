import type { CanvasSnapshot, ReadonlyCanvasConnection, ReadonlyCanvasNode } from "@infinite-canvas/plugin-sdk";

type NodeEntry = { node: ReadonlyCanvasNode; order: number };
type Adjacency = { upstream: Map<string, string[]>; downstream: Map<string, string[]> };

// 节点位置变化只替换节点快照，同一份连线仍可复用邻接表。
const nodesBySnapshot = new WeakMap<readonly ReadonlyCanvasNode[], ReadonlyMap<string, NodeEntry>>();
const edgesBySnapshot = new WeakMap<readonly ReadonlyCanvasConnection[], Adjacency>();

export function canvasNodeIndex(nodes: readonly ReadonlyCanvasNode[]) {
    let index = nodesBySnapshot.get(nodes);
    if (!index) {
        index = new Map(nodes.map((node, order) => [node.id, { node, order }]));
        nodesBySnapshot.set(nodes, index);
    }
    return index;
}

function addNeighbor(index: Map<string, string[]>, id: string, neighbor: string) {
    const list = index.get(id);
    if (list) list.push(neighbor);
    else index.set(id, [neighbor]);
}

export function canvasNeighbors(graph: Pick<CanvasSnapshot, "nodes" | "connections">, nodeId: string, direction: keyof Adjacency, order: "connection" | "node") {
    let adjacency = edgesBySnapshot.get(graph.connections);
    if (!adjacency) {
        adjacency = { upstream: new Map(), downstream: new Map() };
        for (const edge of graph.connections) {
            addNeighbor(adjacency.upstream, edge.toNodeId, edge.fromNodeId);
            addNeighbor(adjacency.downstream, edge.fromNodeId, edge.toNodeId);
        }
        edgesBySnapshot.set(graph.connections, adjacency);
    }
    const neighbors = adjacency[direction].get(nodeId);
    if (!neighbors) return [];
    const index = canvasNodeIndex(graph.nodes);
    const entries: NodeEntry[] = [];
    for (const id of order === "node" ? new Set(neighbors) : neighbors) {
        const entry = index.get(id);
        if (entry) entries.push(entry);
    }
    if (order === "node") entries.sort((a, b) => a.order - b.order);
    return entries.map(entry => entry.node);
}
