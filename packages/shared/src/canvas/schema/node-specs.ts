import { CanvasNodeType, type CanvasNodeMetadata } from "./canvas.js";

type CanvasNodeSpec = {
    width: number;
    height: number;
    title: string;
    metadata?: CanvasNodeMetadata;
};

export const NODE_DEFAULT_SIZE = {
    [CanvasNodeType.Image]: { width: 340, height: 240, title: "图片" },
    [CanvasNodeType.Text]: { width: 340, height: 240, title: "文本" },
    [CanvasNodeType.Video]: { width: 420, height: 236, title: "视频" },
    [CanvasNodeType.Audio]: { width: 340, height: 120, title: "音频" },
    [CanvasNodeType.Group]: { width: 760, height: 480, title: "组" },
} satisfies Record<CanvasNodeType, { width: number; height: number; title: string }>;

export const NODE_SPECS = {
    [CanvasNodeType.Image]: {
        width: 340, height: 240, title: NODE_DEFAULT_SIZE[CanvasNodeType.Image].title,
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Text]: {
        width: 340, height: 240, title: NODE_DEFAULT_SIZE[CanvasNodeType.Text].title,
        metadata: { content: "", status: "idle", fontSize: 14 },
    },
    [CanvasNodeType.Video]: {
        width: 420, height: 236, title: NODE_DEFAULT_SIZE[CanvasNodeType.Video].title,
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Audio]: {
        width: 340, height: 120, title: NODE_DEFAULT_SIZE[CanvasNodeType.Audio].title,
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Group]: {
        width: 760, height: 480, title: NODE_DEFAULT_SIZE[CanvasNodeType.Group].title,
        metadata: { status: "idle" },
    },
} satisfies Record<CanvasNodeType, CanvasNodeSpec>;

