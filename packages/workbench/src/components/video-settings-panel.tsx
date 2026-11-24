import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";
import { Slider } from "radix-ui";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@infinite-canvas/plugin-sdk/ui/tooltip";

import { type CanvasTheme } from "@workbench/lib/canvas-theme";
import { normalizeGenerationOptions, visibleOptions } from "@workbench/lib/generation-options";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio, parseAspectRatio, parseVideoResolution, readVideoDimensions, VIDEO_SECONDS_MAX, VIDEO_SECONDS_MIN, videoRatioOptions } from "@workbench/lib/media-size";
import { ArrowLeftRight } from "lucide-react";
import { type AiConfig } from "@workbench/stores/use-config-store";

const videoModeOptions = [
    { value: "frames", label: "首尾帧模式" },
    { value: "reference", label: "全能参考模式" },
];
const resolutionOptions = [
    { value: "480", label: "480p" },
    { value: "720", label: "720p" },
    { value: "1080", label: "1080p" },
];

export const videoResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSizeOptions = videoRatioOptions.map((item) => ({ value: item.value, label: item.value === "auto" ? "自动" : item.value }));
export const videoSecondsRange = { min: VIDEO_SECONDS_MIN, max: VIDEO_SECONDS_MAX };

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "videoSize" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: VideoSettingsPanelProps) {
    const seconds = Number(clampVideoSeconds(config.videoSeconds || "6"));
    const videoMode = normalizeVideoModeValue(config.videoMode);
    const resolution = parseVideoResolution(config.vquality);
    const selectedRatio = inferVideoRatio(config.videoSize || "auto");
    const dimensions = readVideoDimensions(config.videoSize || "auto", resolution, selectedRatio);
    const options = normalizeGenerationOptions(config.generationOptions);
    const resolutionList = visibleOptions(options.videoResolution.filter((option) => option.enabled), resolution);
    const ratioEntries = options.videoRatio.map((option) => ({ ...option, ...(parseAspectRatio(option.value) ?? { width: 0, height: 0 }) }));
    const ratioList = visibleOptions(ratioEntries.filter((option) => option.enabled), selectedRatio)
        .map((option) => ({ ...option, ...(parseAspectRatio(option.value) ?? { width: 0, height: 0 }) }));
    const applySize = (nextResolution: string, ratio: string) => {
        onConfigChange("vquality", nextResolution);
        onConfigChange("videoSize", computeVideoSize(nextResolution, ratio));
    };
    const selectResolution = (nextResolution: string) => {
        if (selectedRatio === "auto") onConfigChange("vquality", nextResolution);
        else applySize(nextResolution, selectedRatio);
    };

    return (
        <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
            {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
            <SettingGroup title="清晰度" color={theme.node.muted}>
                <div className="grid grid-cols-4 gap-2.5">
                    {resolutionList.map((item) => (
                        <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => selectResolution(item.value)}>
                            {item.label}
                        </OptionPill>
                    ))}
                    <ResolutionInput value={resolution} theme={theme} onChange={selectResolution} />
                </div>
            </SettingGroup>
            <SettingGroup title="尺寸" color={theme.node.muted}>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                    <DimensionInput prefix="W" value={dimensions.width} disabled={selectedRatio === "auto"} theme={theme} onChange={(value) => updateDimension("width", value, dimensions, onConfigChange)} />
                    <ArrowLeftRight className="size-4 opacity-45" aria-hidden="true" />
                    <DimensionInput prefix="H" value={dimensions.height} disabled={selectedRatio === "auto"} theme={theme} onChange={(value) => updateDimension("height", value, dimensions, onConfigChange)} />
                </div>
            </SettingGroup>
            <SettingGroup title="比例" color={theme.node.muted}>
                <div className="grid grid-cols-4 gap-2.5">
                    {ratioList.map((item) => (
                        <button
                            key={item.value}
                            type="button"
                            className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                            style={{ borderColor: selectedRatio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={() => applySize(resolution, item.value)}
                        >
                            <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                            <span>{item.value === "auto" ? "自动" : item.value}</span>
                        </button>
                    ))}
                </div>
            </SettingGroup>
            <SettingGroup title="秒数" color={theme.node.muted}>
                <div className="flex items-center gap-3" onMouseDown={(event) => event.stopPropagation()}>
                    <DurationSlider seconds={seconds} theme={theme} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                    <SecondsInput value={seconds} theme={theme} onCommit={(value) => onConfigChange("videoSeconds", String(value))} />
                    <span className="shrink-0 text-sm" style={{ color: theme.node.muted }}>s</span>
                </div>
            </SettingGroup>
            <SettingGroup title="模式" color={theme.node.muted}>
                <div className="grid grid-cols-2 gap-2.5">
                    {videoModeOptions.map((item) => (
                        <OptionPill key={item.value} selected={videoMode === item.value} theme={theme} onClick={() => onConfigChange("videoMode", item.value)}>
                            {item.label}
                        </OptionPill>
                    ))}
                </div>
            </SettingGroup>
        </div>
    );
}

export function videoResolutionLabel(value: string) {
    return `${parseVideoResolution(value)}p`;
}

export function videoSizeLabel(value: string) {
    const ratio = inferVideoRatio(value);
    return ratio === "auto" ? "自适应" : ratio;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return "智能";
    return `${value || "6"}s`;
}

export function videoModeLabel(value: string) {
    return ({ "frames": "首尾帧模式", "reference": "全能参考模式" } as Record<string, string>)[normalizeVideoModeValue(value)];
}

export function normalizeVideoModeValue(value: string | undefined) {
    return value === "reference" ? "reference" : "frames";
}

export function normalizeVideoSizeValue(value: string, resolution = "720") {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value);
    return ratio === "auto" ? "auto" : computeVideoSize(resolution, ratio);
}

export function normalizeVideoResolutionValue(value: string) {
    return parseVideoResolution(value);
}

function updateDimension(key: "width" | "height", value: number | null, dimensions: { width: number; height: number }, onConfigChange: VideoSettingsPanelProps["onConfigChange"]) {
    const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
    onConfigChange("videoSize", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" disabled={disabled} className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35" style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function ResolutionInput({ value, theme, onChange }: { value: string; theme: CanvasTheme; onChange: (value: string) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input type="number" min={1} className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value} onChange={(event) => onChange(event.target.value)} onMouseDown={(event) => event.stopPropagation()} />
            <span className="grid w-7 place-items-center pr-1" style={{ color: theme.node.muted }}>
                p
            </span>
        </label>
    );
}

function DurationSlider({ seconds, theme, onChange }: { seconds: number; theme: CanvasTheme; onChange: (value: number) => void }) {
    const [tipOpen, setTipOpen] = useState(false);
    const [tipInteraction, setTipInteraction] = useState<"keyboard" | "drag" | null>(null);
    const drag = useRef<{ pointerId: number; seconds: number; x: number } | null>(null);
    const span = VIDEO_SECONDS_MAX - VIDEO_SECONDS_MIN;
    // MouseEvent 使用整数页面坐标，触摸使用实际触点坐标。
    const pointerX = (event: PointerEvent) => event.pointerType === "mouse" ? Math.floor(event.pageX) : event.pageX;

    function moveThumb(event: PointerEvent<HTMLSpanElement>) {
        const start = drag.current;
        if (!start || event.pointerId !== start.pointerId) return;
        event.preventDefault();
        const delta = (pointerX(event) - start.x) / event.currentTarget.getBoundingClientRect().width * span;
        const value = Math.max(VIDEO_SECONDS_MIN, Math.min(VIDEO_SECONDS_MAX, start.seconds + delta));
        // 等距时沿用原滑块的取整顺序：端点、按下时的值、最近的整秒。
        const next = [VIDEO_SECONDS_MIN, VIDEO_SECONDS_MAX, start.seconds, Math.round(value)].reduce((best, candidate) =>
            Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best);
        if (next !== seconds) onChange(next);
    }

    function handleKey(event: KeyboardEvent<HTMLSpanElement>) {
        let delta: number;
        switch (event.key) {
            case "Home": case "End": setTipInteraction("keyboard"); return;
            case "PageUp": delta = 2; break;
            case "PageDown": delta = -2; break;
            case "ArrowUp": case "ArrowRight": delta = 1; break;
            case "ArrowDown": case "ArrowLeft": delta = -1; break;
            default: return;
        }
        setTipInteraction("keyboard");
        if (event.key.startsWith("Arrow") && !event.shiftKey) return;
        // 翻页两秒，Shift+方向键一秒，普通方向键和端点仍由 Radix 处理。
        event.preventDefault();
        const next = Number(clampVideoSeconds(String(seconds + delta)));
        if (next !== seconds) onChange(next);
    }

    return <TooltipProvider>
        <Slider.Root className="group relative mx-[5px] my-[11px] flex h-3 min-w-0 flex-1 touch-none items-center py-1 select-none"
            style={{ "--duration-active": theme.node.activeStroke, "--duration-handle": theme.toolbar.panel, color: theme.node.text } as CSSProperties}
            min={VIDEO_SECONDS_MIN} max={VIDEO_SECONDS_MAX} step={1} value={[seconds]} onValueChange={([value]) => onChange(value)}
            onKeyDown={handleKey} onPointerMove={moveThumb}
            onPointerDown={(event) => { if (event.button === 0) setTipInteraction("drag"); else event.preventDefault(); }}
            onLostPointerCapture={() => { drag.current = null; setTipInteraction(null); }}>
            <Slider.Track className="relative h-1 w-full rounded-full" style={{ background: theme.node.stroke }}>
                <Slider.Range className="absolute h-full rounded-full bg-(--duration-active) group-hover:bg-[light-dark(#1a1a1a,var(--duration-active))]" />
            </Slider.Track>
            <Tooltip open={tipOpen || tipInteraction !== null} onOpenChange={setTipOpen}>
                <TooltipTrigger asChild>
                    <Slider.Thumb aria-label="视频秒数" aria-valuetext={`${seconds} 秒`}
                        style={{ translate: `${(seconds - VIDEO_SECONDS_MIN) / span * 100 - 50}%` }}
                        onPointerDown={(event) => { if (event.button === 0) drag.current = { pointerId: event.pointerId, seconds, x: pointerX(event) }; }}
                        onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) setTipInteraction("keyboard"); }} onBlur={() => setTipInteraction(null)}
                        className="relative block size-2.5 cursor-pointer rounded-full outline-none before:absolute before:-inset-0.5 after:absolute after:inset-0 after:rounded-full after:bg-(--duration-handle) after:shadow-[0_0_0_2px_currentColor] hover:after:scale-120 focus:after:scale-120 hover:after:outline-5 focus:after:outline-5 after:outline-current/20" />
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6} onEscapeKeyDown={() => setTipInteraction(null)} style={{ color: `light-dark(${theme.node.panel}, white)` }}
                    className="pointer-events-none z-[1300] rounded-md bg-[light-dark(rgb(0_0_0_/_85%),#424242)] px-2 py-1.5 text-sm leading-5 shadow-lg [&_svg]:bg-[light-dark(rgb(0_0_0_/_85%),#424242)] [&_svg]:fill-[light-dark(rgb(0_0_0_/_85%),#424242)]">{seconds}</TooltipContent>
            </Tooltip>
        </Slider.Root>
    </TooltipProvider>;
}

function SecondsInput({ value, theme, onCommit }: { value: number; theme: CanvasTheme; onCommit: (value: number) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = Number(clampVideoSeconds(input.value));
        input.value = String(next);
        onCommit(next);
    };

    return (
        <label className="flex h-9 w-[68px] shrink-0 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text }}>
            <input
                type="number"
                min={VIDEO_SECONDS_MIN}
                max={VIDEO_SECONDS_MAX}
                className="min-w-0 flex-1 bg-transparent px-2 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value}
                key={value}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input type="number" min={1} disabled={disabled} className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value || ""} onChange={(event) => onChange(Number(event.target.value) || null)} onMouseDown={(event) => event.stopPropagation()} />
        </label>
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}
