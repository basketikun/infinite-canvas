import { useEffect, useMemo, useState } from "react";
import { Focus, History } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { clampPageIndex, resolveActiveIndex, resolveIndexAfterDeletion, toGalleryItems, withVirtualCurrentPage } from "@/lib/canvas/node-gallery";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, CanvasNodeStatus } from "@/types/canvas";
import { BatchFrame, GalleryDots, GallerySideChevron, GallerySkeleton, GallerySkeletonOverlay, ImageActionBar } from "./gallery-controls";

const VIRTUAL_CURRENT_PAGE_ID = "__current_draft__";
const isLoadingStatus = (status: CanvasNodeStatus | undefined): boolean => status === "loading";

/** Flat, borderless, shadowless top-right focus/count control per AGENTS.md canvas rules. */
function FocusButton({ count, label, active, onToggle }: { count: number; label: string; active: boolean; onToggle: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const actionLabel = active ? t("canvas.node.exitCandidateMode") : label;
    return (
        <button
            type="button"
            data-candidate-toggle
            className="absolute right-2.5 top-2.5 z-30 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold backdrop-blur-md transition hover:bg-black/5 dark:hover:bg-white/10 motion-reduce:transition-none"
            style={{ background: theme.toolbar.panel, color: theme.toolbar.activeText }}
            title={actionLabel}
            aria-label={actionLabel}
            onClick={(event) => {
                event.stopPropagation();
                onToggle();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <Focus className="size-3.5" />
            <span className="leading-none">{count}</span>
        </button>
    );
}

/** Top-right history/focus button for text and video nodes with history >= 2.
 *  `placement="inline"` participates in a flex row (text Generate button row);
 *  `placement="absolute"` (default) pins to the node's top-right corner (video). */
export function HistoryFocusButton({ count, active, onToggle, placement = "absolute" }: { count: number; active: boolean; onToggle: () => void; placement?: "inline" | "absolute" }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    if (count < 2) return null;
    const actionLabel = active ? t("canvas.node.exitCandidateMode") : t("canvas.node.focusHistory");
    const className =
        placement === "absolute"
            ? "absolute right-3 top-3 z-20 inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium backdrop-blur-md transition hover:bg-black/5 dark:hover:bg-white/10 motion-reduce:transition-none"
            : "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium backdrop-blur-md transition hover:bg-black/5 dark:hover:bg-white/10 motion-reduce:transition-none";
    return (
        <button
            type="button"
            data-candidate-toggle
            className={className}
            style={{ background: theme.toolbar.panel, color: theme.node.text }}
            title={actionLabel}
            aria-label={actionLabel}
            onClick={(event) => {
                event.stopPropagation();
                onToggle();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <History className="size-3.5" />
            <span className="leading-none">{t("canvas.node.historyCount", { count })}</span>
        </button>
    );
}

/**
 * In-node single-item gallery for image nodes with `metadata.images`. Paging is view-only (only
 * set-primary mutates primaryImageId). Active image tracked by id so it survives appended
 * generations/retries and falls back safely when deleted. Arrows/dots/focus count gated on >1;
 * a lone failed candidate keeps retry/delete actions without full gallery chrome.
 */
export function ImageBatchGallery({
    node,
    candidateMode,
    showPanel,
    onSetBatchPrimary,
    onDuplicateBatchImage,
    onDownloadBatchImage,
    onRetryBatchImage,
    onDeleteBatchImage,
    onToggleCandidateMode,
}: {
    node: CanvasNodeData;
    candidateMode: boolean;
    showPanel: boolean;
    onSetBatchPrimary?: (imageId: string) => void;
    onDuplicateBatchImage?: (imageId: string) => void;
    onDownloadBatchImage?: (imageId: string) => void;
    onRetryBatchImage?: (imageId: string) => void;
    onDeleteBatchImage?: (imageId: string) => void;
    onToggleCandidateMode?: (nodeId: string) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const images = node.metadata?.images || [];
    const items = useMemo(() => toGalleryItems(images, []), [images]);
    const primaryImageId = node.metadata?.primaryImageId || images[0]?.id;
    const [activeImageId, setActiveImageId] = useState<string | undefined>(primaryImageId);
    const hasMultiple = items.length > 1;

    useEffect(() => {
        if (images.length === 0) return;
        if (images.some((image) => image.id === activeImageId)) return;
        setActiveImageId(primaryImageId || images[0].id);
    }, [images, primaryImageId, activeImageId]);

    useEffect(() => {
        if (!candidateMode) setActiveImageId(primaryImageId);
    }, [candidateMode, primaryImageId]);

    const activeIndex = resolveActiveIndex(candidateMode ? activeImageId : primaryImageId, items);
    const active = activeIndex >= 0 ? items[activeIndex] : undefined;
    const activeImage = active ? images.find((image) => image.id === active.id) : undefined;
    const activeContent = active?.content;
    const isPrimary = active?.id === primaryImageId;
    const hasContent = Boolean(activeContent);
    const isError = active?.status === "error";
    const errorDetails = activeImage?.errorDetails;
    const nodeLoading = isLoadingStatus(node.metadata?.status);
    const anyCandidateLoading = images.some((image) => isLoadingStatus(image.status));
    const loadingIndices = images.flatMap((image, index) => (isLoadingStatus(image.status) ? [index] : []));
    const showLoadingOverlay = hasContent && (nodeLoading || anyCandidateLoading);

    const goTo = (dir: -1 | 1) => {
        if (!hasMultiple) return;
        const next = clampPageIndex(activeIndex + dir, items.length);
        setActiveImageId(items[next].id);
    };

    const handleDelete = () => {
        if (!active) return;
        const removedIndex = activeIndex;
        const remaining = images.filter((image) => image.id !== active.id);
        const remainingItems = toGalleryItems(remaining, []);
        const nextIndex = resolveIndexAfterDeletion(remainingItems, removedIndex);
        const nextId = remainingItems[nextIndex]?.id;
        onDeleteBatchImage?.(active.id);
        setActiveImageId(nextId);
    };

    return (
        <>
            <BatchFrame batchCount={images.length}>
                <div className="relative h-full w-full overflow-hidden rounded-3xl">
                    {hasContent && activeContent ? (
                        <img
                            src={activeContent}
                            alt={node.title}
                            draggable={false}
                            onDragStart={(event) => event.preventDefault()}
                            className={`pointer-events-none block h-full w-full select-none ${node.metadata?.freeResize ? "object-fill" : "object-contain"}`}
                        />
                    ) : isError ? (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center" style={{ color: theme.node.text }}>
                            <span className="text-xs leading-5">{errorDetails || t("canvas.node.failed")}</span>
                        </div>
                    ) : (
                        <GallerySkeleton />
                    )}
                    {showLoadingOverlay ? <GallerySkeletonOverlay /> : null}
                </div>
            </BatchFrame>

            {hasMultiple ? <FocusButton count={images.length} label={t("canvas.node.focusImages")} active={candidateMode} onToggle={() => onToggleCandidateMode?.(node.id)} /> : null}

            {candidateMode && hasMultiple && !showPanel ? (
                <>
                    <GallerySideChevron direction="prev" disabled={activeIndex <= 0} onClick={() => goTo(-1)} />
                    <GallerySideChevron direction="next" disabled={activeIndex >= items.length - 1} onClick={() => goTo(1)} />
                    <div
                        className="absolute inset-x-2 bottom-2 z-[60] flex flex-col items-center gap-1 px-1 py-1.5"
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                    >
                        <GalleryDots count={items.length} activeIndex={activeIndex} onSelect={(index) => setActiveImageId(items[index].id)} label="image" loadingIndices={loadingIndices} />
                        <ImageActionBar
                            compact={node.width < 380}
                            isPrimary={isPrimary}
                            hasContent={hasContent}
                            isError={isError}
                            onSetPrimary={() => active && onSetBatchPrimary?.(active.id)}
                            onDuplicate={() => active && onDuplicateBatchImage?.(active.id)}
                            onDownload={() => active && onDownloadBatchImage?.(active.id)}
                            onRetry={() => active && onRetryBatchImage?.(active.id)}
                            onDelete={handleDelete}
                        />
                    </div>
                </>
            ) : null}
        </>
    );
}

/** In-node paging chrome for text/video history. Paging to a stored page calls onSetHistoryPrimary
 *  (which captures current text). Clicking the active virtual current page is a no-op. */
export function HistoryPagingChrome({ node, showPanel, onSelect }: { node: CanvasNodeData; showPanel: boolean; onSelect: (historyId: string) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const history = node.metadata?.history || [];
    const currentContent = node.metadata?.content;
    const primaryId = node.metadata?.primaryHistoryId;
    const { items, activeId } = useMemo(() => withVirtualCurrentPage(history, primaryId, currentContent, VIRTUAL_CURRENT_PAGE_ID), [history, primaryId, currentContent]);
    const activeIndex = resolveActiveIndex(activeId, items);
    const virtualIndex = activeId === VIRTUAL_CURRENT_PAGE_ID ? activeIndex : items.findIndex((item) => item.id === VIRTUAL_CURRENT_PAGE_ID);
    if (items.length <= 1 || showPanel) return null;

    const goTo = (dir: -1 | 1) => {
        const next = clampPageIndex(activeIndex + dir, items.length);
        const target = items[next];
        if (!target || target.id === VIRTUAL_CURRENT_PAGE_ID) return;
        onSelect(target.id);
    };

    const handleSelect = (index: number) => {
        const target = items[index];
        if (!target || target.id === VIRTUAL_CURRENT_PAGE_ID) return;
        onSelect(target.id);
    };

    return (
        <>
            <GallerySideChevron direction="prev" disabled={activeIndex <= 0} onClick={() => goTo(-1)} />
            <GallerySideChevron direction="next" disabled={activeIndex >= items.length - 1} onClick={() => goTo(1)} />
            <div
                className="absolute inset-x-2 bottom-2 z-[60] flex items-center justify-center gap-3 px-1 py-1"
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <GalleryDots count={items.length} activeIndex={activeIndex} onSelect={handleSelect} label="history" virtualIndex={virtualIndex >= 0 ? virtualIndex : undefined} />
            </div>
        </>
    );
}
