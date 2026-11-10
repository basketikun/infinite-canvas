import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../../src/types/canvas";

export function makeNode(id: string, type: string = CanvasNodeType.Text, patch: Partial<CanvasNodeData> = {}): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 300, height: 180, metadata: { content: `content-${id}` }, ...patch };
}

export function makeEdge(fromNodeId: string, toNodeId: string, id = `${fromNodeId}->${toNodeId}`): CanvasConnection {
    return { id, fromNodeId, toNodeId };
}

export function createMatrix(options: { textCount: number; videoCount: number; populated: boolean }) {
    const nodes = [makeNode("root")];
    const connections: CanvasConnection[] = [];
    for (let text = 0; text < options.textCount; text++) {
        const id = `text-${text}`;
        nodes.push(makeNode(id, CanvasNodeType.Text, { metadata: { content: options.populated ? `prompt-${text}` : "" } }));
        connections.push(makeEdge("root", id));
        for (let video = 0; video < options.videoCount; video++) {
            const videoId = `${id}-video-${video}`;
            nodes.push(makeNode(videoId, CanvasNodeType.Video, { metadata: {} }));
            connections.push(makeEdge(id, videoId));
        }
    }
    return { nodes, connections };
}

// Deliberately unindexed oracle for regression comparison; mirrors the previous selection rules.
export function referenceOracle(options: { nodes: CanvasNodeData[]; connections: CanvasConnection[]; isResource: (node: CanvasNodeData) => boolean }) {
    const { nodes, connections, isResource } = options;
    const children = (id: string) => nodes.filter(node => node.metadata?.groupId === id && isResource(node));
    const eligible = (node: CanvasNodeData) => isResource(node) || (node.type === CanvasNodeType.Group && children(node.id).length > 0);
    const inputs = (id: string) => connections.filter(edge => edge.toNodeId === id)
        .map(edge => nodes.find(node => node.id === edge.fromNodeId))
        .filter((node): node is CanvasNodeData => Boolean(node && eligible(node)));
    const peers = (id: string) => {
        const edge = connections.find(edge => edge.fromNodeId === id && nodes.find(node => node.id === edge.toNodeId)?.type === CanvasNodeType.Config);
        return edge ? inputs(edge.toNodeId).filter(node => node.id !== id) : [];
    };
    const expand = (sources: CanvasNodeData[]) => [...new Map(sources.flatMap(node => node.type === CanvasNodeType.Group ? children(node.id) : [node]).map(node => [node.id, node])).values()];
    return {
        generation: (id: string) => { const selected = peers(id); return selected.length ? selected : inputs(id); },
        mentions: (id: string) => {
            const config = expand(peers(id));
            if (config.length) return config;
            const own = expand(inputs(id));
            if (own.length) return own;
            const node = nodes.find(node => node.id === id);
            return node && isResource(node) ? [node] : [];
        },
    };
}
