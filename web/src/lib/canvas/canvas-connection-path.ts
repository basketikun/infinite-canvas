import type { CanvasNodeData } from "@/types/canvas";

export function canvasConnectionPath(from: CanvasNodeData, to: CanvasNodeData) {
    const startX = from.position.x + from.width;
    const startY = from.position.y + from.height / 2;
    const endX = to.position.x;
    const endY = to.position.y + to.height / 2;
    const curvature = Math.max(Math.abs(endX - startX) * 0.5, 50);
    return `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;
}
