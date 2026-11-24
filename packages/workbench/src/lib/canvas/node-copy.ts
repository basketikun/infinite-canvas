import type { ReadonlyCanvasNode } from "@infinite-canvas/plugin-sdk";
import { CanvasNodeType, type CanvasNodeData } from "@infinite-canvas/shared/canvas/schema/canvas";

/** 复制只分离宿主运行状态；调用方按不可变节点提交，原素材与插件业务数据可共享。 */
export function cloneNodeForCopy(node: ReadonlyCanvasNode): CanvasNodeData {
    const original = node as CanvasNodeData;
    const metadata = original.metadata;
    if (!metadata) return original;
    const hasTask = "tasks" in metadata || "webVideoSubmissionId" in metadata || "webVideoTask" in metadata;
    const loadingImages = metadata.images?.some((image) => image.status === "loading");
    const loadingTexts = metadata.texts?.some((text) => text.status === "loading");
    if (!hasTask && metadata.status !== "loading" && !loadingImages && !loadingTexts) return original;

    const next = { ...metadata };
    delete next.tasks;
    delete next.webVideoSubmissionId;
    delete next.webVideoTask;
    if (loadingImages) next.images = metadata.images!.map((image) => {
        if (image.status !== "loading") return image;
        const slot = { ...image };
        slot.status = slot.storageKey || slot.content ? "success" : "idle";
        delete slot.errorDetails;
        return slot;
    });
    if (loadingTexts) next.texts = metadata.texts!.map((text) => {
        if (text.status !== "loading") return text;
        const slot = { ...text, status: "idle" as const };
        delete slot.errorDetails;
        return slot;
    });
    if (next.status === "loading") {
        const primary = next.images?.find((image) => image.id === next.primaryImageId) ?? next.texts?.find((text) => text.id === next.primaryTextId) ?? next.images?.[0] ?? next.texts?.[0];
        const hasMedia = Boolean(next.storageKey || ([CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio].some((type) => type === node.type) && next.content));
        next.status = primary?.status ?? (hasMedia ? "success" : "idle");
        if (next.status === "error" && primary?.errorDetails) next.errorDetails = primary.errorDetails;
        else delete next.errorDetails;
    }
    return { ...original, metadata: next };
}
