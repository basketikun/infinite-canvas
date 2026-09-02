import { readFile } from "node:fs/promises";

import { createBackendClient, resolveComfyTask } from "../../runtime/comfy-client.js";
import { storeRuntimeMedia } from "../../runtime/media.js";
import { loadConfig } from "../../config.js";
import type { AgentCanvasNode, McpToolHandler, PluginMcpContext, PluginMcpModule, PluginMcpToolWire } from "../../server/plugin-mcp.js";

// 一个 H3 参考图/视频/音频条目(与浏览器插件 H3Ref 对齐,此处防御式解析)
type H3Ref = { url?: string; name?: string; type?: string; storageKey?: string };

// H3 片段(节点 metadata.segments 中的元素)
type H3Segment = Record<string, unknown> & {
    id?: string;
    prompt?: string;
    status?: string;
    result?: unknown;
    refs?: { image?: H3Ref | H3Ref[]; video?: H3Ref | H3Ref[]; audio?: H3Ref | H3Ref[] };
    refItems?: H3Ref[];
};

const H3_PARAM_KEYS = [
    "taskMode", "duration", "aspectRatio", "megapixels", "videoSteps", "denoise", "seed",
    "modelName", "loraName", "loraStrength", "teAccel", "audioMode", "motionContext",
    "combatLoraWeight", "cinematicLoraWeight", "tailFrameEnabled", "motionContextEnabled",
    "referenceVideoPolicy", "strictPromptTags", "refImageSize", "addSourceAsReference",
];

// 工具元信息(声明,供 Agent 动态注册)
const TOOLS: PluginMcpToolWire[] = [
    {
        id: "h3_list_models",
        version: "1.2.0",
        name: "H3 列出模型",
        description: "列出 MiniMax H3 可用的模型(unet)与 LoRA 清单。",
        inputJsonSchema: { type: "object", properties: {} },
    },
    {
        id: "h3_get_node",
        version: "1.2.0",
        name: "H3 读取画布节点",
        description: "按节点 id 读取画布上的 MiniMax H3 节点及其片段/参考图配置。",
        inputJsonSchema: { type: "object", properties: { nodeId: { type: "string", description: "画布节点 id" } }, required: ["nodeId"] },
    },
    {
        id: "h3_run_clip",
        version: "1.2.0",
        name: "H3 运行单段",
        description: "读取指定画布 H3 节点的某个片段(或全部片段),解析参考图/视频/音频后提交 ComfyUI 生成任务。",
        inputJsonSchema: {
            type: "object",
            properties: {
                nodeId: { type: "string", description: "画布节点 id" },
                segmentIndex: { type: "integer", description: "片段下标;省略则运行首个未完成的片段" },
                params: { type: "object", description: "覆盖片段自带参数的生成参数" },
            },
            required: ["nodeId"],
        },
    },
    {
        id: "h3_get_task",
        version: "1.2.0",
        name: "H3 查询任务",
        description: "按任务 id 查询 MiniMax H3 生成任务的状态、进度与结果。",
        inputJsonSchema: { type: "object", properties: { taskId: { type: "string", description: "任务 id" } }, required: ["taskId"] },
    },
    {
        id: "h3_cancel_task",
        version: "1.2.0",
        name: "H3 取消任务",
        description: "取消正在运行的 MiniMax H3 生成任务。",
        inputJsonSchema: { type: "object", properties: { taskId: { type: "string", description: "任务 id" } }, required: ["taskId"] },
    },
    {
        id: "h3_update_clip",
        version: "1.2.0",
        name: "H3 更新片段",
        description: "更新画布 H3 节点某个片段的部分字段(如 prompt、参数或状态),写回节点 metadata。",
        inputJsonSchema: {
            type: "object",
            properties: {
                nodeId: { type: "string", description: "画布节点 id" },
                segmentIndex: { type: "integer", description: "片段下标" },
                patch: { type: "object", description: "要合并进该片段的字段" },
            },
            required: ["nodeId", "segmentIndex", "patch"],
        },
    },
    {
        id: "h3_run_all_clips",
        version: "1.2.0",
        name: "H3 运行全部片段",
        description: "对画布上所有(或指定的)MiniMax H3 节点,提交其未完成片段的生成任务。",
        inputJsonSchema: {
            type: "object",
            properties: {
                nodeIds: { type: "array", items: { type: "string" }, description: "限定运行的节点 id;省略则运行全部 H3 节点" },
                params: { type: "object", description: "覆盖片段自带参数的生成参数" },
            },
        },
    },
];

