import type { ReadonlyCanvasNode } from "@infinite-canvas/plugin-sdk";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { CanvasNodeType, type CanvasNodeData } from "@infinite-canvas/shared/canvas/schema/canvas";
import type { CanvasDocumentOp } from "@infinite-canvas/shared/canvas/ops/apply";
import { fitNodeSize } from "@workbench/lib/canvas/canvas-node-size";

type ImageSlot = NonNullable<NonNullable<ReadonlyCanvasNode["metadata"]>["images"]>[number];

function primaryImageMetadata(image?: ImageSlot) {
    return {
        content: image?.content,
        storageKey: image?.storageKey,
        naturalWidth: image?.naturalWidth,
        naturalHeight: image?.naturalHeight,
        bytes: image?.bytes,
        mimeType: image?.mimeType,
        primaryImageId: image?.id,
        status: image?.status ?? "idle",
        errorDetails: image?.errorDetails,
    };
}

export function buildImageSlotSelection(node: ReadonlyCanvasNode, slotId: string): CanvasDocumentOp {
    const image = node.metadata?.images?.find((item) => item.id === slotId);
    if (!image || !image.content && !image.storageKey) throw new PluginError("PLUGIN_NOT_FOUND");
    const edge = Math.max(node.width, node.height);
    const size = node.metadata?.freeResize ? { width: node.width, height: node.height } : fitNodeSize(image.naturalWidth, image.naturalHeight, edge, edge);
    return { type: "update_node", id: node.id, patch: {
        ...size,
        position: { x: node.position.x + (node.width - size.width) / 2, y: node.position.y + (node.height - size.height) / 2 },
    }, metadata: primaryImageMetadata(image) };
}

export function buildImageSlotRemoval(node: ReadonlyCanvasNode, slotId: string): CanvasDocumentOp {
    const current = node.metadata?.images;
    if (!current?.some((image) => image.id === slotId)) throw new PluginError("PLUGIN_NOT_FOUND");
    const images = current.filter((image) => image.id !== slotId).map((image) => ({ ...image }));
    const removedPrimary = (node.metadata?.primaryImageId || current[0]?.id) === slotId;
    return { type: "update_node", id: node.id, metadata: {
        images,
        tasks: node.metadata?.tasks?.filter((binding) => binding.slotId !== slotId),
        count: images.length,
        ...(removedPrimary ? primaryImageMetadata(images[0]) : {}),
    } };
}

export function buildImageSlotCopy(node: ReadonlyCanvasNode, slotId: string, id: string): CanvasNodeData {
    const image = node.metadata?.images?.find((item) => item.id === slotId);
    if (!image || !image.content && !image.storageKey) throw new PluginError("PLUGIN_NOT_FOUND");
    const edge = Math.max(node.width, node.height);
    const size = fitNodeSize(image.naturalWidth, image.naturalHeight, edge, edge);
    return {
        id,
        type: CanvasNodeType.Image,
        title: node.title,
        position: { x: node.position.x + node.width * 2 + 96, y: node.position.y + (node.height - size.height) / 2 },
        ...size,
        metadata: {
            content: image.content,
            storageKey: image.storageKey,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
            bytes: image.bytes,
            mimeType: image.mimeType,
            status: "success",
            prompt: node.metadata?.prompt,
            generationType: node.metadata?.generationType,
            model: node.metadata?.model,
            size: node.metadata?.size,
            quality: node.metadata?.quality,
            background: node.metadata?.background,
            references: node.metadata?.references?.slice(),
        },
    };
}
