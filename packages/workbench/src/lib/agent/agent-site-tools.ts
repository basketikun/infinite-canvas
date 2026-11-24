import { fetchPrompts } from "@workbench/services/api/prompts";
import { saveMediaAsset } from "@workbench/services/asset-upload";
import { nanoid } from "nanoid";
import { useAgentStore } from "@workbench/stores/use-agent-store";
import { fitNodeSize } from "@workbench/lib/canvas/canvas-node-size";
import { audioMetadata, imageMetadata, videoMetadata } from "@workbench/lib/canvas/canvas-node-factory";
import { toCanvasAssetInput } from "@workbench/lib/asset-utils";
import { createImageThumbnail } from "@workbench/lib/image-thumbnail";
import { blobToDataUrl, readImageBlob } from "@workbench/services/image-storage";
import { nextCanvasX } from "@infinite-canvas/shared/canvas/tools/tools";
import type { CanvasAgentSnapshot } from "@workbench/lib/canvas/canvas-agent-ops";
import { useAssetStore, type Asset } from "@workbench/stores/use-asset-store";
import { modelOptionLabel, selectableModelsByCapability, useConfigStore } from "@workbench/stores/use-config-store";
import { readWorkbenchStatus, type GenerationStatus } from "@workbench/services/generation-records";

export const SITE_TOOL_NAMES = [
    "canvas_list_models",
    "canvas_list_references",
    "canvas_insert_media",
    "canvas_view_image",
    "generation_get_status",
    "prompts_search",
    "assets_list",
    "assets_add",
] as const;

export type SiteToolName = (typeof SITE_TOOL_NAMES)[number];

export function isSiteTool(name: string): name is SiteToolName {
    return (SITE_TOOL_NAMES as readonly string[]).includes(name);
}

type SiteToolInput = Record<string, unknown>;
type SiteToolContext = { canvasSnapshot?: CanvasAgentSnapshot | null; signal?: AbortSignal };
type GenerationStatusItem = { id: string; source: "canvas" | "image" | "video"; status: GenerationStatus; kind?: string; taskIds?: string[]; title?: string; updatedAt?: string; successCount?: number; failCount?: number; error?: string };

export async function runSiteTool(name: SiteToolName, input: SiteToolInput, context: SiteToolContext = {}): Promise<unknown> {
    switch (name) {
        case "canvas_list_models": {
            const { config } = useConfigStore.getState();
            const capabilities = input.capability ? [input.capability as "text" | "image" | "video" | "audio"] : ["text", "image", "video", "audio"] as const;
            const keyword = (input.keyword as string | undefined)?.toLowerCase();
            return { models: capabilities.flatMap((capability) => selectableModelsByCapability(config, capability).map((id) => ({ id, capability, label: modelOptionLabel(config, id), selected: config[`${capability}Model`] === id }))).filter((model) => !keyword || model.label.toLowerCase().includes(keyword)) };
        }
        case "canvas_list_references": {
            if (!context.canvasSnapshot) throw new Error("CANVAS_NOT_OPEN");
            const { useAgentChatStore, agentHistoryReady } = await import("@workbench/stores/use-agent-chat-store");
            await agentHistoryReady;
            const images = useAgentChatStore.getState().threads.filter((thread) => thread.projectId === context.canvasSnapshot?.projectId).flatMap((thread) => thread.items.flatMap((item) => item.images ?? []));
            return [...new Map(images.map((image) => [image.storageKey, image])).values()].slice(-50);
        }
        case "canvas_insert_media": {
            if (Boolean(input.assetId) === Boolean(input.storageKey)) throw new Error("INVALID_ARGUMENTS");
            const original = useAgentStore.getState().canvasContext;
            const projectId = context.canvasSnapshot?.projectId;
            if (!projectId || original?.snapshot.projectId !== projectId) throw new Error("CANVAS_CHANGED");
            const signal = context.signal ? AbortSignal.any([original.signal, context.signal]) : original.signal;
            signal.throwIfAborted();
            let media: ReturnType<typeof assetNode>;
            if (input.assetId) {
                const asset = useAssetStore.getState().assets.find((item) => item.id === input.assetId);
                if (!asset) throw new Error("ASSET_NOT_FOUND");
                media = assetNode(asset);
            } else {
                const { useAgentChatStore, agentHistoryReady } = await import("@workbench/stores/use-agent-chat-store");
                await agentHistoryReady;
                signal.throwIfAborted();
                const image = useAgentChatStore.getState().threads.filter((thread) => thread.projectId === projectId).flatMap((thread) => thread.items.flatMap((item) => item.images ?? [])).find((image) => image.storageKey === input.storageKey);
                if (!image) throw new Error("REFERENCE_IMAGE_MISSING");
                media = { nodeType: "image", title: image.name, ...fitNodeSize(image.width, image.height), metadata: imageMetadata(image) };
            }
            const current = useAgentStore.getState().canvasContext;
            if (current?.applyOps !== original.applyOps || current.snapshot.projectId !== projectId) throw new Error("CANVAS_CHANGED");
            const id = nanoid();
            const next = await current.applyOps([{ type: "add_node", id, ...media, title: input.title as string | undefined ?? media.title, position: { x: input.x as number | undefined ?? nextCanvasX(current.snapshot), y: input.y as number | undefined ?? 0 } }]);
            signal.throwIfAborted();
            const active = useAgentStore.getState().canvasContext;
            if (active?.applyOps !== current.applyOps || active.snapshot.projectId !== projectId) throw new Error("CANVAS_CHANGED");
            useAgentStore.getState().setCanvasContext({ ...current, snapshot: next });
            return { nodeId: id, nodeType: media.nodeType, ...("width" in media ? { width: media.width, height: media.height } : {}) };
        }
        case "canvas_view_image": {
            if (Boolean(input.nodeId) === Boolean(input.storageKey)) throw new Error("INVALID_ARGUMENTS");
            if (input.storageKey) return { storageKey: input.storageKey };
            const node = context.canvasSnapshot?.nodes.find((item) => item.id === input.nodeId);
            if (!node) throw new Error("NODE_NOT_FOUND");
            const images = node.metadata?.images as Array<{ status?: string; storageKey?: string }> | undefined;
            const storageKey = node.type === "image" ? node.metadata?.storageKey as string | undefined ?? images?.find((image) => image.status === "success" && image.storageKey)?.storageKey : undefined;
            if (!storageKey) throw new Error("INVALID_ARGUMENTS");
            return { storageKey };
        }
        case "generation_get_status":
            return getGenerationStatus(input, context);
        case "prompts_search":
            return searchPrompts(input);
        case "assets_list":
            return listAssets(input);
        case "assets_add":
            return addAsset(input, context.signal);
        default:
            throw new Error(`未知工具：${name}`);
    }
}

