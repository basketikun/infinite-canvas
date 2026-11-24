import { useEffect, useMemo, useState } from "react";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { CanvasDialog } from "./canvas-dialog";
import { CanvasSegments } from "./canvas-segments";
import { ImagePlus, LoaderCircle } from "lucide-react";

import type { ImageUpscaleAlgorithm, ImageUpscaleParams } from "@infinite-canvas/plugin-sdk";
import { getPluginErrorMessage } from "@infinite-canvas/shared/plugins";
import { MAX_UPSCALE_LONG_EDGE, resolveUpscaleSize } from "@workbench/lib/canvas/canvas-image-data";
import { hostActions } from "@workbench/lib/canvas/host-actions";
import type { ImageNodeEditorProps } from "@workbench/components/canvas/use-image-node-edits";

const algorithms: ImageUpscaleAlgorithm[] = ["high", "bilinear", "nearest"];

const targetOptions = [
    { label: "1K", value: 1024 },
    { label: "2K", value: 2048 },
    { label: "4K", value: MAX_UPSCALE_LONG_EDGE },
];

const defaultParams: ImageUpscaleParams = {
    targetLongEdge: 2048,
    algorithm: "high",
};

export function CanvasNodeUpscaleDialog({ nodeId, scope, dataUrl, image, loadingPreview, open, onClose, onLoadPreview }: ImageNodeEditorProps) {
    const [submitting, setSubmitting] = useState(false);
    const [failedPreview, setFailedPreview] = useState<string>();
    const hasPreview = Boolean(dataUrl && dataUrl !== failedPreview && image);
    const [params, setParams] = useState<ImageUpscaleParams>(defaultParams);
    const sourceLongEdge = image ? Math.max(image.width, image.height) : 0;
    const outputSize = useMemo(() => (image ? resolveUpscaleSize(image.width, image.height, params.targetLongEdge) : null), [image, params.targetLongEdge]);
    const canUpscale = Boolean(image && sourceLongEdge < params.targetLongEdge && params.targetLongEdge <= MAX_UPSCALE_LONG_EDGE);
    const reachedMax = Boolean(image && sourceLongEdge >= MAX_UPSCALE_LONG_EDGE);

    useEffect(() => {
        if (!open) return;
        setParams(defaultParams);
    }, [dataUrl, open]);

    useEffect(() => {
        if (!image) return;
        const nextTarget = targetOptions.find((option) => sourceLongEdge < option.value)?.value || MAX_UPSCALE_LONG_EDGE;
        setParams((current) => ({ ...current, targetLongEdge: nextTarget }));
    }, [image, sourceLongEdge]);
    const confirm = async () => {
        setSubmitting(true);
        try { await hostActions.nodeUpscaleImage({ nodeId, params }, scope.signal); onClose(); }
        catch (error) { if (!scope.signal.aborted) toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error); }
        finally { if (!scope.signal.aborted) setSubmitting(false); }
    };

    return (
        <CanvasDialog title="图片放大" hideTitle open={open} onClose={onClose} width={820}>
            <div className="generation-workspace-controls space-y-5">
                <div>
                    <h2 className="text-xl font-semibold">图片放大</h2>
                </div>
                <div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_360px]">
                    <div className="rounded-xl border p-4">
                        <div className="grid min-h-[280px] place-items-center rounded-lg bg-black/5">
                            {hasPreview ? <img src={dataUrl} alt="" className="max-h-[320px] max-w-full rounded-lg object-contain shadow-xl" draggable={false} onError={() => setFailedPreview(dataUrl)} /> : <Button variant="outline" aria-busy={loadingPreview} disabled={loadingPreview} onClick={onLoadPreview}>{loadingPreview && <LoaderCircle aria-hidden className="size-4 animate-spin" />}加载图片预览</Button>}
                        </div>
                        <div className="mt-3 flex items-center justify-between text-sm">
                            <span className="opacity-60">源图</span>
                            <span className="font-semibold">{image ? `${image.width} x ${image.height} px` : "读取中"}</span>
                        </div>
                    </div>
                    <div className="space-y-6 py-2">
                        <div className="space-y-2">
                            <div className="font-medium opacity-75">目标像素</div>
                            <CanvasSegments label="目标像素"
                                block
                                value={params.targetLongEdge}
                                options={targetOptions.map((option) => ({ label: `${option.label} · ${option.value}px`, value: option.value, disabled: Boolean(image && sourceLongEdge >= option.value) }))}
                                onChange={(value) => setParams((current) => ({ ...current, targetLongEdge: value }))}
                            />
                            {image && !canUpscale ? <div className="text-xs font-medium text-[#ef4444]">{reachedMax ? "图片已达到 4K，无需放大" : "图片已达到当前目标像素，无需放大"}</div> : null}
                        </div>
                        <div className="space-y-2">
                            <div className="font-medium opacity-75">放大算法</div>
                            <CanvasSegments label="放大算法"
                                block
                                value={params.algorithm}
                                options={algorithms.map((algorithm) => ({
                                    value: algorithm,
                                    label: (
                                        <span className="flex min-h-12 flex-col justify-center text-left leading-5">
                                            <span className="font-medium">{({ "high": "高清插值", "bilinear": "双线性", "nearest": "最近邻" } as Record<string, string>)[algorithm]}</span>
                                            <span className="text-xs opacity-55">{({ "high": "适合照片和细节图", "bilinear": "平滑、速度快", "nearest": "适合像素风格" } as Record<string, string>)[algorithm]}</span>
                                        </span>
                                    ),
                                }))}
                                onChange={(value) => setParams((current) => ({ ...current, algorithm: value }))}
                            />
                        </div>
                        <div className="rounded-xl border px-4 py-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="opacity-60">输出尺寸</span>
                                <span className="font-semibold">{outputSize ? `${outputSize.width} x ${outputSize.height} px` : "未知"}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex justify-end">
                    <Button size="lg" aria-busy={submitting} disabled={submitting || !hasPreview || !canUpscale} onClick={() => { void confirm(); }}>
                        {submitting ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}生成放大图
                    </Button>
                </div>
            </div>
        </CanvasDialog>
    );
}
