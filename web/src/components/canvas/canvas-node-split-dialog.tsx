import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, InputNumber, Modal } from "antd";
import { Grid2x2, ListRestart, PanelTop, Rows3, Trash2 } from "lucide-react";

import { readImageMeta } from "@/lib/image-utils";
import type { ImageSplitParams } from "@/lib/canvas/canvas-image-data";

export type CanvasImageSplitParams = ImageSplitParams;

const defaultParams: CanvasImageSplitParams = { rows: 2, columns: 2, horizontalLines: [0.5], verticalLines: [0.5] };
const maxGridSize = 12;
type ActiveLine = { axis: "horizontal" | "vertical"; index: number } | null;

export function CanvasNodeSplitDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (params: CanvasImageSplitParams) => void }) {
    const [params, setParams] = useState(defaultParams);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [active, setActive] = useState<ActiveLine>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    const horizontalLines = params.horizontalLines || [];
    const verticalLines = params.verticalLines || [];
    const rows = horizontalLines.length + 1;
    const columns = verticalLines.length + 1;
    const total = rows * columns;
    const pieceSize = image ? { width: Math.max(1, Math.floor(image.width / columns)), height: Math.max(1, Math.floor(image.height / rows)) } : null;

    useEffect(() => {
        if (!open) return;
        setParams(defaultParams);
        setActive(null);
        setImage(null);
    }, [dataUrl, open]);

    useEffect(() => {
        if (!open) return;
        void readImageMeta(dataUrl).then(setImage);
    }, [dataUrl, open]);

    const update = (key: "rows" | "columns", value: string | number | null) => {
        const count = clampGrid(value ?? params[key]);
        setActive(null);
        setParams((current) => ({ ...current, [key]: count, [key === "rows" ? "horizontalLines" : "verticalLines"]: buildGridLines(count) }));
    };
    const addLine = (axis: "horizontal" | "vertical") => {
        setParams((current) => {
            const key = axis === "horizontal" ? "horizontalLines" : "verticalLines";
            const lines = [...(current[key] || []), findLineSpot(current[key] || [])].sort((a, b) => a - b);
            return { ...current, [key]: lines, rows: axis === "horizontal" ? lines.length + 1 : current.rows, columns: axis === "vertical" ? lines.length + 1 : current.columns };
        });
    };
    const deleteLine = () => {
        if (!active) return;
        setParams((current) => {
            const key = active.axis === "horizontal" ? "horizontalLines" : "verticalLines";
            const lines = (current[key] || []).filter((_, index) => index !== active.index);
            return { ...current, [key]: lines, rows: active.axis === "horizontal" ? lines.length + 1 : current.rows, columns: active.axis === "vertical" ? lines.length + 1 : current.columns };
        });
        setActive(null);
    };
    const startDrag = (axis: "horizontal" | "vertical", index: number, event: ReactPointerEvent) => {
        event.preventDefault();
        setActive({ axis, index });
        const box = previewRef.current?.getBoundingClientRect();
        if (!box) return;
        const move = (moveEvent: PointerEvent) => setLine(axis, index, axis === "horizontal" ? (moveEvent.clientY - box.top) / box.height : (moveEvent.clientX - box.left) / box.width);
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };
    const setLine = (axis: "horizontal" | "vertical", index: number, value: number) => {
        setParams((current) => {
            const key = axis === "horizontal" ? "horizontalLines" : "verticalLines";
            const lines = [...(current[key] || [])];
            lines[index] = clampLine(value, lines[index - 1] ?? 0, lines[index + 1] ?? 1);
            return { ...current, [key]: lines };
        });
    };
    const resetLines = () => {
        setActive(null);
        setParams((current) => ({ ...current, horizontalLines: buildGridLines(current.rows), verticalLines: buildGridLines(current.columns) }));
    };
    const confirmParams = { ...params, horizontalLines, verticalLines, rows, columns };

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={780} centered destroyOnHidden>
            <div className="space-y-5">
                <div>
                    <h2 className="text-xl font-semibold">切分图片</h2>
                    <p className="mt-1 text-sm opacity-60">生成 {total} 个图片子节点，并按原图网格排列到画布右侧</p>
                </div>
                <div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_280px]">
                    <div className="rounded-xl border p-4">
                        <div className="grid min-h-[300px] place-items-center rounded-lg bg-black/5">
                            <div ref={previewRef} className="relative inline-block max-w-full overflow-hidden rounded-lg bg-black shadow-xl">
                                <img src={dataUrl} alt="" className="block max-h-[340px] max-w-full object-contain opacity-95" draggable={false} />
                                <SplitGrid horizontalLines={horizontalLines} verticalLines={verticalLines} active={active} onPointerDown={startDrag} />
                            </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-sm">
                            <span className="opacity-60">原图</span>
                            <span className="font-semibold">{image ? `${image.width} x ${image.height} px` : "读取中"}</span>
                        </div>
                    </div>
                    <div className="space-y-5 py-2">
                        <NumberField label="行数" value={rows} onChange={(value) => update("rows", value)} />
                        <NumberField label="列数" value={columns} onChange={(value) => update("columns", value)} />
                        <div className="grid grid-cols-2 gap-2">
                            <Button icon={<Rows3 className="size-4" />} onClick={() => addLine("horizontal")}>横向线</Button>
                            <Button icon={<PanelTop className="size-4 rotate-90" />} onClick={() => addLine("vertical")}>纵向线</Button>
                            <Button icon={<Trash2 className="size-4" />} disabled={!active} onClick={deleteLine}>删除线</Button>
                            <Button icon={<ListRestart className="size-4" />} onClick={resetLines}>重置线</Button>
                        </div>
                        <div className="rounded-xl border px-4 py-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="opacity-60">切片数量</span>
                                <span className="font-semibold">{total} 个</span>
                            </div>
                            <div className="mt-2 flex items-center justify-between">
                                <span className="opacity-60">平均约</span>
                                <span className="font-semibold">{pieceSize ? `${pieceSize.width} x ${pieceSize.height}` : "未知"}</span>
                            </div>
                        </div>
                        <Button type="primary" size="large" className="w-full" icon={<Grid2x2 className="size-4" />} onClick={() => onConfirm(confirmParams)}>
                            生成子节点
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: string | number | null) => void }) {
    return (
        <label className="block space-y-2">
            <span className="font-medium opacity-75">{label}</span>
            <InputNumber className="w-full" min={1} max={maxGridSize} precision={0} value={value} onChange={onChange} />
        </label>
    );
}

