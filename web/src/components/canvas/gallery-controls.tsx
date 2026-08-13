import React from "react";
import { ChevronLeft, ChevronRight, Copy, Download, RefreshCw, Star, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

const selectionBlue = "#2f80ff";

// Flat control className per AGENTS.md: transparent background, light hover feedback, no gray decorative fill.
const flatControlClass =
    "inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium backdrop-blur-md transition hover:brightness-105 motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-30";
const flatIconClass =
    "grid size-8 place-items-center rounded-full backdrop-blur-md transition hover:brightness-105 motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-30";

/** Themed skeleton shimmer slot for loading images. Stronger highlight via activeStroke; persistent centered label. */
export function GallerySkeleton({ rounded = true }: { rounded?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    return (
        <div
            className={`canvas-skeleton h-full w-full ${rounded ? "rounded-3xl" : ""}`}
            style={{
                backgroundColor: theme.node.fill,
                backgroundImage: `linear-gradient(90deg, transparent 0%, ${theme.node.activeStroke} 50%, transparent 100%)`,
            }}
            aria-busy
            role="status"
            aria-label={t("canvas.node.generating")}
        >
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
                <span className="text-[10px] tracking-[0.2em] opacity-60" style={{ color: theme.node.activeStroke }}>{t("canvas.node.generating")}</span>
            </div>
        </div>
    );
}

/** Subtle non-blocking shimmer overlay for background generation while current content stays visible. */
export function GallerySkeletonOverlay() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div
            className="canvas-skeleton pointer-events-none absolute inset-0 rounded-3xl"
            style={{
                backgroundColor: "transparent",
                backgroundImage: `linear-gradient(90deg, transparent 0%, ${theme.node.activeStroke} 50%, transparent 100%)`,
                opacity: 0.3,
            }}
            aria-hidden
        />
    );
}

export type GalleryDotLabel = "image" | "history";

/** Dots row. 24px pointer targets wrap 8px visual dots / 20px active pill. Media-specific labels.
 *  `virtualIndex` marks the virtual current draft dot with a distinct accessible label. */
