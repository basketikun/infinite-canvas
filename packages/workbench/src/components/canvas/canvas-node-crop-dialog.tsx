import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { TooltipProvider } from "@infinite-canvas/plugin-sdk/ui/tooltip";
import { Check, LoaderCircle, X, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";

import { useImageEditorViewport } from "@workbench/components/canvas/use-image-editor-viewport";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { CanvasDialog } from "./canvas-dialog";
import { CanvasSegments } from "./canvas-segments";
import { ImageEditorAction } from "./image-editor-action";
import type { ImageCropRect } from "@infinite-canvas/plugin-sdk";
import { getPluginErrorMessage } from "@infinite-canvas/shared/plugins";
import { hostActions } from "@workbench/lib/canvas/host-actions";
import type { ImageNodeEditorProps } from "@workbench/components/canvas/use-image-node-edits";

type DragMode = "move" | "resize";
type ResizeHandle = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

const handles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const minSize = 0.06;
const defaultCrop = { x: 0.12, y: 0.12, width: 0.76, height: 0.76 };
const cropRatios = [{ label: "自由", value: "free" }, { label: "固定", value: "fixed" }, { label: "原图", value: "original" }, ...["1:1", "4:3", "16:9", "9:16"].map(value => ({ label: value, value }))];

export function CanvasNodeCropDialog({ nodeId, scope, dataUrl, image, loadingPreview, open, onClose, onLoadPreview }: ImageNodeEditorProps) {
    const [submitting, setSubmitting] = useState(false);
    const [failedPreview, setFailedPreview] = useState<string>();
    const hasPreview = Boolean(dataUrl && dataUrl !== failedPreview && image);
    const [crop, setCrop] = useState<ImageCropRect>(defaultCrop);
    const [ratioPreset, setRatioPreset] = useState("free");
    const [fixedRatio, setFixedRatio] = useState<number | null>(null);
    const dragAbortRef = useRef<AbortController | null>(null);
    const viewport = useImageEditorViewport(image, open);
    const boxRef = viewport.stageRef;
    const cropSize = image ? { width: Math.max(1, Math.round(crop.width * image.width)), height: Math.max(1, Math.round(crop.height * image.height)) } : null;

    useEffect(() => {
        if (open) {
            setCrop(defaultCrop);
            setRatioPreset("free");
            setFixedRatio(null);
        }
    }, [dataUrl, open]);

    useEffect(() => {
        if (!open) dragAbortRef.current?.abort();
        return () => dragAbortRef.current?.abort();
    }, [open]);

    const confirm = async () => {
        setSubmitting(true);
        try { await hostActions.nodeCropImage({ nodeId, crop }, scope.signal); onClose(); }
        catch (error) { if (!scope.signal.aborted) toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error); }
        finally { if (!scope.signal.aborted) setSubmitting(false); }
    };

    const startDrag = (mode: DragMode, event: ReactPointerEvent, handle?: ResizeHandle) => {
        const box = boxRef.current?.getBoundingClientRect();
        if (!box) return;
        event.preventDefault();
        event.stopPropagation();
        dragAbortRef.current?.abort();
        const controller = new AbortController();
        dragAbortRef.current = controller;
        const start = { x: event.clientX, y: event.clientY, crop };
        const move = (event: PointerEvent) => {
            const dx = (event.clientX - start.x) / box.width;
            const dy = (event.clientY - start.y) / box.height;
            setCrop(mode === "move" ? moveCrop(start.crop, dx, dy) : resizeCrop(start.crop, dx, dy, handle || "se", resolveRatio(ratioPreset, image, fixedRatio), box));
        };
        const stop = () => controller.abort();
        document.addEventListener("pointermove", move, { signal: controller.signal });
        document.addEventListener("pointerup", stop, { signal: controller.signal });
        document.addEventListener("pointercancel", stop, { signal: controller.signal });
    };

    return (
        <CanvasDialog title="裁剪图片" open={open} onClose={onClose} width={780}>
            <div className="space-y-4">
                <div
                    ref={viewport.viewportRef}
                    {...viewport.panHandlers}
                    className={`relative h-[min(62vh,620px)] min-h-[340px] rounded-lg bg-black/5 ${viewport.scrollClassName} ${viewport.isPanning ? "cursor-grabbing" : viewport.spacePressed ? "cursor-grab" : ""}`}
                >
                    {hasPreview ? <div className="relative" style={viewport.contentStyle}>
                        <div ref={boxRef} className="absolute isolate overflow-hidden rounded-lg bg-black select-none [backface-visibility:hidden] [contain:layout_paint] [transform:translateZ(0)]" style={viewport.stageStyle}>
                            <div className="absolute left-0 top-0 [backface-visibility:hidden]" style={viewport.mediaStyle}>
                                <img src={dataUrl} alt="" className="block h-full w-full object-contain opacity-90" draggable={false} onError={() => setFailedPreview(dataUrl)} />
                            </div>
                            <CropMask crop={crop} />
                            <div className="absolute cursor-move border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.3),0_0_28px_rgba(0,0,0,.28)]" style={cropStyle(crop)} onPointerDown={(event) => startDrag("move", event)}>
                                <div className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/50" />
                                <div className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-white/50" />
                                <div className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-white/50" />
                                <div className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-white/50" />
                                {handles.map((handle) => (
                                    <button
                                        key={handle}
                                        type="button"
                                        className="absolute size-3 rounded-full border border-black bg-white"
                                        style={handleStyle(handle)}
                                        onPointerDown={(event) => startDrag("resize", event, handle)}
                                        aria-label="调整裁剪框"
                                    />
                                ))}
                            </div>
                        </div>
                    </div> : <div className="grid h-full min-h-[340px] place-items-center"><Button type="button" variant="outline" className="h-8" disabled={loadingPreview} aria-busy={loadingPreview} onClick={onLoadPreview}>{loadingPreview && <LoaderCircle className="size-4 animate-spin" />}加载图片预览</Button></div>}
                </div>

                <TooltipProvider delayDuration={200}><div className="flex items-center justify-center gap-1">
                    <ImageEditorAction label="缩小" disabled={!viewport.canZoomOut} onClick={viewport.zoomOut}><ZoomOut className="size-4" /></ImageEditorAction>
                    <button type="button" className="min-w-14 text-center text-xs font-semibold tabular-nums opacity-70" onClick={viewport.resetZoom}>
                        {Math.round(viewport.zoom * 100)}%
                    </button>
                    <ImageEditorAction label="放大" disabled={!viewport.canZoomIn} onClick={viewport.zoomIn}><ZoomIn className="size-4" /></ImageEditorAction>
                    <span className="ml-2 text-xs opacity-55">滚轮缩放 · 中键或空格+左键拖动画面</span>
                </div></TooltipProvider>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
                    <div className="flex flex-wrap items-center gap-3 text-sm opacity-80">
                        <span>{`裁剪尺寸 ${cropSize ? `${cropSize.width} x ${cropSize.height}` : "未知"}`}</span>
                        <span>{`比例 ${cropSize ? formatRatio(cropSize.width, cropSize.height) : "未知"}`}</span>
                        {image ? (
                            <span>{`原图 ${image.width} x ${image.height}`}</span>
                        ) : null}
                    </div>
                    <CanvasSegments
                        compact label="裁剪比例" options={cropRatios}
                        value={ratioPreset}
                        onChange={(preset) => {
                            setRatioPreset(preset);
                            const currentRatio = image ? (crop.width * image.width) / Math.max(1, crop.height * image.height) : null;
                            const nextFixedRatio = preset === "fixed" ? currentRatio : null;
                            setFixedRatio(nextFixedRatio);
                            const ratio = resolveRatio(preset, image, nextFixedRatio);
                            if (ratio && image) setCrop((current) => fitCropToRatio(current, ratio, image));
                        }}
                    />
                </div>

                <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="outline" className="h-8" onClick={() => setCrop(defaultCrop)}>重置</Button>
                    <Button type="button" variant="outline" className="h-8" onClick={onClose}>
                        <X className="size-4" />取消
                    </Button>
                    <Button type="button" className="h-8" aria-busy={submitting} disabled={submitting || !hasPreview} onClick={() => { void confirm(); }}>
                        {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}确认裁剪
                    </Button>
                </div>
            </div>
        </CanvasDialog>
    );
}

