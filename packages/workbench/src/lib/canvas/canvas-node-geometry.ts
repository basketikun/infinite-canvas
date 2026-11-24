import { CanvasNodeType, type CanvasNodeData } from "@infinite-canvas/shared/canvas/schema/canvas";
import { type ConnectionHandle, type ViewportTransform } from "@workbench/types/canvas";

export function getConnectionTargetAnchor(node: CanvasNodeData, current: ConnectionHandle) {
    return {
        x: current.handleType === "source" ? node.position.x : node.position.x + node.width,
        y: node.position.y + node.height / 2,
    };
}

export function normalizeConnection(firstNodeId: string, secondNodeId: string, nodes: CanvasNodeData[], firstHandleType: "source" | "target") {
    const first = nodes.find((node) => node.id === firstNodeId);
    const second = nodes.find((node) => node.id === secondNodeId);
    if (!first || !second || first.id === second.id) return null;
    const [from, to] = firstHandleType === "source" ? [first, second] : [second, first];
    return to.type === CanvasNodeType.Group ? null : { fromNodeId: from.id, toNodeId: to.id };
}

export type FocusFrame = {
    // Screen-space room taken above/below the node by open overlays (hover toolbar, prompt panel), gaps included.
    above?: number;
    below?: number;
    // Fixed chrome covering the bottom edge of the canvas (dock), excluded from the usable area.
    bottomInset?: number;
};

// Viewport that centers the node (plus any open overlay above/below) in the usable canvas area, zoomed so the
// whole thing fits (the node itself is kept within 60% of the viewport). When an overlay is open below the node,
// the remaining space is split 3:1 so the panel sits closer to the bottom dock (half the usual bottom gap).
export function focusViewportForNode(node: Pick<CanvasNodeData, "position" | "width" | "height">, size: { width: number; height: number }, frame: FocusFrame = {}): ViewportTransform {
    const above = frame.above ?? 0;
    const below = frame.below ?? 0;
    const usableBottom = Math.max(0, size.height - (frame.bottomInset ?? 0));
    const nodeCenterX = node.position.x + node.width / 2;
    const nodeCenterY = node.position.y + node.height / 2;
    const verticalRoom = usableBottom * 0.92 - above - below;
    const k = Math.min(Math.max(Math.min((size.width * 0.6) / node.width, (size.height * 0.6) / node.height, verticalRoom / node.height), 0.05), 1);
    const groupHeight = above + node.height * k + below;
    const slack = usableBottom - groupHeight;
    const groupTop = slack * (below > 0 && slack > 0 ? 0.75 : 0.5);
    return { x: size.width / 2 - nodeCenterX * k, y: groupTop + groupHeight / 2 - nodeCenterY * k - (below - above) / 2, k };
}