function SplitGrid({ horizontalLines, verticalLines, active, onPointerDown }: { horizontalLines: number[]; verticalLines: number[]; active: ActiveLine; onPointerDown: (axis: "horizontal" | "vertical", index: number, event: ReactPointerEvent) => void }) {
    return (
        <div className="pointer-events-none absolute inset-0">
            {verticalLines.map((line, index) => (
                <div key={`column-${index}`} className="pointer-events-auto absolute inset-y-0 -ml-2 w-4 cursor-ew-resize" style={{ left: `${line * 100}%` }} onPointerDown={(event) => onPointerDown("vertical", index, event)}>
                    <div className={`absolute left-1/2 top-0 h-full border-l shadow-[0_0_0_1px_rgba(0,0,0,.35)] ${active?.axis === "vertical" && active.index === index ? "border-amber-300" : "border-white/90"}`} />
                </div>
            ))}
            {horizontalLines.map((line, index) => (
                <div key={`row-${index}`} className="pointer-events-auto absolute inset-x-0 -mt-2 h-4 cursor-ns-resize" style={{ top: `${line * 100}%` }} onPointerDown={(event) => onPointerDown("horizontal", index, event)}>
                    <div className={`absolute left-0 top-1/2 w-full border-t shadow-[0_0_0_1px_rgba(0,0,0,.35)] ${active?.axis === "horizontal" && active.index === index ? "border-amber-300" : "border-white/90"}`} />
                </div>
            ))}
        </div>
    );
}

function buildGridLines(count: number) {
    return Array.from({ length: Math.max(1, count) - 1 }, (_, index) => (index + 1) / count);
}

function findLineSpot(lines: number[]) {
    const cuts = [0, ...lines, 1].sort((a, b) => a - b);
    let spot = 0.5;
    let max = 0;
    for (let index = 0; index < cuts.length - 1; index += 1) {
        const gap = cuts[index + 1] - cuts[index];
        if (gap > max) {
            max = gap;
            spot = cuts[index] + gap / 2;
        }
    }
    return spot;
}

function clampLine(value: number, min: number, max: number) {
    return Math.min(max - 0.01, Math.max(min + 0.01, value));
}

function clampGrid(value: string | number) {
    const numberValue = Number(value);
    return Math.min(maxGridSize, Math.max(1, Math.round(Number.isFinite(numberValue) ? numberValue : 1)));
}