function CropMask({ crop }: { crop: ImageCropRect }) {
    return (
        <>
            <div className="absolute inset-x-0 top-0 bg-black/55" style={{ height: `${crop.y * 100}%` }} />
            <div className="absolute inset-x-0 bottom-0 bg-black/55" style={{ height: `${(1 - crop.y - crop.height) * 100}%` }} />
            <div className="absolute bg-black/55" style={{ left: 0, top: `${crop.y * 100}%`, width: `${crop.x * 100}%`, height: `${crop.height * 100}%` }} />
            <div className="absolute bg-black/55" style={{ right: 0, top: `${crop.y * 100}%`, width: `${(1 - crop.x - crop.width) * 100}%`, height: `${crop.height * 100}%` }} />
        </>
    );
}

function moveCrop(crop: ImageCropRect, dx: number, dy: number): ImageCropRect {
    return { ...crop, x: clamp(crop.x + dx, 0, 1 - crop.width), y: clamp(crop.y + dy, 0, 1 - crop.height) };
}

function resizeCrop(crop: ImageCropRect, dx: number, dy: number, handle: ResizeHandle, aspectRatio: number | null, box: DOMRect): ImageCropRect {
    let next = { ...crop };
    if (handle.includes("e")) next.width = crop.width + dx;
    if (handle.includes("s")) next.height = crop.height + dy;
    if (handle.includes("w")) {
        next.x = crop.x + dx;
        next.width = crop.width - dx;
    }
    if (handle.includes("n")) {
        next.y = crop.y + dy;
        next.height = crop.height - dy;
    }
    if (aspectRatio) {
        const normalizedRatio = aspectRatio * (box.height / box.width);
        const horizontalOnly = (handle.includes("e") || handle.includes("w")) && !handle.includes("n") && !handle.includes("s");
        const useWidth = horizontalOnly || (handle.length > 1 && Math.abs(dx * box.width) >= Math.abs(dy * box.height));
        if (useWidth) next.height = next.width / normalizedRatio;
        else next.width = next.height * normalizedRatio;
        if (handle.includes("w")) next.x = crop.x + crop.width - next.width;
        if (handle.includes("n")) next.y = crop.y + crop.height - next.height;
    }
    if (aspectRatio) {
        const normalizedRatio = aspectRatio * (box.height / box.width);
        const scaleDown = Math.min(1, 1 / Math.max(next.width, 0.001), 1 / Math.max(next.height, 0.001));
        next.width *= scaleDown;
        next.height *= scaleDown;
        if (next.width < minSize || next.height < minSize) {
            const minimumScale = Math.max(minSize / Math.max(next.width, 0.001), minSize / Math.max(next.height, 0.001));
            next.width *= minimumScale;
            next.height *= minimumScale;
        }
        next.width = Math.min(next.width, next.height * normalizedRatio);
        next.height = next.width / normalizedRatio;
    } else {
        next.width = clamp(next.width, minSize, 1);
        next.height = clamp(next.height, minSize, 1);
    }
    next.x = clamp(next.x, 0, 1 - next.width);
    next.y = clamp(next.y, 0, 1 - next.height);
    return next;
}