export function GalleryDots({
    count,
    activeIndex,
    onSelect,
    label,
    virtualIndex,
    loadingIndices = [],
}: {
    count: number;
    activeIndex: number;
    onSelect: (index: number) => void;
    label: GalleryDotLabel;
    virtualIndex?: number;
    loadingIndices?: readonly number[];
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    if (count <= 1) return null;
    const labelKey = label === "image" ? "canvas.node.galleryDot" : "canvas.node.galleryDotHistory";
    return (
        <div className="flex items-center gap-1">
            {Array.from({ length: count }).map((_, index) => {
                const active = index === activeIndex;
                const isVirtual = virtualIndex !== undefined && index === virtualIndex;
                const loading = loadingIndices.includes(index);
                const dotLabel = isVirtual ? t("canvas.node.galleryDotCurrent", { index: index + 1, count }) : t(labelKey, { index: index + 1, count });
                return (
                    <button
                        key={index}
                        type="button"
                        className={`grid size-6 place-items-center rounded-full transition-opacity motion-reduce:transition-none`}
                        onClick={(event) => {
                            event.stopPropagation();
                            onSelect(index);
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        title={dotLabel}
                        aria-label={dotLabel}
                        aria-pressed={active}
                    >
                        <span
                            className={`block rounded-full transition-all motion-reduce:transition-none ${active ? "h-2 w-5" : "size-2"} ${loading ? "animate-pulse motion-reduce:animate-none" : ""}`}
                            style={{ backgroundColor: loading ? theme.node.activeStroke : active ? selectionBlue : theme.node.muted, opacity: loading || active ? 1 : 0.45 }}
                        />
                    </button>
                );
            })}
        </div>
    );
}

/** Side-overlay chevron pinned inside the 48px connection-handle edge zone. Flat, borderless, shadowless. */
export function GallerySideChevron({ direction, disabled, onClick }: { direction: "prev" | "next"; disabled: boolean; onClick: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
    return (
        <button
            type="button"
            className={`absolute top-1/2 z-30 grid size-7 -translate-y-1/2 place-items-center rounded-full backdrop-blur-md transition hover:brightness-105 motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-25 ${direction === "prev" ? "left-3" : "right-3"}`}
            style={{ background: theme.toolbar.panel, color: theme.toolbar.activeText }}
            title={direction === "prev" ? t("canvas.node.prevItem") : t("canvas.node.nextItem")}
            aria-label={direction === "prev" ? t("canvas.node.prevItem") : t("canvas.node.nextItem")}
            disabled={disabled}
            onClick={(event) => {
                event.stopPropagation();
                onClick();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <Icon className="size-3.5" />
        </button>
    );
}

/** Stacked-card hint behind a batch image root. Always visible; no longer drives an expansion. */
export function BatchFrame({ batchCount, children }: { batchCount: number; children: React.ReactNode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isBatchRoot = batchCount > 1;
    return (
        <div className="group/batch relative h-full w-full overflow-visible">
            {isBatchRoot ? (
                <div className="pointer-events-none absolute inset-0 overflow-visible">
                    {Array.from({ length: Math.min(batchCount - 1, 3) }).map((_, index) => (
                        <div
                            key={index}
                            className="absolute rounded-[inherit] border shadow-[0_10px_24px_rgba(68,64,60,.12)]"
                            style={{
                                inset: 0,
                                background: `linear-gradient(135deg, ${theme.node.panel}, ${theme.node.fill})`,
                                borderColor: theme.node.stroke,
                                transform: `translate(${10 + index * 6}px, ${4 + index * 3}px) rotate(${1.5 + index}deg)`,
                                zIndex: -index - 1,
                            }}
                        />
                    ))}
                </div>
            ) : null}
            {children}
        </div>
    );
}

export function ImageActionBar({
    compact,
    isPrimary,
    hasContent,
    isError,
    onSetPrimary,
    onDuplicate,
    onDownload,
    onRetry,
    onDelete,
}: {
    compact: boolean;
    isPrimary: boolean;
    hasContent: boolean;
    isError: boolean;
    onSetPrimary: () => void;
    onDuplicate: () => void;
    onDownload: () => void;
    onRetry: () => void;
    onDelete: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const stop = (event: React.MouseEvent) => {
        event.stopPropagation();
    };
    return (
        <div className="flex flex-wrap items-center justify-center gap-1" onMouseDown={stop} onPointerDown={stop}>
            {hasContent && !isPrimary ? (
                <button type="button" className={compact ? flatIconClass : flatControlClass} style={{ background: theme.toolbar.panel, color: theme.node.text }} title={t("canvas.node.setPrimary")} aria-label={t("canvas.node.setPrimary")} onClick={(event) => (event.stopPropagation(), onSetPrimary())}>
                    <Star className="size-3.5" style={{ color: selectionBlue }} />
                    {!compact ? t("canvas.node.setPrimary") : null}
                </button>
            ) : null}
            {hasContent ? (
                <button type="button" className={compact ? flatIconClass : flatControlClass} style={{ background: theme.toolbar.panel, color: theme.node.text }} title={t("canvas.node.createCopy")} aria-label={t("canvas.node.createCopy")} onClick={(event) => (event.stopPropagation(), onDuplicate())}>
                    <Copy className="size-3.5" />
                    {!compact ? t("canvas.node.createCopy") : null}
                </button>
            ) : null}
            {hasContent ? (
                <button type="button" className={compact ? flatIconClass : flatControlClass} style={{ background: theme.toolbar.panel, color: theme.node.text }} title={t("common.download")} aria-label={t("common.download")} onClick={(event) => (event.stopPropagation(), onDownload())}>
                    <Download className="size-3.5" />
                    {!compact ? t("common.download") : null}
                </button>
            ) : null}
            {isError ? (
                <button type="button" className={compact ? flatIconClass : flatControlClass} style={{ background: theme.toolbar.panel, color: theme.node.text }} title={t("canvas.node.retry")} aria-label={t("canvas.node.retry")} onClick={(event) => (event.stopPropagation(), onRetry())}>
                    <RefreshCw className="size-3.5" />
                    {!compact ? t("canvas.node.retry") : null}
                </button>
            ) : null}
            <button type="button" className={flatIconClass} style={{ background: theme.toolbar.panel, color: theme.node.text }} title={t("common.delete")} aria-label={t("common.delete")} onClick={(event) => (event.stopPropagation(), onDelete())}>
                <Trash2 className="size-3.5" />
            </button>
        </div>
    );
}
