import crypto from "node:crypto";
import type { ServerResponse } from "node:http";

import { type ToolName } from "./schemas.js";
import { compactCanvasState, compactNode, isToolName, nextCanvasX, parseToolInput } from "./tools.js";
import type { CanvasNode, CanvasNodeType, CanvasSnapshot } from "./types.js";

type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void };

const SITE_TOOLS = new Set<ToolName>([
    "site_navigate",
    "canvas_list_projects",
    "workbench_image_get_config",
    "workbench_image_generate",
    "workbench_video_get_config",
    "workbench_video_generate",
    "prompts_search",
    "assets_list",
    "assets_add",
]);

export class CanvasSession {
    private clients = new Map<string, ServerResponse>();
    private pending = new Map<string, PendingRequest>();
    private canvasState: CanvasSnapshot | null = null;

    health() {
        return { ok: true, hasCanvas: Boolean(this.canvasState), clients: this.clients.size };
    }

    openEvents(url: URL, res: ServerResponse) {
        const clientId = url.searchParams.get("clientId") || crypto.randomUUID();
        const statusOnly = url.searchParams.get("role") === "status";
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        if (!statusOnly) this.clients.set(clientId, res);
        sendEvent(res, "hello", { ok: true, clientId });
        const timer = setInterval(() => sendEvent(res, "ping", { time: Date.now() }), 15000);
        res.on("close", () => {
            clearInterval(timer);
            if (!statusOnly) this.clients.delete(clientId);
            if (this.canvasState?.clientId === clientId) this.canvasState = null;
        });
    }