/** 把素材转换为画布新增节点的参数。 */
function assetNode(asset: Asset) {
    const item = toCanvasAssetInput(asset);
    if (item.kind === "text") return { nodeType: "text" as const, title: item.title, metadata: { content: item.content, status: "success" } };
    if (item.kind === "image") return { nodeType: "image" as const, title: item.title, ...fitNodeSize(item.width, item.height), metadata: imageMetadata(item) };
    if (item.kind === "video") return { nodeType: "video" as const, title: item.title, ...fitNodeSize(item.width || 640, item.height || 360, 420, 420), metadata: videoMetadata(item) };
    return { nodeType: "audio" as const, title: item.title, metadata: audioMetadata(item) };
}

/** 读取长边不超过 1024 的图片，供模型查看，不写入对话记录。 */
export async function readViewImage(storageKey: string, signal?: AbortSignal) {
    const blob = await readImageBlob(storageKey, undefined, { signal });
    const image = await createImageThumbnail(blob, 1024) ?? blob;
    const dataUrl = await blobToDataUrl(image);
    return { mimeType: image.type, data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}

async function getGenerationStatus(input: SiteToolInput, { canvasSnapshot, signal }: SiteToolContext) {
    const scope = input.scope === "canvas" || input.scope === "image" || input.scope === "video" ? input.scope : "all";
    const taskId = typeof input.taskId === "string" ? input.taskId : "";
    const nodeIds = new Set(Array.isArray(input.nodeIds) ? input.nodeIds.filter((id): id is string => typeof id === "string") : []);
    const limit = Math.max(1, Math.min(100, Math.floor(Number(input.limit)) || 20));
    const tasks: GenerationStatusItem[] = [];
    const includeCanvas = (scope === "all" || scope === "canvas") && (!taskId || nodeIds.size > 0);
    const includeWorkbench = !nodeIds.size || Boolean(taskId);

    if (includeCanvas && canvasSnapshot) {
        canvasSnapshot.nodes.forEach((node) => {
            const status = normalizeCanvasGenerationStatus(node.metadata?.status);
            if (!status || (nodeIds.size && !nodeIds.has(node.id))) return;
            const metadata = node.metadata || {};
            if (!nodeIds.size && status !== "running" && status !== "failed" && !metadata.generationType && !metadata.model) return;
            tasks.push({ id: node.id, source: "canvas", status, kind: node.type, title: node.title, error: status === "failed" ? "生成未完成，请检查生成设置后重试。" : undefined });
        });
    }

    if (includeWorkbench && scope !== "canvas") {
        const kinds = scope === "all" ? ["image", "video"] as const : [scope] as const;
        const records = await Promise.all(kinds.map((kind) => readWorkbenchStatus(kind, taskId || undefined, signal)));
        tasks.push(...records.flat());
    }

    tasks.sort((a, b) => generationStatusOrder(a.status) - generationStatusOrder(b.status) || (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    const summary: Record<GenerationStatus, number> = { idle: 0, queued: 0, running: 0, succeeded: 0, failed: 0, paused: 0, interrupted: 0, cancelled: 0 };
    tasks.forEach((task) => (summary[task.status] += 1));
    return { total: tasks.length, summary, tasks: tasks.slice(0, limit) };
}

function generationStatusOrder(status: GenerationStatus) {
    return status === "running" ? 0 : status === "queued" ? 1 : 2;
}

function normalizeCanvasGenerationStatus(status: unknown): GenerationStatus | null {
    if (status === "idle") return "idle";
    if (status === "loading") return "running";
    if (status === "success") return "succeeded";
    if (status === "error") return "failed";
    return null;
}

async function searchPrompts(input: SiteToolInput) {
    const page = Math.max(1, Math.floor(Number(input.page)) || 1);
    const pageSize = Math.max(1, Math.min(50, Math.floor(Number(input.pageSize)) || 20));
    const tags = Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === "string") : [];
    const result = await fetchPrompts({ keyword: String(input.keyword || ""), category: String(input.category || "全部"), tag: tags, page, pageSize });
    return {
        total: result.total,
        page,
        pageSize,
        items: result.items.map((prompt) => ({ id: prompt.id, title: prompt.title, prompt: prompt.prompt, category: prompt.category, tags: prompt.tags })),
    };
}

function listAssets(input: SiteToolInput) {
    const { assets, hydrated } = useAssetStore.getState();
    if (!hydrated) throw new Error("资产还在加载中，请稍后重试");
    const kind = input.kind === "text" || input.kind === "image" || input.kind === "video" || input.kind === "audio" ? input.kind : "all";
    const keyword = String(input.keyword || "").trim().toLowerCase();
    const ids = input.ids as string[] | undefined;
    const filtered = assets.filter((asset) => {
        if (ids && !ids.includes(asset.id)) return false;
        if (kind !== "all" && asset.kind !== kind) return false;
        if (!keyword) return true;
        return [asset.title, asset.note, asset.source].filter(Boolean).join(" ").toLowerCase().includes(keyword);
    });
    const { page, pageSize, start, end } = paginate(input, filtered.length, 20, input.includeContent ? 20 : 100);
    const items = filtered.slice(start, end).map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        title: asset.title,
        source: asset.source,
        note: asset.note,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
        ...(input.includeContent && asset.kind === "text" ? { content: asset.data.content } : {}),
        ...(input.includeContent && asset.kind === "image" ? { storageKey: asset.data.storageKey, width: asset.data.width, height: asset.data.height } : {}),
    }));
    return { total: filtered.length, page, pageSize, items };
}