function segmentsOf(node: AgentCanvasNode): H3Segment[] {
    const meta = node.metadata || {};
    const raw = meta.segments;
    if (Array.isArray(raw)) return raw as H3Segment[];
    return [];
}

function isH3Node(node: AgentCanvasNode): boolean {
    return String(node.type || "").includes("minimax");
}

function collectRefs(segment: H3Segment): { images: H3Ref[]; videos: H3Ref[]; audios: H3Ref[] } {
    const refs = segment.refs || {};
    const asArray = (value: H3Ref | H3Ref[] | undefined): H3Ref[] => {
        if (!value) return [];
        return Array.isArray(value) ? value : [value];
    };
    const images = [...asArray(refs.image), ...(segment.refItems || []).filter((r) => r.type === "image" || (!r.type && /\.(png|jpe?g|webp|gif)$/i.test(r.name || "")))];
    const videos = asArray(refs.video);
    const audios = [...asArray(refs.audio), ...(segment.refItems || []).filter((r) => r.type === "audio" || (!r.type && /\.(mp3|wav|m4a|flac)$/i.test(r.name || "")))];
    return { images, videos, audios };
}

/** 将参考条目(url/dataURL/本地路径)落地为 Agent 运行时媒体路径,供 ComfyUIBridge 上传。 */
async function resolveRefToPath(ref: H3Ref): Promise<string> {
    const url = ref.url || "";
    const name = ref.name || "ref";
    if (!url) throw new Error(`参考条目缺少可读取地址:${name}`);
    if (url.startsWith("data:")) return (await storeRuntimeMedia(name, url)).path;
    if (/^https?:\/\//i.test(url)) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`读取参考失败 HTTP ${response.status}:${name}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        const mime = response.headers.get("content-type") || "application/octet-stream";
        return (await storeRuntimeMedia(name, `data:${mime};base64,${buffer.toString("base64")}`)).path;
    }
    // 本地文件
    const buffer = await readFile(url);
    const mime = /\.png$/i.test(name) ? "image/png" : /\.jpe?g$/i.test(name) ? "image/jpeg" : /\.webp$/i.test(name) ? "image/webp" : /\.mp4$/i.test(name) ? "video/mp4" : /\.mp3$/i.test(name) ? "audio/mpeg" : "application/octet-stream";
    return (await storeRuntimeMedia(name, `data:${mime};base64,${buffer.toString("base64")}`)).path;
}

function extractParams(segment: H3Segment, override: Record<string, unknown> = {}): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    for (const key of H3_PARAM_KEYS) {
        const value = segment[key];
        if (value !== undefined && value !== null && value !== "") params[key] = value;
    }
    return { ...params, ...override };
}

function selectSegment(segments: H3Segment[], index?: number): { segment: H3Segment; index: number } {
    if (segments.length === 0) throw new Error("该节点没有可运行的 H3 片段");
    if (typeof index === "number") {
        const segment = segments[index];
        if (!segment) throw new Error(`片段下标越界:${index}`);
        return { segment, index };
    }
    const pending = segments.findIndex((s) => !s.result && s.status !== "succeeded");
    const chosen = pending >= 0 ? pending : 0;
    return { segment: segments[chosen], index: chosen };
}

async function runSegment(context: PluginMcpContext, node: AgentCanvasNode, index: number | undefined, override: Record<string, unknown>) {
    const segments = segmentsOf(node);
    const { segment } = selectSegment(segments, index);
    const { images, videos, audios } = collectRefs(segment);
    const [imagePaths, videoPaths, audioPaths] = await Promise.all([
        Promise.all(images.map(resolveRefToPath)),
        Promise.all(videos.map(resolveRefToPath)),
        Promise.all(audios.map(resolveRefToPath)),
    ]);
    const input = {
        prompt: String(segment.prompt || ""),
        references: imagePaths,
        audios: audioPaths,
        video: videoPaths[0],
    };
    const params = extractParams(segment, override);
    return context.comfyUi.run("minimax-h3", input, params);
}

