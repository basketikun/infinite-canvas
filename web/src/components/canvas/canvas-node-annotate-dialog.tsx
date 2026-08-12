import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Button, Modal, Slider, Tooltip } from "antd";
import { Brush, Eraser, Redo2, RotateCcw, Undo2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";

import { readImageMeta } from "@/lib/image-utils";
import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";

type DrawMode = "paint" | "erase";
type Point = { x: number; y: number };
type AnnotateStroke = { mode: DrawMode; size: number; color: string; points: Point[] };
type BrushPreview = { x: number; y: number; size: number; adjusting: boolean };

const defaultBrushSize = 100;
const annotateColors = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#111827"];

export function CanvasNodeAnnotateDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (dataUrl: string) => void }) {
    const { t } = useTranslation();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef<{ active: boolean; stroke: AnnotateStroke | null }>({ active: false, stroke: null });
    const brushAdjustRef = useRef<{ active: boolean; pointerId: number; startX: number; startSize: number; previewX: number; previewY: number } | null>(null);
    const historyRef = useRef<AnnotateStroke[]>([]);
    const redoRef = useRef<AnnotateStroke[]>([]);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [brushSize, setBrushSize] = useState(defaultBrushSize);
    const [mode, setMode] = useState<DrawMode>("paint");
    const [color, setColor] = useState(annotateColors[0]);
    const [error, setError] = useState("");
    const [historySize, setHistorySize] = useState(0);
    const [redoSize, setRedoSize] = useState(0);
    const [brushPreview, setBrushPreview] = useState<BrushPreview | null>(null);
    const [saving, setSaving] = useState(false);
    const viewport = useImageEditorViewport(image, open);

    useEffect(() => {
        if (!open) return;
        setBrushSize(defaultBrushSize);
        setMode("paint");
        setColor(annotateColors[0]);
        setError("");
        setHistorySize(0);
        setRedoSize(0);
        setBrushPreview(null);
        setSaving(false);
        historyRef.current = [];
        redoRef.current = [];
        brushAdjustRef.current = null;
        drawingRef.current = { active: false, stroke: null };
        void readImageMeta(dataUrl).then(setImage);
    }, [dataUrl, open]);

    useEffect(() => {
        clearCanvas(canvasRef.current);
    }, [image]);

    const draw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const point = readCanvasPoint(event.currentTarget, event.clientX, event.clientY);
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d", { willReadFrequently: true });
        const stroke = drawingRef.current.stroke;
        if (!canvas || !context || !stroke) return;
        configureStrokeContext(context, stroke);
        const last = stroke.points.at(-1);
        drawStroke(context, last || point, point, stroke.size);
        stroke.points.push(point);
        if (stroke.mode === "paint") setError("");
    };

    const updateBrushPreview = (event: ReactPointerEvent<HTMLCanvasElement>, size = brushSize, adjusting = false) => {
        setBrushPreview({ x: event.clientX, y: event.clientY, size, adjusting });
    };

    const startDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if ((event.button === 0 || event.button === 2) && event.altKey) {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            brushAdjustRef.current = {
                active: true,
                pointerId: event.pointerId,
                startX: event.clientX,
                startSize: brushSize,
                previewX: event.clientX,
                previewY: event.clientY,
            };
            updateBrushPreview(event, brushSize, true);
            return;
        }
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        updateBrushPreview(event);
        drawingRef.current = { active: true, stroke: { mode, size: brushSize, color, points: [] } };
        draw(event);
    };

    const moveDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const brushAdjust = brushAdjustRef.current;
        if (brushAdjust?.active && event.pointerId === brushAdjust.pointerId) {
            event.preventDefault();
            event.stopPropagation();
            const nextSize = clampBrushSize(brushAdjust.startSize + event.clientX - brushAdjust.startX);
            setBrushSize(nextSize);
            setBrushPreview({ x: brushAdjust.previewX, y: brushAdjust.previewY, size: nextSize, adjusting: true });
            return;
        }
        updateBrushPreview(event);
        if (!drawingRef.current.active) return;
        event.preventDefault();
        draw(event);
    };

    const stopDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const brushAdjust = brushAdjustRef.current;
        if (brushAdjust?.active && event.pointerId === brushAdjust.pointerId) {
            brushAdjustRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            updateBrushPreview(event, brushSize);
            return;
        }
        const stroke = drawingRef.current.stroke;
        drawingRef.current = { active: false, stroke: null };
        if (stroke?.points.length) {
            historyRef.current.push(stroke);
            setHistorySize(historyRef.current.length);
            redoRef.current = [];
            setRedoSize(0);
        }
    };

    const undoStroke = useCallback(() => {
        if (drawingRef.current.active || !historyRef.current.length) return;
        const stroke = historyRef.current.pop();
        if (stroke) redoRef.current.push(stroke);
        setHistorySize(historyRef.current.length);
        setRedoSize(redoRef.current.length);
        replayStrokes(historyRef.current, canvasRef.current);
        setError("");
    }, []);

    const redoStroke = useCallback(() => {
        if (drawingRef.current.active || !redoRef.current.length) return;
        const stroke = redoRef.current.pop();
        if (stroke) historyRef.current.push(stroke);
        setHistorySize(historyRef.current.length);
        setRedoSize(redoRef.current.length);
        replayStrokes(historyRef.current, canvasRef.current);
        setError("");
    }, []);

    const resetStrokes = () => {
        historyRef.current = [];
        redoRef.current = [];
        setHistorySize(0);
        setRedoSize(0);
        clearCanvas(canvasRef.current);
        setError("");
    };

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("input,textarea,[contenteditable='true']")) return;
            const key = event.key.toLowerCase();
            const modifier = (event.metaKey || event.ctrlKey) && !event.altKey;
            const isUndo = modifier && !event.shiftKey && key === "z";
            const isRedo = modifier && ((event.shiftKey && key === "z") || (!event.shiftKey && key === "y"));
            if (!isUndo && !isRedo) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (isRedo) redoStroke();
            else undoStroke();
        };
        window.addEventListener("keydown", handleKeyDown, true);
        return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [open, redoStroke, undoStroke]);

    const submit = async () => {
        const canvas = canvasRef.current;
        if (!canvas || !image) return;
        if (!canvasHasPaint(canvas)) return setError(t("canvas.editors.annotateRequired"));
        setSaving(true);
        setError("");
        try {
            const composed = await composeAnnotatedImage(dataUrl, canvas);
            onConfirm(composed);
        } catch {
            setError(t("canvas.editors.annotateFailed"));
            setSaving(false);
        }
    };

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={980} centered destroyOnHidden transitionName="" maskTransitionName="">
            <div className="grid gap-5 lg:grid-cols-[minmax(360px,1fr)_320px]" data-canvas-no-zoom>
                <div
                    ref={viewport.viewportRef}
                    {...viewport.panHandlers}
                    className={`relative h-[min(68vh,720px)] min-h-[360px] rounded-xl border border-black/10 bg-transparent dark:border-white/10 ${viewport.scrollClassName} ${viewport.isPanning ? "cursor-grabbing" : viewport.spacePressed ? "cursor-grab" : ""}`}
                >
                    <div className="relative" style={viewport.contentStyle}>
                        <div ref={viewport.stageRef} className="absolute isolate overflow-hidden rounded-lg bg-transparent select-none [backface-visibility:hidden] [contain:layout_paint] [transform:translateZ(0)]" style={viewport.stageStyle}>
                            {image ? (
                                <div className="absolute left-0 top-0 [backface-visibility:hidden]" style={viewport.mediaStyle}>
                                    <img src={dataUrl} alt="" className="absolute inset-0 block h-full w-full bg-transparent object-contain" draggable={false} />
                                    <canvas
                                        ref={canvasRef}
                                        width={image.width}
                                        height={image.height}
                                        className="absolute inset-0 h-full w-full cursor-none touch-none"
                                        onPointerDown={startDraw}
                                        onPointerMove={moveDraw}
                                        onPointerUp={stopDraw}
                                        onPointerCancel={stopDraw}
                                        onPointerEnter={(event) => updateBrushPreview(event)}
                                        onPointerLeave={() => {
                                            if (!drawingRef.current.active && !brushAdjustRef.current?.active) setBrushPreview(null);
                                        }}
                                        onContextMenu={(event) => event.preventDefault()}
                                    />
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
                {brushPreview
                    ? createPortal(
                          <div
                              className={`pointer-events-none fixed z-[1100] rounded-full border-2 ${brushPreview.adjusting ? "border-[#fbbf24] bg-black/10" : "border-white/90 bg-black/5"} shadow-[0_0_0_1px_rgba(0,0,0,.8)]`}
                              style={{ left: brushPreview.x, top: brushPreview.y, width: Math.max(4, brushPreview.size * viewport.imageScale), aspectRatio: 1, transform: "translate(-50%, -50%)" }}
                          >
                              {brushPreview.adjusting ? <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-black/75 px-1.5 py-0.5 text-xs font-semibold text-white">{brushSize}px</span> : null}
                          </div>,
                          document.body,
                      )
                    : null}

                <div className="flex min-h-[360px] flex-col gap-5">
                    <div>
                        <h2 className="text-xl font-semibold">{t("canvas.editors.annotateTitle")}</h2>
                        <div className="mt-2 text-sm opacity-60">{image ? `${image.width} x ${image.height}px` : t("canvas.editors.loading")}</div>
                        <div className="mt-2 text-xs leading-5 opacity-55">{t("canvas.editors.annotateHint")}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <Button type={mode === "paint" ? "primary" : "default"} icon={<Brush className="size-4" />} onClick={() => setMode("paint")}>
                            {t("canvas.editors.brush")}
                        </Button>
                        <Button type={mode === "erase" ? "primary" : "default"} icon={<Eraser className="size-4" />} onClick={() => setMode("erase")}>
                            {t("canvas.editors.erase")}
                        </Button>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-black/10 px-2 py-1 dark:border-white/10">
                        <Tooltip title={t("canvas.editors.annotateUndoTitle")}>
                            <Button type="text" icon={<Undo2 className="size-4" />} disabled={!historySize} aria-label={t("canvas.editors.annotateUndo")} onClick={undoStroke} />
                        </Tooltip>
                        <Tooltip title={t("canvas.editors.annotateRedoTitle")}>
                            <Button type="text" icon={<Redo2 className="size-4" />} disabled={!redoSize} aria-label={t("canvas.editors.annotateRedo")} onClick={redoStroke} />
                        </Tooltip>
                        <div className="flex items-center gap-1">
                            <Tooltip title={t("canvas.editors.zoomOut")}>
                                <Button type="text" icon={<ZoomOut className="size-4" />} disabled={!viewport.canZoomOut} aria-label={t("canvas.editors.zoomOut")} onClick={viewport.zoomOut} />
                            </Tooltip>
                            <button type="button" className="min-w-14 text-center text-xs font-semibold tabular-nums opacity-70" onClick={viewport.resetZoom}>
                                {Math.round(viewport.zoom * 100)}%
                            </button>
                            <Tooltip title={t("canvas.editors.zoomIn")}>
                                <Button type="text" icon={<ZoomIn className="size-4" />} disabled={!viewport.canZoomIn} aria-label={t("canvas.editors.zoomIn")} onClick={viewport.zoomIn} />
                            </Tooltip>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="font-medium opacity-75">{t("canvas.editors.brushSize")}</span>
                            <span className="font-semibold">{brushSize}px</span>
                        </div>
                        <Slider min={8} max={160} step={2} value={brushSize} onChange={setBrushSize} />
                    </div>

                    <div className="space-y-2">
                        <div className="text-sm font-medium opacity-75">{t("canvas.editors.annotateColor")}</div>
                        <div className="flex items-center gap-2">
                            {annotateColors.map((item) => (
                                <button
                                    key={item}
                                    type="button"
                                    aria-label={item}
                                    onClick={() => setColor(item)}
                                    className={`size-8 rounded-full border-2 transition-transform ${color === item ? "scale-110 border-black/60 dark:border-white/60" : "border-black/10 dark:border-white/10"}`}
                                    style={{ backgroundColor: item }}
                                />
                            ))}
                        </div>
                    </div>

                    {error ? <div className="text-xs font-medium text-[#ef4444]">{error}</div> : null}

                    <div className="mt-auto flex items-center justify-between gap-2">
                        <Button icon={<RotateCcw className="size-4" />} onClick={resetStrokes}>
                            {t("canvas.editors.reset")}
                        </Button>
                        <div className="flex items-center gap-2">
                            <Button icon={<X className="size-4" />} onClick={onClose}>
                                {t("canvas.editors.cancel")}
                            </Button>
                            <Button type="primary" loading={saving} onClick={submit}>
                                {t("canvas.editors.saveAnnotate")}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function readCanvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
        y: ((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
    };
}

function clampBrushSize(value: number) {
    return Math.min(160, Math.max(8, Math.round(value / 2) * 2));
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
}

function drawStroke(context: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }, size: number) {
    if (from.x === to.x && from.y === to.y) {
        context.beginPath();
        context.arc(to.x, to.y, size / 2, 0, Math.PI * 2);
        context.fill();
        return;
    }
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
}

function configureStrokeContext(context: CanvasRenderingContext2D, stroke: AnnotateStroke) {
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = stroke.size;
    context.globalCompositeOperation = stroke.mode === "paint" ? "source-over" : "destination-out";
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
}

function replayStrokes(strokes: AnnotateStroke[], canvas: HTMLCanvasElement | null) {
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokes) {
        configureStrokeContext(context, stroke);
        stroke.points.forEach((point, index) => {
            const previous = stroke.points[index - 1] || point;
            drawStroke(context, previous, point, stroke.size);
        });
    }
}

function canvasHasPaint(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < data.length; index += 4) {
        if (data[index] > 0) return true;
    }
    return false;
}

/** 将原图与涂鸦笔迹层合成为一张新图(笔迹层与原图同像素尺寸)。 */
function composeAnnotatedImage(source: string, strokesCanvas: HTMLCanvasElement) {
    return new Promise<string>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d");
            if (!context) return reject(new Error("canvas unavailable"));
            context.drawImage(image, 0, 0);
            context.drawImage(strokesCanvas, 0, 0);
            resolve(canvas.toDataURL("image/png"));
        };
        image.onerror = () => reject(new Error("image load failed"));
        image.src = source;
    });
}
