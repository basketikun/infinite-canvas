import { getNodeSpec, NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import type { AiConfig } from "@/stores/use-config-store";
import type { UploadedImage } from "@/services/image-storage";
import type { UploadedFile } from "@/services/file-storage";
import type { CompositeItem } from "@/stores/use-asset-store";
import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasImageGenerationType, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeTypeId, type Position } from "@/types/canvas";

export function createCanvasNode(type: CanvasNodeTypeId, position: Position, metadata?: CanvasNodeMetadata): CanvasNodeData {
    const spec = getNodeSpec(type);
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    return {
        id,
        type,
        title: spec.title,
        position: {
            x: position.x - spec.width / 2,
            y: position.y - spec.height / 2,
        },
        width: spec.width,
        height: spec.height,
        metadata: { ...spec.metadata, ...metadata },
    };
}

export function imageMetadata(image: UploadedImage): CanvasNodeMetadata {
    return { content: image.url, storageKey: image.storageKey, status: "success", naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType };
}

export function videoMetadata(video: UploadedFile): CanvasNodeMetadata {
    return { content: video.url, storageKey: video.storageKey, status: "success", naturalWidth: video.width, naturalHeight: video.height, bytes: video.bytes, mimeType: video.mimeType || "video/mp4", durationMs: video.durationMs };
}

export function audioMetadata(audio: UploadedFile): CanvasNodeMetadata {
    return { content: audio.url, storageKey: audio.storageKey, status: "success", bytes: audio.bytes, mimeType: audio.mimeType || "audio/mpeg", durationMs: audio.durationMs };
}

export function referenceUrl(image: ReferenceImage) {
    return image.storageKey || image.url || (!image.dataUrl.startsWith("data:") ? image.dataUrl : undefined);
}

export function buildImageGenerationMetadata(type: CanvasImageGenerationType, config: AiConfig, count: number, references: ReferenceImage[]): CanvasNodeMetadata {
    return {
        generationType: type,
        model: config.model,
        size: config.size,
        quality: config.quality,
        ...(config.background ? { background: config.background } : {}),
        count,
        references: references.map(referenceUrl).filter((url): url is string => Boolean(url)),
    };
}

export function buildAudioGenerationMetadata(config: AiConfig): CanvasNodeMetadata {
    return {
        model: config.model,
        audioVoice: config.audioVoice,
        audioFormat: config.audioFormat,
        audioSpeed: config.audioSpeed,
        audioInstructions: config.audioInstructions,
    };
}

export function applyNodeConfigPatch(node: CanvasNodeData, patch: Partial<CanvasNodeData["metadata"]>) {
    const safePatch = patch || {};
    const next = { ...node, metadata: { ...node.metadata, ...safePatch } };
    const spec = node.type === CanvasNodeType.Video ? NODE_DEFAULT_SIZE[CanvasNodeType.Video] : NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const size = typeof safePatch.size === "string" && !node.metadata?.content ? nodeSizeFromRatio(safePatch.size, spec.width, spec.height) : null;
    return size && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) ? { ...next, ...size, position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 } } : next;
}

const COMPOSITE_ITEM_SIZES = {
    text: { width: 380, height: 140 },
    image: { width: 380, height: 285 },
    video: { width: 380, height: 285 },
    audio: { width: 380, height: 80 },
} as const;
const COMPOSITE_GROUP_PAD = 48;
const COMPOSITE_ROW_GAP = 24;

/** 把 composite items 展开为 1 个 Group 节点 + N 个子节点。origin 是 Group 左上角坐标。
 *  assetRef 项应由调用方先 resolveCompositeItems 解析；防御性跳过未解析项。 */
export function buildCompositeGroupNodes(title: string, items: CompositeItem[], origin: { x: number; y: number }): CanvasNodeData[] {
    const cellWidth = COMPOSITE_ITEM_SIZES.text.width;
    const cols = 2;
    const groupW = cols * cellWidth + (cols - 1) * COMPOSITE_ROW_GAP + COMPOSITE_GROUP_PAD * 2;
    const resolveHeight = (item: CompositeItem) => (item.itemType === "text" ? COMPOSITE_ITEM_SIZES.text.height : item.itemType === "image" ? COMPOSITE_ITEM_SIZES.image.height : item.itemType === "video" ? COMPOSITE_ITEM_SIZES.video.height : item.itemType === "audio" ? COMPOSITE_ITEM_SIZES.audio.height : 0);

    // 布局：每行 cols 个，行高 = 该行最高 item
    const rows: { item: Exclude<CompositeItem, { itemType: "assetRef" }>; h: number }[][] = [];
    for (const item of items) {
        if (item.itemType === "assetRef") continue;
        const h = resolveHeight(item);
        if (rows.length === 0 || rows[rows.length - 1].length >= cols) rows.push([]);
        rows[rows.length - 1].push({ item, h });
    }
    let rowY = 0;
    const placed = rows.map((row) => {
        const rowH = Math.max(...row.map((cell) => cell.h));
        const cells = row.map((cell, colIndex) => ({ cell, x: colIndex * (cellWidth + COMPOSITE_ROW_GAP), y: rowY }));
        rowY += rowH + COMPOSITE_ROW_GAP;
        return cells;
    });
    const contentH = Math.max(0, rowY - COMPOSITE_ROW_GAP);
    const groupH = Math.max(contentH, 0) + COMPOSITE_GROUP_PAD * 2;
    const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const group: CanvasNodeData = {
        id: `group-${stamp()}`,
        type: CanvasNodeType.Group,
        title: title || "Composite",
        position: { x: origin.x, y: origin.y },
        width: groupW,
        height: groupH,
        metadata: { status: "success" },
    };
    const children: CanvasNodeData[] = [];
    for (const row of placed) {
        for (const { cell, x, y } of row) {
            const item = cell.item;
            const pos = { x: origin.x + COMPOSITE_GROUP_PAD + x, y: origin.y + COMPOSITE_GROUP_PAD + y };
            const common = { groupId: group.id } as CanvasNodeMetadata;
            if (item.itemType === "text") {
                children.push({ id: `text-${stamp()}`, type: CanvasNodeType.Text, title: item.content.slice(0, 32) || "Text", position: pos, width: cellWidth, height: COMPOSITE_ITEM_SIZES.text.height, metadata: { content: item.content, status: "success", ...common } });
            } else if (item.itemType === "image") {
                children.push({ id: `image-${stamp()}`, type: CanvasNodeType.Image, title: "Image", position: pos, width: cellWidth, height: COMPOSITE_ITEM_SIZES.image.height, metadata: { content: item.url, storageKey: item.storageKey, status: "success", naturalWidth: item.width, naturalHeight: item.height, bytes: item.bytes, mimeType: item.mimeType, ...common } });
            } else if (item.itemType === "video") {
                children.push({ id: `video-${stamp()}`, type: CanvasNodeType.Video, title: "Video", position: pos, width: cellWidth, height: COMPOSITE_ITEM_SIZES.video.height, metadata: { content: item.url, storageKey: item.storageKey, status: "success", bytes: item.bytes, mimeType: item.mimeType, naturalWidth: item.width, naturalHeight: item.height, ...common } });
            } else {
                children.push({ id: `audio-${stamp()}`, type: CanvasNodeType.Audio, title: "Audio", position: pos, width: cellWidth, height: COMPOSITE_ITEM_SIZES.audio.height, metadata: { content: item.url, storageKey: item.storageKey, status: "success", bytes: item.bytes, mimeType: item.mimeType, durationMs: item.durationMs, ...common } });
            }
        }
    }
    return [group, ...children];
}
