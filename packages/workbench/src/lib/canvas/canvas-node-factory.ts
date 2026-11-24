import { NODE_DEFAULT_SIZE } from "@infinite-canvas/shared/canvas/schema/node-specs";
import { getNodeSpec } from "@workbench/constant/canvas";
import { nodeSizeFromRatio } from "@workbench/lib/canvas/canvas-node-size";
import type { AiConfig } from "@workbench/stores/use-config-store";
import type { UploadedImage } from "@workbench/services/image-storage";
import type { UploadedFile } from "@workbench/services/file-storage";
import type { ReferenceImage } from "@workbench/types/image";
import { CanvasNodeType, type CanvasImageGenerationType, type CanvasMediaReference, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeTypeId, type Position } from "@infinite-canvas/shared/canvas/schema/canvas";

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

export function imageMetadata(image: Omit<UploadedImage, "url"> & { url?: string }): CanvasNodeMetadata {
    return { content: image.url, storageKey: image.storageKey, status: "success", naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType };
}

export function videoMetadata(video: UploadedFile): CanvasNodeMetadata {
    return { content: video.url, storageKey: video.storageKey, status: "success", naturalWidth: video.width, naturalHeight: video.height, bytes: video.bytes, mimeType: video.mimeType || "video/mp4", durationMs: video.durationMs };
}

export function audioMetadata(audio: UploadedFile): CanvasNodeMetadata {
    return { content: audio.url, storageKey: audio.storageKey, status: "success", bytes: audio.bytes, mimeType: audio.mimeType || "audio/mpeg", durationMs: audio.durationMs };
}

export function canvasMediaReferences(kind: CanvasMediaReference["kind"], items: readonly { storageKey?: string; url?: string; dataUrl?: string }[]): CanvasMediaReference[] {
    const references: CanvasMediaReference[] = [];
    for (const item of items) {
        if (item.storageKey) references.push({ kind, storageKey: item.storageKey });
        else {
            const url = item.url || item.dataUrl;
            if (url) references.push({ kind, url });
        }
    }
    return references;
}

export function buildImageGenerationMetadata(type: CanvasImageGenerationType, config: AiConfig, count: number, references: ReferenceImage[]): CanvasNodeMetadata {
    return {
        generationType: type,
        model: config.model,
        size: config.size,
        quality: config.quality,
        ...(config.background ? { background: config.background } : {}),
        count,
        references: canvasMediaReferences("image", references),
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
    const size = typeof safePatch.size === "string" && !(node.metadata?.storageKey || node.metadata?.content) ? nodeSizeFromRatio(safePatch.size, spec.width, spec.height) : null;
    return size && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) ? { ...next, ...size, position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 } } : next;
}