function resolveRatio(preset: string, image: { width: number; height: number } | null, fixedRatio: number | null) {
    if (preset === "free" || !image) return null;
    if (preset === "fixed") return fixedRatio;
    if (preset === "original") return image.width / image.height;
    const [width, height] = preset.split(":").map(Number);
    return width > 0 && height > 0 ? width / height : null;
}

function fitCropToRatio(crop: ImageCropRect, ratio: number, image: { width: number; height: number }): ImageCropRect {
    const normalizedRatio = ratio * (image.height / image.width);
    let width = crop.width;
    let height = width / normalizedRatio;
    if (height > crop.height) {
        height = crop.height;
        width = height * normalizedRatio;
    }
    if (width > 1) {
        width = 1;
        height = width / normalizedRatio;
    }
    if (height > 1) {
        height = 1;
        width = height * normalizedRatio;
    }
    return {
        x: clamp(crop.x + (crop.width - width) / 2, 0, 1 - width),
        y: clamp(crop.y + (crop.height - height) / 2, 0, 1 - height),
        width,
        height,
    };
}

function cropStyle(crop: ImageCropRect) {
    return { left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` };
}

function handleStyle(handle: ResizeHandle) {
    const top = handle.includes("n") ? "-6px" : handle.includes("s") ? "calc(100% - 6px)" : "calc(50% - 6px)";
    const left = handle.includes("w") ? "-6px" : handle.includes("e") ? "calc(100% - 6px)" : "calc(50% - 6px)";
    return { top, left, cursor: `${handle}-resize` };
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function formatRatio(width: number, height: number) {
    const divisor = gcd(width, height);
    return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function gcd(a: number, b: number): number {
    return b ? gcd(b, a % b) : Math.max(1, a);
}