async function addAsset(input: SiteToolInput, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const kind = input.kind;
    const title = String(input.title || "").trim();
    if (!title) throw new Error("请提供资产标题 title");
    const source = typeof input.source === "string" ? input.source : "Agent";
    const note = typeof input.note === "string" ? input.note : undefined;
    const store = useAssetStore.getState();
    if (kind === "text") {
        const content = String(input.content || "").trim();
        if (!content) throw new Error("kind=text 时需要提供 content 文本内容");
        const id = store.addAsset({ kind: "text", title, coverUrl: "", source, note, data: { content } });
        return { ok: true, id, kind: "text" };
    }
    if (kind === "image") {
        const imageUrl = String(input.imageUrl || "").trim();
        if (!imageUrl) throw new Error("kind=image 时需要提供 imageUrl（图片地址或 dataURL）");
        try {
            const id = await saveMediaAsset(imageUrl, "image", { title, source, note }, signal);
            return { ok: true, id, kind: "image" };
        } catch (error) {
            signal?.throwIfAborted();
            throw new Error("图片未能添加。请确认图片链接可访问，并检查保存位置。");
        }
    }
    throw new Error("assets_add 仅支持 kind=text 或 kind=image");
}

function paginate(input: SiteToolInput, total: number, defaultSize: number, maxSize = 100) {
    const pageSize = Math.max(1, Math.min(maxSize, Math.floor(Number(input.pageSize)) || defaultSize));
    const maxPage = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(maxPage, Math.max(1, Math.floor(Number(input.page)) || 1));
    const start = (page - 1) * pageSize;
    return { page, pageSize, start, end: start + pageSize };
}
