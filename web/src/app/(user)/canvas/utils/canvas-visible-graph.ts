import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "../types";

export type ViewportSize = {
    width: number;
    height: number;
};

export function getVisibleNodes(nodes: CanvasNodeData[], viewport: ViewportTransform, viewportSize: ViewportSize, padding = 400) {
    const left = (-viewport.x - padding) / viewport.k;
    const top = (-viewport.y - padding) / viewport.k;
    const right = (-viewport.x + viewportSize.width + padding) / viewport.k;
    const bottom = (-viewport.y + viewportSize.height + padding) / viewport.k;

    return nodes.filter((node) => node.position.x + node.width >= left && node.position.x <= right && node.position.y + node.height >= top && node.position.y <= bottom);
}

export function getVisibleConnections(connections: CanvasConnection[], visibleNodeIds: Set<string>) {
    return connections.filter((connection) => visibleNodeIds.has(connection.fromNodeId) || visibleNodeIds.has(connection.toNodeId));
}
