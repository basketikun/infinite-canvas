import type { ToolName } from "./schemas.js";
import { nextCanvasX } from "./tools.js";
import type { CanvasSnapshot } from "./types.js";

export type CanvasToolRequest = { name: "canvas_apply_ops"; input: Record<string, unknown> };

/** 将上层画布工具调用转换为前端可执行的批量操作。 */
export function buildCanvasToolRequest(name: ToolName, input: Record<string, unknown>, state: CanvasSnapshot | null, createId: () => string): CanvasToolRequest {
    if (name === "canvas_apply_ops") return { name, input };
    if (name === "canvas_create_text_nodes") {
        const data = input as { items: Array<{ text: string; title?: string; x?: number; y?: number; width?: number; height?: number }>; x?: number; y?: number; gap?: number; direction?: "row" | "column" };
        const x = Number(data.x ?? nextCanvasX(state));
        const y = Number(data.y ?? 0);
        const gap = Number(data.gap ?? 40);
        let offset = 0;
        return applyOps(data.items.map((item) => {
            const op = textNodeOp(item, item.x ?? (data.direction === "row" ? x + offset : x), item.y ?? (data.direction === "row" ? y : y + offset));
            offset += (data.direction === "row" ? item.width ?? 340 : item.height ?? 240) + gap;
            return op;
        }));
    }
    if (name === "canvas_create_generation_flow") return applyOps(generationFlowOps(input, state, createId));
    throw new Error(`未知工具：${name}`);
}

/** 创建统一的批量画布操作请求。 */
function applyOps(ops: unknown[]): CanvasToolRequest {
    return { name: "canvas_apply_ops", input: { ops } };
}

/** 创建文本节点操作。 */
function textNodeOp(input: { id?: string; text?: string; title?: string; width?: number; height?: number }, x: number, y: number) {
    return { type: "add_node", id: input.id, nodeType: "text", title: input.title, position: { x, y }, width: input.width, height: input.height, metadata: { content: input.text || "", status: "success", fontSize: 14 } };
}

/** 创建目标节点，将指定的参考素材直接连入该节点。 */
function generationFlowOps(input: Record<string, unknown>, state: CanvasSnapshot | null, createId: () => string) {
    const mode = generationMode(input.mode);
    const id = `${mode}-${createId()}`;
    const prompt = String(input.prompt || "");
    const referenceNodeIds = (input.referenceNodeIds ?? []) as string[];
    const metadata = cleanRecord({
        prompt,
        model: input.model,
        size: input.size,
        quality: input.quality,
        ...(mode === "text" ? { textCount: input.count } : { count: input.count }),
        seconds: input.seconds,
        vquality: input.vquality,
        generateAudio: input.generateAudio,
        watermark: input.watermark,
        videoMode: input.videoMode,
        audioVoice: input.audioVoice,
        audioFormat: input.audioFormat,
        audioSpeed: input.audioSpeed,
        audioInstructions: input.audioInstructions,
    });
    return [
        { type: "add_node", id, nodeType: mode, title: input.title || generationTitle(mode), metadata,
            position: { x: input.x ?? nextCanvasX(state), y: input.y ?? 0 }, width: input.width, height: input.height },
        ...referenceNodeIds.map((fromNodeId) => ({ type: "connect_nodes", fromNodeId, toNodeId: id })),
        { type: "select_nodes", ids: [id] },
        ...(input.autoRun ? [runGenerationOp(id, mode, prompt)] : []),
    ];
}

/** 创建触发节点生成的画布操作。 */
function runGenerationOp(nodeId: string, mode?: string, prompt?: string) {
    return { type: "run_generation", nodeId, mode, prompt };
}

/** 将未知生成模式归一为画布支持的模式。 */
function generationMode(value: unknown): "text" | "image" | "video" | "audio" {
    return value === "text" || value === "video" || value === "audio" ? value : "image";
}

/** 获取生成模式对应的默认节点标题。 */
function generationTitle(mode: "text" | "image" | "video" | "audio") {
    if (mode === "text") return "文本生成";
    if (mode === "video") return "视频生成";
    if (mode === "audio") return "音频生成";
    return "图片生成";
}

/** 移除对象中未设置的生成参数。 */
function cleanRecord(value: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}
