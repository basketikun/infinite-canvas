import { useEffect, useState } from "react";
import { Slider } from "radix-ui";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { CanvasDialog } from "./canvas-dialog";
import { CanvasSegments } from "./canvas-segments";
import { LoaderCircle, RotateCcw, WandSparkles } from "lucide-react";
import type { ImageAngleParams } from "@infinite-canvas/plugin-sdk";
import { getPluginErrorMessage } from "@infinite-canvas/shared/plugins";
import { hostActions } from "@workbench/lib/canvas/host-actions";
import type { ImageNodeEditorProps } from "@workbench/components/canvas/use-image-node-edits";

const defaultParams: ImageAngleParams = {
    horizontalAngle: 0,
    pitchAngle: 9,
    cameraDistance: 4.8,
    wideAngle: false,
};

export function CanvasNodeAngleDialog({ nodeId, scope, dataUrl, loadingPreview, open, onClose, onLoadPreview }: ImageNodeEditorProps) {
    const [submitting, setSubmitting] = useState(false);
    const [failedPreview, setFailedPreview] = useState<string>();
    const hasPreview = Boolean(dataUrl && dataUrl !== failedPreview);
    const [params, setParams] = useState(defaultParams);

    useEffect(() => {
        if (open) setParams(defaultParams);
    }, [open]);

    const update = <Key extends keyof ImageAngleParams>(key: Key, value: ImageAngleParams[Key]) => setParams((current) => ({ ...current, [key]: value }));
    const confirm = async () => {
        setSubmitting(true);
        try { await hostActions.nodeGenerateImageAngle({ nodeId, params }, scope.signal); onClose(); }
        catch (error) { if (!scope.signal.aborted) toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error); }
        finally { if (!scope.signal.aborted) setSubmitting(false); }
    };

    return (
        <CanvasDialog title="AI 多角度" hideTitle open={open} onClose={onClose} width={860}>
            <div className="generation-workspace-controls space-y-5">
                <div>
                    <h2 className="text-xl font-semibold">AI 多角度</h2>
                    <p className="mt-1 text-sm opacity-60">左侧只预览方向，结果会基于原图重新生成</p>
                </div>
                <div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_360px]">
                    <div className="flex min-h-[300px] flex-col justify-between rounded-xl border p-4">
                        <div className="grid flex-1 place-items-center">
                            {hasPreview ? <div className="relative">
                                <img src={dataUrl} alt="" className="size-48 rounded-2xl object-cover shadow-2xl" draggable={false} style={{ transform: previewTransform(params) }} onError={() => setFailedPreview(dataUrl)} />
                                <div className="absolute -bottom-6 left-1/2 h-10 w-24 -translate-x-1/2 rounded-full border bg-black/20 backdrop-blur" />
                            </div> : <Button variant="outline" aria-busy={loadingPreview} disabled={loadingPreview} onClick={onLoadPreview}>{loadingPreview && <LoaderCircle aria-hidden className="size-4 animate-spin" />}加载图片预览</Button>}
                        </div>
                        <Button variant="outline" className="w-fit" onClick={() => setParams(defaultParams)}>
                            <RotateCcw className="size-4" />重置
                        </Button>
                    </div>
                    <div className="space-y-6 py-2">
                        <AngleSlider label="左右角度" value={params.horizontalAngle} min={-60} max={60} step={1} suffix="deg" onChange={(value) => update("horizontalAngle", value)} />
                        <AngleSlider label="俯仰角度" value={params.pitchAngle} min={-45} max={45} step={1} suffix="deg" onChange={(value) => update("pitchAngle", value)} />
                        <AngleSlider label="镜头距离" value={params.cameraDistance} min={1} max={10} step={0.1} onChange={(value) => update("cameraDistance", value)} />
                        <div className="grid grid-cols-[88px_1fr_72px] items-center gap-4">
                            <span className="font-medium opacity-75">广角镜头</span>
                            <CanvasSegments label="广角镜头"
                                value={params.wideAngle ? "wide" : "standard"}
                                options={[
                                    { label: "标准", value: "standard" },
                                    { label: "广角", value: "wide" },
                                ]}
                                onChange={(value) => update("wideAngle", value === "wide")}
                            />
                        </div>
                    </div>
                </div>
                <div className="flex justify-end">
                    <Button size="lg" aria-busy={submitting} disabled={submitting} onClick={() => { void confirm(); }}>
                        {submitting ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}AI 生成
                    </Button>
                </div>
            </div>
        </CanvasDialog>
    );
}

function AngleSlider({ label, value, min, max, step, suffix = "", onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void }) {
    return (
        <div className="grid grid-cols-[88px_1fr_72px] items-center gap-4">
            <span className="font-medium opacity-75">{label}</span>
            <Slider.Root className="relative flex h-4 touch-none select-none items-center" min={min} max={max} step={step} value={[value]} onValueChange={([next]) => onChange(next)}>
                <Slider.Track className="relative h-1 w-full rounded-full bg-muted"><Slider.Range className="absolute h-full rounded-full bg-(--generation-primary)" /></Slider.Track>
                <Slider.Thumb aria-label={label} aria-valuetext={`${value}${suffix}`} className="block size-3 rounded-full border-2 border-(--generation-primary) bg-(--generation-control) focus-visible:outline-2 focus-visible:outline-(--workbench-button-focus)" />
            </Slider.Root>
            <span className="whitespace-nowrap text-right font-semibold">
                {Number.isInteger(value) ? value : value.toFixed(1)}
                {suffix}
            </span>
        </div>
    );
}

function previewTransform(params: ImageAngleParams) {
    const scale = 1.08 - params.cameraDistance * 0.035 + (params.wideAngle ? -0.08 : 0);
    return `perspective(520px) rotateY(${params.horizontalAngle * -0.45}deg) rotateX(${params.pitchAngle * 0.35}deg) scale(${Math.max(0.72, Math.min(1.08, scale))})`;
}