    updateState(body: unknown, clientId?: string) {
        this.canvasState = { ...((body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>), clientId } as CanvasSnapshot;
    }

    resolveResult(body: { requestId?: string; error?: string; result?: unknown }) {
        const item = body.requestId ? this.pending.get(body.requestId) : null;
        if (!item || !body.requestId) return;
        this.pending.delete(body.requestId);
        body.error ? item.reject(new Error(body.error)) : item.resolve(body.result);
    }

    emitAll(type: string, payload: unknown) {
        this.clients.forEach((client) => sendEvent(client, type, payload));
    }

    async callTool(name: unknown, rawInput: unknown) {
        if (!isToolName(name)) throw new Error(`未知工具：${String(name)}`);
        let tool: ToolName = name;
        let input = parseToolInput(tool, rawInput) as Record<string, unknown>;
        if (SITE_TOOLS.has(tool)) {
            if (!this.clients.size) throw new Error("当前没有已连接网页");
            return await this.requestCanvasTool(tool, input);
        }
        const readTool = ["canvas_get_state", "canvas_get_selection", "canvas_export_snapshot"].includes(tool);
        if (readTool && (!this.clients.size || !this.canvasState)) throw new Error("当前没有已连接画布");
        if (tool === "canvas_get_state" || tool === "canvas_export_snapshot") return compactCanvasState(this.canvasState);
        if (tool === "canvas_get_selection") {
            const ids = new Set(this.canvasState?.selectedNodeIds || []);
            return { nodes: (this.canvasState?.nodes || []).filter((node) => ids.has(node.id)).map(compactNode) };
        }
        if (tool === "canvas_create_node") {
            const data = input as { nodeType: CanvasNodeType; title?: string; x?: number; y?: number; width?: number; height?: number; metadata?: Record<string, unknown> };
            input = { ops: [{ type: "add_node", nodeType: data.nodeType, title: data.title, position: { x: data.x ?? nextCanvasX(this.canvasState), y: data.y ?? 0 }, width: data.width, height: data.height, metadata: data.metadata }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_create_text_node") {
            const text = input as { text?: string; x?: number; y?: number; title?: string; width?: number; height?: number };
            input = { ops: [textNodeOp(text, text.x ?? nextCanvasX(this.canvasState), text.y ?? 0)] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_create_text_nodes") {
            const data = input as { items: Array<{ text: string; title?: string; x?: number; y?: number; width?: number; height?: number }>; x?: number; y?: number; gap?: number; direction?: "row" | "column" };
            const x = Number(data.x ?? nextCanvasX(this.canvasState));
            const y = Number(data.y ?? 0);
            const gap = Number(data.gap ?? 40);
            input = {
                ops: data.items.map((item, index) => textNodeOp(item, item.x ?? (data.direction === "row" ? x + index * (340 + gap) : x), item.y ?? (data.direction === "row" ? y : y + index * (240 + gap)))),
            };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_create_image_prompt_flow") {
            input = { ops: generationFlowOps({ ...(input as Record<string, unknown>), mode: "image" }, this.canvasState) };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_create_config_node") {
            const data = input as Record<string, unknown>;
            const x = Number(data.x ?? nextCanvasX(this.canvasState));
            const y = Number(data.y ?? 0);
            const configId = `config-${crypto.randomUUID()}`;
            const mode = generationMode(data.mode);
            const prompt = String(data.prompt || "");
            input = { ops: [configNodeOp(configId, data, x, y), ...(data.autoRun ? [runGenerationOp(configId, mode, prompt)] : [])] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_create_generation_flow") {
            input = { ops: generationFlowOps(input as Record<string, unknown>, this.canvasState) };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_generate_text" || tool === "canvas_generate_image" || tool === "canvas_generate_video" || tool === "canvas_generate_audio") {
            input = { ops: generationFlowOps({ ...(input as Record<string, unknown>), mode: tool.replace("canvas_generate_", ""), autoRun: true }, this.canvasState) };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_update_node") {
            const data = input as { id: string; patch?: Record<string, unknown>; metadata?: Record<string, unknown> };
            input = { ops: [{ type: "update_node", id: data.id, patch: data.patch, metadata: data.metadata }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_update_node_text") {
            const data = input as { id: string; text: string; title?: string };
            input = { ops: [{ type: "update_node", id: data.id, patch: { ...(data.title ? { title: data.title } : {}) }, metadata: { content: data.text, status: "success" } }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_move_nodes") {
            const data = input as { items: Array<{ id: string; x?: number; y?: number; dx?: number; dy?: number }> };
            input = {
                ops: data.items.map((item) => {
                    const current = findNode(this.canvasState, item.id);
                    return { type: "update_node", id: item.id, patch: { position: { x: item.x ?? ((current?.position.x || 0) + (item.dx || 0)), y: item.y ?? ((current?.position.y || 0) + (item.dy || 0)) } } };
                }),
            };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_resize_node") {
            const data = input as { id: string; width: number; height: number; freeResize?: boolean };
            input = { ops: [{ type: "update_node", id: data.id, patch: { width: data.width, height: data.height }, metadata: data.freeResize === undefined ? undefined : { freeResize: data.freeResize } }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_delete_nodes") {
            input = { ops: [{ type: "delete_node", ids: (input as { ids: string[] }).ids }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_connect_nodes") {
            const data = input as { connections: Array<{ fromNodeId: string; toNodeId: string }> };
            input = { ops: data.connections.map((connection) => ({ type: "connect_nodes", ...connection })) };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_select_nodes") {
            input = { ops: [{ type: "select_nodes", ids: (input as { ids: string[] }).ids }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_set_viewport") {
            input = { ops: [{ type: "set_viewport", viewport: (input as { viewport: unknown }).viewport }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_run_generation") {
            const data = input as { nodeId: string; mode?: string; prompt?: string };
            input = { ops: [runGenerationOp(data.nodeId, generationMode(data.mode), data.prompt)] };
            tool = "canvas_apply_ops";
        }
        if (tool !== "canvas_apply_ops") throw new Error(`未知工具：${tool}`);
        if (!this.clients.size) throw new Error("当前没有已连接画布");
        return await this.requestCanvasTool(tool, input);
    }

    private async requestCanvasTool(name: ToolName, input: Record<string, unknown>) {
        const requestId = crypto.randomUUID();
        const client = this.clients.get(this.canvasState?.clientId || "") || this.clients.values().next().value;
        if (!client) throw new Error("当前没有已连接画布");
        sendEvent(client, "tool_call", { requestId, name, input });
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error("画布操作超时"));
            }, 30000);
            this.pending.set(requestId, { resolve: (value) => (clearTimeout(timer), resolve(value)), reject: (error) => (clearTimeout(timer), reject(error)) });
        });
    }
}

function sendEvent(res: ServerResponse, type: string, payload: unknown) {
    res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function textNodeOp(input: { id?: string; text?: string; title?: string; width?: number; height?: number }, x: number, y: number) {
    return { type: "add_node", id: input.id, nodeType: "text", title: input.title, position: { x, y }, width: input.width, height: input.height, metadata: { content: input.text || "", status: "success", fontSize: 14 } };
}

function configNodeOp(id: string, input: Record<string, unknown>, x: number, y: number) {
    const mode = generationMode(input.mode);
    const prompt = String(input.prompt || "");
    return {
        type: "add_node",
        id,
        nodeType: "config",
        title: String(input.title || generationTitle(mode)),
        position: { x, y },
        width: typeof input.width === "number" ? input.width : undefined,
        height: typeof input.height === "number" ? input.height : undefined,
        metadata: cleanRecord({
            generationMode: mode,
            composerContent: prompt,
            prompt,
            status: "idle",
            model: input.model,
            size: input.size,
            quality: input.quality,
            count: input.count,
            seconds: input.seconds,
            vquality: input.vquality,
            generateAudio: input.generateAudio,
            watermark: input.watermark,
            audioVoice: input.audioVoice,
            audioFormat: input.audioFormat,
            audioSpeed: input.audioSpeed,
            audioInstructions: input.audioInstructions,
        }),
    };
}

function generationFlowOps(input: Record<string, unknown>, state: CanvasSnapshot | null) {
    const mode = generationMode(input.mode);
    const prompt = String(input.prompt || "");
    const x = Number(input.x ?? nextCanvasX(state));
    const y = Number(input.y ?? 0);
    const textId = `text-${crypto.randomUUID()}`;
    const configId = `config-${crypto.randomUUID()}`;
    const referenceNodeIds = Array.isArray(input.referenceNodeIds) ? input.referenceNodeIds.filter((id): id is string => typeof id === "string") : [];
    const tokens = [`@[node:${textId}]`, ...referenceNodeIds.map((id) => `@[node:${id}]`)];
    const configInput = { ...input, prompt: tokens.join("\n") };
    return [
        textNodeOp({ id: textId, text: prompt, title: String(input.title || "提示词") }, x, y),
        configNodeOp(configId, configInput, x + 420, y),
        { type: "connect_nodes", fromNodeId: textId, toNodeId: configId },
        ...referenceNodeIds.map((fromNodeId) => ({ type: "connect_nodes", fromNodeId, toNodeId: configId })),
        { type: "select_nodes", ids: [configId] },
        ...(input.autoRun ? [runGenerationOp(configId, mode, tokens.join("\n"))] : []),
    ];
}

function runGenerationOp(nodeId: string, mode: "text" | "image" | "video" | "audio", prompt?: string) {
    return { type: "run_generation", nodeId, mode, prompt };
}

function generationMode(value: unknown): "text" | "image" | "video" | "audio" {
    return value === "text" || value === "video" || value === "audio" ? value : "image";
}

function generationTitle(mode: "text" | "image" | "video" | "audio") {
    if (mode === "text") return "文本生成";
    if (mode === "video") return "视频生成";
    if (mode === "audio") return "音频生成";
    return "图片生成";
}

function findNode(state: CanvasSnapshot | null, id: string): CanvasNode | undefined {
    return (state?.nodes || []).find((node) => node.id === id);
}

function cleanRecord(value: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}