let h3Backend: ReturnType<typeof createBackendClient> | null = null;
function h3ResolveTask(context: PluginMcpContext, taskId: string) {
    if (!h3Backend) {
        const config = loadConfig(true);
        h3Backend = createBackendClient(config.backendUrl || `http://127.0.0.1:17370`);
    }
    return resolveComfyTask(h3Backend, context.runtimeDb, taskId).catch(async (error) => {
        // backend 未启动时直接读本地（context.runtimeDb 就是 MCP 进程的 RuntimeDatabase）
        const task = context.runtimeDb.getTask(taskId);
        if (!task) throw error;
        return { task, events: context.runtimeDb.listEvents(taskId) };
    });
}

export const pluginMcp: PluginMcpModule = {
    id: "minimax-h3",
    version: "1.2.0",
    tools: TOOLS,
    createHandler(context: PluginMcpContext): Record<string, McpToolHandler> {
        return {
            h3_list_models: async () => {
                const catalog = await context.comfyUi.models();
                return { models: catalog.models || [], loras: catalog.loras || [] };
            },
            h3_get_node: async (input) => {
                const node = await context.getCanvasNode(String(input.nodeId || ""));
                if (!node) throw new Error(`找不到画布节点:${String(input.nodeId || "")}`);
                return node;
            },
            h3_run_clip: async (input) => {
                const nodeId = String(input.nodeId || "");
                const node = await context.getCanvasNode(nodeId);
                if (!node) throw new Error(`找不到画布节点:${nodeId}`);
                if (!isH3Node(node)) throw new Error(`节点 ${nodeId} 不是 MiniMax H3 节点`);
                const index = typeof input.segmentIndex === "number" ? input.segmentIndex : undefined;
                const task = await runSegment(context, node, index, (input.params as Record<string, unknown>) || {});
                return task;
            },
            h3_get_task: async (input) => {
                const taskId = String(input.taskId || "");
                const { task } = await h3ResolveTask(context, taskId);
                return task;
            },
            h3_cancel_task: async (input) => {
                const taskId = String(input.taskId || "");
                return context.comfyUi.cancel(taskId);
            },
            h3_update_clip: async (input) => {
                const nodeId = String(input.nodeId || "");
                const node = await context.getCanvasNode(nodeId);
                if (!node) throw new Error(`找不到画布节点:${nodeId}`);
                const index = Number(input.segmentIndex);
                const segments = segmentsOf(node);
                if (!segments[index]) throw new Error(`片段下标越界:${index}`);
                const nextSegments = segments.map((segment, i) => (i === index ? { ...segment, ...(input.patch as Record<string, unknown>) } : segment));
                await context.updateCanvasNode(nodeId, {}, { segments: nextSegments });
                return { ok: true, nodeId, segmentIndex: index, segment: nextSegments[index] };
            },
            h3_run_all_clips: async (input) => {
                const override = (input.params as Record<string, unknown>) || {};
                const onlyIds = Array.isArray(input.nodeIds) ? (input.nodeIds as string[]).map(String) : null;
                const nodes = (await context.getCanvasNodes()).filter((node) => isH3Node(node) && (!onlyIds || onlyIds.includes(node.id)));
                const tasks: unknown[] = [];
                for (const node of nodes) {
                    const segments = segmentsOf(node);
                    if (!segments.length) continue;
                    for (let i = 0; i < segments.length; i++) {
                        if (segments[i].result || segments[i].status === "succeeded") continue;
                        try {
                            const task = await runSegment(context, node, i, override);
                            tasks.push({ nodeId: node.id, segmentIndex: i, task });
                        } catch (error) {
                            tasks.push({ nodeId: node.id, segmentIndex: i, error: error instanceof Error ? error.message : String(error) });
                        }
                    }
                }
                return { count: tasks.length, tasks };
            },
        };
    },
};
