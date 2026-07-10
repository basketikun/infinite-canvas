import { useEffect, useState } from "react";
import { Button, InputNumber, Modal } from "antd";
import { Grid2x2 } from "lucide-react";

import { useTranslation } from "@/components/layout/locale-provider";
import { readImageMeta } from "@/lib/image-utils";
import type { ImageSplitParams } from "@/lib/canvas/canvas-image-data";

export type CanvasImageSplitParams = ImageSplitParams;

const defaultParams: CanvasImageSplitParams = { rows: 2, columns: 2 };
const maxGridSize = 12;

export function CanvasNodeSplitDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (params: CanvasImageSplitParams) => void }) {
    const { t } = useTranslation();
    const [params, setParams] = useState(defaultParams);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const total = params.rows * params.columns;
    const pieceSize = image ? { width: Math.max(1, Math.floor(image.width / params.columns)), height: Math.max(1, Math.floor(image.height / params.rows)) } : null;

    useEffect(() => {
        if (!open) return;
        setParams(defaultParams);
        setImage(null);
    }, [dataUrl, open]);

    useEffect(() => {
        if (!open) return;
        void readImageMeta(dataUrl).then(setImage);
    }, [dataUrl, open]);

    const update = (key: keyof CanvasImageSplitParams, value: string | number | null) => {
        setParams((current) => ({ ...current, [key]: clampGrid(value ?? current[key]) }));
    };

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={780} centered destroyOnHidden>
            <div className="space-y-5">
                <div>
                    <h2 className="text-xl font-semibold">{t("canvas.dialogs.split.title")}</h2>
                    <p className="mt-1 text-sm opacity-60">{t("canvas.dialogs.split.description", { count: total })}</p>
                </div>
                <div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_280px]">
                    <div className="rounded-xl border p-4">
                        <div className="grid min-h-[300px] place-items-center rounded-lg bg-black/5">
                            <div className="relative inline-block max-w-full overflow-hidden rounded-lg bg-black shadow-xl">
                                <img src={dataUrl} alt="" className="block max-h-[340px] max-w-full object-contain opacity-95" draggable={false} />
                                <SplitGrid rows={params.rows} columns={params.columns} />
                            </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-sm">
                            <span className="opacity-60">{t("canvas.dialogs.crop.original")}</span>
                            <span className="font-semibold">{image ? `${image.width} x ${image.height} ${t("canvas.common.px")}` : t("canvas.common.reading")}</span>
                        </div>
                    </div>
                    <div className="space-y-5 py-2">
                        <NumberField label={t("canvas.dialogs.split.rows")} value={params.rows} onChange={(value) => update("rows", value)} />
                        <NumberField label={t("canvas.dialogs.split.columns")} value={params.columns} onChange={(value) => update("columns", value)} />
                        <div className="rounded-xl border px-4 py-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="opacity-60">{t("canvas.dialogs.split.childNodes")}</span>
                                <span className="font-semibold">{t("canvas.configNode.inputCount", { count: total })}</span>
                            </div>
                            <div className="mt-2 flex items-center justify-between">
                                <span className="opacity-60">{t("canvas.dialogs.split.pieceSize")}</span>
                                <span className="font-semibold">{pieceSize ? `${pieceSize.width} x ${pieceSize.height}` : t("canvas.common.unknown")}</span>
                            </div>
                        </div>
                        <Button type="primary" size="large" className="w-full" icon={<Grid2x2 className="size-4" />} onClick={() => onConfirm(params)}>
                            {t("canvas.dialogs.split.generateChildren")}
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

function SplitGrid({ rows, columns }: CanvasImageSplitParams) {
    return (
        <div className="pointer-events-none absolute inset-0">
            {Array.from({ length: columns - 1 }).map((_, index) => (
                <div key={`column-${index}`} className="absolute inset-y-0 border-l border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,.35)]" style={{ left: `${((index + 1) / columns) * 100}%` }} />
            ))}
            {Array.from({ length: rows - 1 }).map((_, index) => (
                <div key={`row-${index}`} className="absolute inset-x-0 border-t border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,.35)]" style={{ top: `${((index + 1) / rows) * 100}%` }} />
            ))}
        </div>
    );
}

function clampGrid(value: string | number) {
    const numberValue = Number(value);
    return Math.min(maxGridSize, Math.max(1, Math.round(Number.isFinite(numberValue) ? numberValue : 1)));
}
