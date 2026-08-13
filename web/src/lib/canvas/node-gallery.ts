import type { CanvasNodeHistoryItem, CanvasNodeImage, CanvasNodeStatus } from "../../types/canvas";

export type GalleryItemSource = "image" | "history";

export type GalleryItem = {
    id: string;
    source: GalleryItemSource;
    status: CanvasNodeStatus;
    content: string;
    storageKey?: string;
    naturalWidth?: number;
    naturalHeight?: number;
    bytes?: number;
    mimeType?: string;
    durationMs?: number;
};

export function toGalleryItems(images: readonly CanvasNodeImage[] = [], history: readonly CanvasNodeHistoryItem[] = []): GalleryItem[] {
    const items: GalleryItem[] = [];
    for (const image of images) {
        items.push({
            id: image.id,
            source: "image",
            status: image.status,
            content: image.content,
            storageKey: image.storageKey,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
            bytes: image.bytes,
            mimeType: image.mimeType,
        });
    }
    for (const entry of history) {
        items.push({
            id: entry.id,
            source: "history",
            status: "success",
            content: entry.content,
            storageKey: entry.storageKey,
            naturalWidth: entry.naturalWidth,
            naturalHeight: entry.naturalHeight,
            bytes: entry.bytes,
            mimeType: entry.mimeType,
            durationMs: entry.durationMs,
        });
    }
    return items;
}

export function resolveActiveIndex(primaryId: string | undefined, items: readonly GalleryItem[]): number {
    if (items.length === 0) return -1;
    if (primaryId) {
        const index = items.findIndex((item) => item.id === primaryId);
        if (index >= 0) return index;
    }
    return 0;
}

export function resolveIndexAfterDeletion(items: readonly GalleryItem[], removedIndex: number): number {
    if (items.length === 0) return -1;
    const clamped = Math.max(0, Math.min(removedIndex, items.length - 1));
    return clamped;
}

export function clampPageIndex(index: number, totalCount: number): number {
    if (!Number.isFinite(totalCount) || totalCount <= 0) return 0;
    if (!Number.isFinite(index)) return 0;
    if (index < 0) return 0;
    if (index >= totalCount) return totalCount - 1;
    return Math.floor(index);
}

/**
 * Build UI-derived gallery items for text/video history, appending a virtual "current draft" page
 * when `primaryHistoryId` is absent and `currentContent` is not undefined (empty string is a valid
 * draft). The virtual page is the active page in that case. Paging to a stored page should call
 * `setHistoryPrimary` (which captures the current text); clicking the active virtual page is a
 * no-op. Returns the items and the active id.
 */
export function withVirtualCurrentPage(
    history: readonly CanvasNodeHistoryItem[],
    primaryHistoryId: string | undefined,
    currentContent: string | undefined,
    virtualId: string,
): { items: GalleryItem[]; activeId: string | undefined } {
    const baseItems = toGalleryItems([], history);
    const primaryInHistory = primaryHistoryId ? history.some((item) => item.id === primaryHistoryId) : false;
    // If primary is set and present in history, or currentContent is undefined (no draft at all), no virtual page.
    if (primaryInHistory || currentContent === undefined) {
        return { items: baseItems, activeId: primaryHistoryId };
    }
    const virtualItem: GalleryItem = {
        id: virtualId,
        source: "history",
        status: "success",
        content: currentContent,
    };
    return { items: [...baseItems, virtualItem], activeId: virtualId };
}

/**
 * Count of history pages including the virtual current draft page when applicable.
 * An empty string draft is a valid current page; undefined means no draft.
 */
export function historyFocusCount(
    history: readonly CanvasNodeHistoryItem[],
    primaryHistoryId: string | undefined,
    currentContent: string | undefined,
): number {
    const primaryInHistory = primaryHistoryId ? history.some((item) => item.id === primaryHistoryId) : false;
    const virtual = currentContent !== undefined && !primaryInHistory ? 1 : 0;
    return history.length + virtual;
}
