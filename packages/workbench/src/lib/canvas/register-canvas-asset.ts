import type { ReadonlyCanvasNode } from "@infinite-canvas/plugin-sdk";
import { CanvasNodeType } from "@infinite-canvas/shared/canvas/schema/canvas";
import { registerMediaAsset } from "@workbench/stores/use-asset-store";

/** 画布节点上的媒体文件进入资产库，删除画布或生成记录后资产仍保留。 */
export async function registerCanvasNodeAsset(node: ReadonlyCanvasNode, source = "画布") {
    if (node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio) return;
    const metadata = node.metadata;
    if (!metadata?.storageKey && !metadata?.content) return;
    const kind = node.type === CanvasNodeType.Image ? "image" as const : node.type === CanvasNodeType.Video ? "video" as const : "audio" as const;
    const fallbackMime = kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg";
    const title = node.title?.trim() || (kind === "image" ? "画布图片" : kind === "video" ? "画布视频" : "画布音频");
    const register = (image?: { storageKey?: string; content?: string; naturalWidth?: number; naturalHeight?: number; bytes?: number; mimeType?: string }) => registerMediaAsset({
        kind,
        storageKey: image ? image.storageKey : metadata.storageKey,
        url: image ? image.content : metadata.content,
        width: image?.naturalWidth ?? metadata.naturalWidth ?? (kind === "audio" ? 0 : node.width),
        height: image?.naturalHeight ?? metadata.naturalHeight ?? (kind === "audio" ? 0 : node.height),
        bytes: image?.bytes ?? metadata.bytes ?? 0,
        mimeType: image?.mimeType || metadata.mimeType || fallbackMime,
        title,
        source,
        metadata: { source: "canvas", nodeId: node.id, ...(metadata.prompt && { prompt: metadata.prompt }) },
    }).catch((error) => console.error("[assets] register canvas media", error));
    await Promise.all([register(), ...(kind === "image" ? (metadata.images ?? []).filter((image) => image.status === "success") : []).map((image) => register(image))]);
}

/** 只登记本次命令新增或替换的媒体节点。 */
export function registerChangedCanvasAssets(before: readonly ReadonlyCanvasNode[], after: readonly ReadonlyCanvasNode[], source = "上传") {
    const known = new Map(before.map((node) => [node.id, node]));
    for (const node of after) if (known.get(node.id) !== node) void registerCanvasNodeAsset(node, source);
}
