import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Slider } from "radix-ui";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Textarea } from "@infinite-canvas/plugin-sdk/ui/textarea";
import { CanvasDialog } from "./canvas-dialog";
import { ImageEditorAction } from "./image-editor-action";
import { Brush, Eraser, ImagePlus, LoaderCircle, Redo2, RotateCcw, Undo2, WandSparkles, ZoomIn, ZoomOut } from "lucide-react";

import { getPluginErrorMessage, PluginError } from "@infinite-canvas/shared/plugins";
import { useImageEditorViewport } from "@workbench/components/canvas/use-image-editor-viewport";
import { hostActions } from "@workbench/lib/canvas/host-actions";
import type { ImageNodeEditorProps } from "@workbench/components/canvas/use-image-node-edits";

type DrawMode = "paint" | "erase";
type Point = { x: number; y: number };
type MaskStroke = { mode: DrawMode; size: number; points: Point[] };
type BrushPreview = { x: number; y: number; size: number; adjusting: boolean };

const defaultBrushSize = 100;
const maskOverlayColor = "#2563eb";
const maskOverlayAlpha = 0.4;

export function CanvasNodeMaskEditDialog({ nodeId, scope, dataUrl, loadingPreview, open, onClose, onLoadPreview }: ImageNodeEditorProps) {
    const maskCanvasRef = useRef<HTMLCanvasElement>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const drawingRef = useRef<{ active: boolean; stroke: MaskStroke | null }>({ active: false, stroke: null });
    const brushAdjustRef = useRef<{ active: boolean; pointerId: number; startX: number; startSize: number; previewX: number; previewY: number } | null>(null);
    const historyRef = useRef<MaskStroke[]>([]);
    const redoRef = useRef<MaskStroke[]>([]);
    const [loadedPreview, setLoadedPreview] = useState<{ url: string; width: number; height: number } | null>(null);
    const [failedPreview, setFailedPreview] = useState<string>();
    const [submitting, setSubmitting] = useState<boolean | null>(null);
    const hasPreview = Boolean(dataUrl && dataUrl !== failedPreview);
    const image = hasPreview && loadedPreview?.url === dataUrl ? loadedPreview : null;
    const [prompt, setPrompt] = useState("");
    const [brushSize, setBrushSize] = useState(defaultBrushSize);
    const [mode, setMode] = useState<DrawMode>("paint");
    const [error, setError] = useState("");
    const [historySize, setHistorySize] = useState(0);
    const [redoSize, setRedoSize] = useState(0);
    const [brushPreview, setBrushPreview] = useState<BrushPreview | null>(null);
    const viewport = useImageEditorViewport(image, open);

    useEffect(() => {
        if (!open) return;
        setBrushSize(defaultBrushSize);
        setMode("paint");
        setError("");
        setHistorySize(0);
        setRedoSize(0);
        setBrushPreview(null);
        historyRef.current = [];
        redoRef.current = [];
        brushAdjustRef.current = null;
        drawingRef.current = { active: false, stroke: null };
    }, [dataUrl, open]);

    useEffect(() => {
        clearCanvas(maskCanvasRef.current);
        clearCanvas(previewCanvasRef.current);
    }, [image]);

    const draw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const point = readCanvasPoint(event.currentTarget, event.clientX, event.clientY);
        const maskCanvas = maskCanvasRef.current;
        const context = maskCanvas?.getContext("2d", { willReadFrequently: true });
        const previewContext = previewCanvasRef.current?.getContext("2d");
        const stroke = drawingRef.current.stroke;
        if (!maskCanvas || !context || !previewContext || !stroke) return;
        configureStrokeContext(context, stroke);
        configurePreviewStrokeContext(previewContext, stroke);
        const last = stroke.points.at(-1);
        drawMaskStroke(context, last || point, point, stroke.size);
        drawMaskStroke(previewContext, last || point, point, stroke.size);
        stroke.points.push(point);
        if (stroke.mode === "paint") {
            setError("");
        }
    };

    const updateBrushPreview = (event: ReactPointerEvent<HTMLCanvasElement>, size = brushSize, adjusting = false) => {
        setBrushPreview({
            x: event.clientX,
            y: event.clientY,
            size,
            adjusting,
        });
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
        drawingRef.current = { active: true, stroke: { mode, size: brushSize, points: [] } };
        draw(event);
    };

    const moveDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const brushAdjust = brushAdjustRef.current;
        if (brushAdjust?.active && event.pointerId === brushAdjust.pointerId) {
            event.preventDefault();
            event.stopPropagation();
            const nextSize = clampBrushSize(brushAdjust.startSize + event.clientX - brushAdjust.startX);
            setBrushSize(nextSize);
            setBrushPreview({
                x: brushAdjust.previewX,
                y: brushAdjust.previewY,
                size: nextSize,
                adjusting: true,
            });
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

    const undoMask = useCallback(() => {
        if (drawingRef.current.active || !historyRef.current.length) return;
        const stroke = historyRef.current.pop();
        if (stroke) redoRef.current.push(stroke);
        setHistorySize(historyRef.current.length);
        setRedoSize(redoRef.current.length);
        replayMask(historyRef.current, maskCanvasRef.current, previewCanvasRef.current);
        setError("");
    }, []);

    const redoMask = useCallback(() => {
        if (drawingRef.current.active || !redoRef.current.length) return;
        const stroke = redoRef.current.pop();
        if (stroke) historyRef.current.push(stroke);
        setHistorySize(historyRef.current.length);
        setRedoSize(redoRef.current.length);
        replayMask(historyRef.current, maskCanvasRef.current, previewCanvasRef.current);
        setError("");
    }, []);

    const resetMask = () => {
        historyRef.current = [];
        redoRef.current = [];
        setHistorySize(0);
        setRedoSize(0);
        clearCanvas(maskCanvasRef.current);
        clearCanvas(previewCanvasRef.current);
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
            if (isRedo) redoMask();
            else undoMask();
        };
        window.addEventListener("keydown", handleKeyDown, true);
        return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [open, redoMask, undoMask]);

    const submit = async (generate: boolean) => {
        const canvas = maskCanvasRef.current;
        const element = imageRef.current;
        if (!prompt) return setError("请输入修改要求");
        if (!image || !canvas || !element) return;
        setSubmitting(generate);
        setError("");
        try {
            scope.signal.throwIfAborted();
            if (!canvasHasPaint(canvas)) return setError("请先涂抹局部区域");
            await hostActions.nodeEditImageMask({ nodeId, prompt, maskDataUrl: buildMaskOverlay(element, canvas), generate }, scope.signal);
            onClose();
        } catch (error) {
            if (!scope.signal.aborted) { console.error("[canvas] image mask editor", nodeId, error); setError(getPluginErrorMessage(error)); }
        } finally { if (!scope.signal.aborted) setSubmitting(null); }
    };

    return (
        <CanvasDialog title="局部遮罩编辑" hideTitle open={open} onClose={onClose} width={980}>
            <div className="grid gap-5 lg:grid-cols-[minmax(360px,1fr)_320px]" data-canvas-no-zoom>
                <div
                    ref={viewport.viewportRef}
                    {...viewport.panHandlers}
                    className={`relative h-[min(68vh,720px)] min-h-[360px] rounded-xl border border-black/10 bg-transparent dark:border-white/10 ${viewport.scrollClassName} ${viewport.isPanning ? "cursor-grabbing" : viewport.spacePressed ? "cursor-grab" : ""}`}
                >
                    {hasPreview ? <div className="relative" style={viewport.contentStyle}>
                        <div ref={viewport.stageRef} className="absolute isolate overflow-hidden rounded-lg bg-transparent select-none [backface-visibility:hidden] [contain:layout_paint] [transform:translateZ(0)]" style={viewport.stageStyle}>
                            {image ? <canvas ref={maskCanvasRef} width={image.width} height={image.height} className="hidden" /> : null}
                            <div className="absolute left-0 top-0 [backface-visibility:hidden]" style={viewport.mediaStyle}>
                                <img key={dataUrl} ref={imageRef} src={dataUrl} alt="" className="absolute inset-0 block h-full w-full bg-transparent object-contain" draggable={false} onLoad={(event) => {
                                    const element = event.currentTarget;
                                    if (!scope.signal.aborted && element === imageRef.current) setLoadedPreview({ url: dataUrl!, width: element.naturalWidth, height: element.naturalHeight });
                                }} onError={(event) => { if (!scope.signal.aborted && event.currentTarget === imageRef.current) setFailedPreview(dataUrl); }} />
                                {image ? <canvas
                                    ref={previewCanvasRef}
                                    width={image.width}
                                    height={image.height}
                                    className="absolute inset-0 h-full w-full cursor-none touch-none"
                                    style={{ opacity: maskOverlayAlpha }}
                                    onPointerDown={startDraw}
                                    onPointerMove={moveDraw}
                                    onPointerUp={stopDraw}
                                    onPointerCancel={stopDraw}
                                    onPointerEnter={(event) => updateBrushPreview(event)}
                                    onPointerLeave={() => {
                                        if (!drawingRef.current.active && !brushAdjustRef.current?.active) setBrushPreview(null);
                                    }}
                                    onContextMenu={(event) => event.preventDefault()}
                                /> : null}
                            </div>
                        </div>
                    </div> : <div className="grid h-full min-h-[360px] place-items-center"><Button type="button" variant="outline" size="sm" aria-busy={loadingPreview} disabled={loadingPreview} onClick={onLoadPreview}>{loadingPreview && <LoaderCircle className="size-4 animate-spin" />}加载图片预览</Button></div>}
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
                        <h2 className="text-xl font-semibold">局部遮罩编辑</h2>
                        <div className="mt-2 text-sm opacity-60">{image ? `${image.width} x ${image.height}px` : loadingPreview || hasPreview ? "读取中" : "未加载预览"}</div>
                        <div className="mt-2 text-xs leading-5 opacity-55">滚轮缩放 · 中键或空格+左键拖动画面 · Alt+左/右键横拖调笔刷 · Ctrl/Cmd+Z 撤回 · Ctrl/Cmd+Shift+Z 重做</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <Button type="button" size="sm" variant={mode === "paint" ? "default" : "outline"} aria-pressed={mode === "paint"} onClick={() => setMode("paint")}>
                            <Brush className="size-4" />画笔
                        </Button>
                        <Button type="button" size="sm" variant={mode === "erase" ? "default" : "outline"} aria-pressed={mode === "erase"} onClick={() => setMode("erase")}>
                            <Eraser className="size-4" />擦除
                        </Button>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-black/10 px-2 py-1 dark:border-white/10">
                        <ImageEditorAction label="撤回局部涂抹" hint="撤回局部涂抹 (Ctrl/Cmd+Z)" disabled={!historySize} onClick={undoMask}><Undo2 className="size-4" /></ImageEditorAction>
                        <ImageEditorAction label="重做局部涂抹" hint="重做局部涂抹 (Ctrl/Cmd+Shift+Z)" disabled={!redoSize} onClick={redoMask}><Redo2 className="size-4" /></ImageEditorAction>
                        <div className="flex items-center gap-1">
                            <ImageEditorAction label="缩小" disabled={!viewport.canZoomOut} onClick={viewport.zoomOut}><ZoomOut className="size-4" /></ImageEditorAction>
                            <button type="button" className="min-w-14 text-center text-xs font-semibold tabular-nums opacity-70" onClick={viewport.resetZoom}>
                                {Math.round(viewport.zoom * 100)}%
                            </button>
                            <ImageEditorAction label="放大" disabled={!viewport.canZoomIn} onClick={viewport.zoomIn}><ZoomIn className="size-4" /></ImageEditorAction>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="font-medium opacity-75">笔刷大小</span>
                            <span className="font-semibold">{brushSize}px</span>
                        </div>
                        <Slider.Root className="relative flex h-4 touch-none select-none items-center" min={8} max={160} step={2} value={[brushSize]} onValueChange={([size]) => setBrushSize(size)}>
                            <Slider.Track className="relative h-1 w-full rounded-full bg-muted"><Slider.Range className="absolute h-full rounded-full bg-primary" /></Slider.Track>
                            <Slider.Thumb aria-label="笔刷大小" aria-valuetext={`${brushSize}px`} className="block size-3 rounded-full border-2 border-primary bg-background focus-visible:outline-2 focus-visible:outline-(--workbench-button-focus)" />
                        </Slider.Root>
                    </div>

                    <div className="space-y-2">
                        <div className="text-sm font-medium opacity-75">修改要求</div>
                        <Textarea
                            aria-label="修改要求"
                            className="min-h-0 [field-sizing:fixed]"
                            rows={6}
                            value={prompt}
                            aria-invalid={Boolean(error && !prompt)}
                            placeholder="例如：把选中区域改成金属材质，保持原图光影"
                            onChange={(event) => {
                                setPrompt(event.target.value);
                                setError("");
                            }}
                        />
                        {error ? <div className="text-xs font-medium text-[#ef4444]">{error}</div> : null}
                    </div>

                    <div className="mt-auto flex items-center justify-between gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={resetMask}>
                            <RotateCcw className="size-4" />重置
                        </Button>
                        <div className="flex items-center gap-2">
                            <Button type="button" size="sm" variant="outline" aria-busy={submitting === false} disabled={!image || submitting !== null} onClick={() => { void submit(false); }}>
                                {submitting === false ? <LoaderCircle className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}导出到画布
                            </Button>
                            <Button type="button" size="sm" aria-busy={submitting === true} disabled={!image || submitting !== null} onClick={() => { void submit(true); }}>
                                {submitting === true ? <LoaderCircle className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}立刻生成
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </CanvasDialog>
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

function drawMaskStroke(context: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }, size: number) {
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

function configureStrokeContext(context: CanvasRenderingContext2D, stroke: MaskStroke) {
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = stroke.size;
    context.globalCompositeOperation = stroke.mode === "paint" ? "source-over" : "destination-out";
    context.strokeStyle = "#000";
    context.fillStyle = "#000";
}

function configurePreviewStrokeContext(context: CanvasRenderingContext2D, stroke: MaskStroke) {
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = stroke.size;
    context.globalCompositeOperation = stroke.mode === "paint" ? "source-over" : "destination-out";
    context.strokeStyle = maskOverlayColor;
    context.fillStyle = maskOverlayColor;
}

function replayMask(strokes: MaskStroke[], maskCanvas: HTMLCanvasElement | null, previewCanvas: HTMLCanvasElement | null) {
    const context = maskCanvas?.getContext("2d", { willReadFrequently: true });
    const previewContext = previewCanvas?.getContext("2d");
    if (!maskCanvas || !context || !previewCanvas || !previewContext) return;
    context.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    for (const stroke of strokes) {
        configureStrokeContext(context, stroke);
        configurePreviewStrokeContext(previewContext, stroke);
        stroke.points.forEach((point, index) => {
            const previous = stroke.points[index - 1] || point;
            drawMaskStroke(context, previous, point, stroke.size);
            drawMaskStroke(previewContext, previous, point, stroke.size);
        });
    }
}

function canvasHasPaint(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new PluginError("PLUGIN_OPERATION_FAILED");
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < data.length; index += 4) {
        if (data[index] > 0) return true;
    }
    return false;
}

function buildMaskOverlay(image: HTMLImageElement, selectionCanvas: HTMLCanvasElement) {
    const canvas = document.createElement("canvas");
    canvas.width = selectionCanvas.width;
    canvas.height = selectionCanvas.height;
    const context = canvas.getContext("2d");
    if (!context) throw new PluginError("PLUGIN_OPERATION_FAILED");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const overlay = document.createElement("canvas");
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    const overlayContext = overlay.getContext("2d");
    if (!overlayContext) throw new PluginError("PLUGIN_OPERATION_FAILED");
    overlayContext.drawImage(selectionCanvas, 0, 0);
    overlayContext.globalCompositeOperation = "source-in";
    overlayContext.fillStyle = maskOverlayColor;
    overlayContext.fillRect(0, 0, overlay.width, overlay.height);
    context.globalAlpha = maskOverlayAlpha;
    context.drawImage(overlay, 0, 0);
    return canvas.toDataURL("image/png");
}
