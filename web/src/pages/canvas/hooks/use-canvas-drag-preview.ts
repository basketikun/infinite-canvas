import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { canvasConnectionPath } from "@/lib/canvas/canvas-connection-path";
import type { CanvasGraphIndex } from "@/lib/canvas/canvas-graph-index";
import { canvasDragPosition, type CanvasDragPreview } from "@/lib/canvas/canvas-node-drag";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

const PREVIEW_ATTRIBUTE = "data-canvas-drag-preview";

function positionNode(element: HTMLElement, node: CanvasNodeData, preview: CanvasDragPreview | null) {
    if (!preview?.positions.has(node.id)) {
        if (element.hasAttribute(PREVIEW_ATTRIBUTE)) element.style.removeProperty("translate");
        element.removeAttribute(PREVIEW_ATTRIBUTE);
        return;
    }
    const position = canvasDragPosition(node, preview);
    element.style.translate = `${position.x - node.position.x}px ${position.y - node.position.y}px`;
    element.setAttribute(PREVIEW_ATTRIBUTE, "node");
}

function positionConnection(element: SVGPathElement, endpoints: { from: CanvasNodeData; to: CanvasNodeData }, preview: CanvasDragPreview | null) {
    const group = element.parentElement!;
    const { from, to } = endpoints;
    if (!preview?.positions.has(from.id) && !preview?.positions.has(to.id) && !group.hasAttribute(PREVIEW_ATTRIBUTE)) return;
    const start = canvasDragPosition(from, preview);
    const end = canvasDragPosition(to, preview);
    const dx = start.x - from.position.x;
    const dy = start.y - from.position.y;
    const translatesTogether = dx === end.x - to.position.x && dy === end.y - to.position.y;
    const path = translatesTogether ? canvasConnectionPath(from, to) : canvasConnectionPath({ ...from, position: start }, { ...to, position: end });
    if (translatesTogether && preview) group.setAttribute("transform", `translate(${dx} ${dy})`);
    else group.removeAttribute("transform");
    for (const child of group.querySelectorAll("path")) if (child.getAttribute("d") !== path) child.setAttribute("d", path);
    if (preview) group.setAttribute(PREVIEW_ATTRIBUTE, "connection");
    else group.removeAttribute(PREVIEW_ATTRIBUTE);
}

type Options = { containerRef: RefObject<HTMLDivElement | null>; graph: CanvasGraphIndex; connections: readonly CanvasConnection[] };

// Positions remain a transient edit until pointer release. Geometry culling uses the same preview;
// React node content, reference indexes, persistence and the Agent snapshot retain committed data.
export function useCanvasDragPreview({ containerRef, graph, connections }: Options) {
    const [preview, setPreview] = useState<CanvasDragPreview | null>(null);
    const latest = useRef<CanvasDragPreview | null>(null);
    const painted = useRef(false);
    const byId = useMemo(() => new Map(connections.map((edge) => [edge.id, edge])), [connections]);
    const updatePreview = useCallback((next: CanvasDragPreview | null) => { latest.current = next; setPreview(next); }, []);
    useLayoutEffect(() => {
        if (!preview && !painted.current) return;
        painted.current = Boolean(preview);
        const container = containerRef.current;
        if (!container) return;
        for (const element of container.querySelectorAll<HTMLElement>("[data-node-id]")) {
            const node = graph.nodeById.get(element.dataset.nodeId!);
            if (node) positionNode(element, node, preview);
        }
        for (const element of container.querySelectorAll<SVGPathElement>("[data-connection-id]")) {
            const edge = byId.get(element.dataset.connectionId!);
            const from = edge && graph.nodeById.get(edge.fromNodeId);
            const to = edge && graph.nodeById.get(edge.toNodeId);
            if (from && to) positionConnection(element, { from, to }, preview);
        }
    });
    return { preview, latest, updatePreview };
}
