import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export type CanvasWorkflowTemplate = {
    id: string;
    title: string;
    createdAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};
