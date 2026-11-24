import { generationLevelLabels } from "@workbench/constant/labels";
import { type ReactNode, useState } from "react";
import { Switch } from "@infinite-canvas/plugin-sdk/ui/switch";

import { type CanvasTheme } from "@workbench/lib/canvas-theme";
import { normalizeGenerationOptions, visibleOptions } from "@workbench/lib/generation-options";
import { computeMediaSize, inferMediaRatio, inferMediaScale, mediaRatioOptions, mediaScaleOptions, parseAspectRatio, readMediaDimensions } from "@workbench/lib/media-size";
import { ArrowLeftRight } from "lucide-react";
import type { AiConfig } from "@workbench/stores/use-config-store";

export const imageQualityOptions = [
    { value: "auto", label: "自动" },
    { value: "low", label: "低" },
    { value: "medium", label: "中" },
    { value: "high", label: "高" },
    { value: "xhigh", label: "极高" },
    { value: "max", label: "最高" },
];
const DIMENSION_STEP = 16;

export const imageAspectOptions = mediaRatioOptions.map((item) => ({ value: item.value, label: item.value === "auto" ? "自动" : item.value }));
export const imageScaleOptions = mediaScaleOptions.map((value) => ({ value, label: value === "auto" ? "自动" : value }));

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "size" | "count" | "background", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    /** 固定宽高比时只保留质量、分辨率与透明背景。 */
    fixedRatio?: string;
};

export function ImageSettingsPanel({ config, onConfigChange, theme, showTitle = true, fixedRatio, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: ImageSettingsPanelProps) {
    const [snapDimensionToStep, setSnapDimensionToStep] = useState(true);
    const quality = config.quality || "auto";
    const count = Math.max(1, Math.floor(Math.abs(Number(config.count)) || 1));
    const activeSize = config.size || "auto";
    const transparentBackground = config.background === "transparent";
    const selectedScale = inferMediaScale(activeSize);
    const selectedRatio = inferMediaRatio(activeSize);
    const dimensions = readMediaDimensions(activeSize, selectedScale, selectedRatio);
    const options = normalizeGenerationOptions(config.generationOptions);
    const qualityList = visibleOptions(options.quality.filter((option) => option.enabled), quality);
    const scaleList = visibleOptions(options.imageScale.filter((option) => option.enabled), selectedScale);
    const ratioEntries = options.imageRatio.map((option) => ({ ...option, ...(parseAspectRatio(option.value) ?? { width: 0, height: 0 }) }));
    const ratioList = visibleOptions(ratioEntries.filter((option) => option.enabled), selectedRatio)
        .map((option) => ({ ...option, ...(parseAspectRatio(option.value) ?? { width: 0, height: 0 }) }));
    const countList = visibleOptions(options.imageCount.filter((option) => option.enabled), String(count))
        .map((option) => option.label === option.value ? { ...option, label: `${option.value} 张` } : option)
        .sort((a, b) => Number(a.value) - Number(b.value));
    const applySize = (scale: string, ratio: string) => onConfigChange("size", computeMediaSize(scale, ratio));
    const selectScale = (scale: string) => applySize(scale, fixedRatio ?? (selectedRatio === "auto" ? "1:1" : selectedRatio));
    const selectRatio = (ratio: string) => applySize(selectedScale, ratio);
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 1024));
        const width = key === "width" ? next : dimensions.width;
        const height = key === "height" ? next : dimensions.height;
        onConfigChange("size", `${alignDimension(width, snapDimensionToStep)}x${alignDimension(height, snapDimensionToStep)}`);
    };

    return (
        <div
            className={`@container ${className}`}
            style={{ color: theme.node.text }}
            onMouseDown={(event) => {
                event.stopPropagation();
                if (event.target instanceof HTMLInputElement) return;
                if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
            }}
        >
            {showTitle ? <div className="text-lg font-semibold">图像设置</div> : null}
            <div className="space-y-2.5">
                <SettingTitle color={theme.node.muted}>质量</SettingTitle>
                <div className="grid grid-cols-3 gap-2.5 @min-[22rem]:grid-cols-6">
                    {qualityList.map((item) => (
                        <OptionPill key={item.value} selected={quality === item.value} theme={theme} onClick={() => onConfigChange("quality", item.value)}>
                            {item.label}
                        </OptionPill>
                    ))}
                </div>
            </div>
            {fixedRatio ? null : <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                        <SettingTitle color={theme.node.muted}>尺寸</SettingTitle>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                16 倍数对齐
                            </span>
                            <span title="输入完成后自动向上补成 16 的倍数" onMouseDown={(event) => event.stopPropagation()}>
                                <ParameterSwitch label="16 倍数对齐" checked={snapDimensionToStep} onChange={setSnapDimensionToStep} />
                            </span>
                        </div>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={selectedRatio === "auto"} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("width", value)} />
                        <ArrowLeftRight className="size-4 opacity-45" aria-hidden="true" />
                        <DimensionInput prefix="H" value={dimensions.height} disabled={selectedRatio === "auto"} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("height", value)} />
                    </div>
                </div>}
            <div className="space-y-2.5">
                <SettingTitle color={theme.node.muted}>分辨率</SettingTitle>
                <div className="grid grid-cols-4 gap-2.5">
                    {scaleList.map((item) => (
                        <OptionPill key={item.value} selected={selectedScale === item.value} theme={theme} onClick={() => selectScale(item.value)}>
                            {item.label}
                        </OptionPill>
                    ))}
                </div>
            </div>
            {fixedRatio ? null : <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>宽高比</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5 @min-[22rem]:grid-cols-5">
                        {ratioList.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: selectedRatio === item.value ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => selectRatio(item.value)}
                            >
                                <AspectIcon width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.value === "auto" ? "自动" : item.value}</span>
                            </button>
                        ))}
                    </div>
                </div>}
            <div className="flex items-center gap-3">
                <div className="shrink-0"><SettingTitle color={theme.node.muted}>透明背景</SettingTitle></div>
                <span className="min-w-0 flex-1 text-xs @min-[22rem]:truncate" style={{ color: theme.node.muted, opacity: 0.75 }}>
                    开启后生成无背景的透明图像（仅部分模型可用）
                </span>
                <span className="shrink-0" onMouseDown={(event) => event.stopPropagation()}>
                    <ParameterSwitch label="透明背景" checked={transparentBackground} onChange={(checked) => onConfigChange("background", checked ? "transparent" : "")} />
                </span>
            </div>
            {fixedRatio ? null : <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>生成张数</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5 @min-[22rem]:grid-cols-6">
                        {countList.map((item) => (
                            <OptionPill key={item.value} selected={count === Number(item.value)} theme={theme} onClick={() => onConfigChange("count", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </div>}
        </div>
    );
}

function ParameterSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return <Switch size="sm" className="image-parameter-switch" aria-label={label} checked={checked} onCheckedChange={onChange}
        onKeyDown={(event) => {
            if (event.key === "ArrowLeft" && checked) onChange(false);
            if (event.key === "ArrowRight" && !checked) onChange(true);
        }} />;
}

export function imageQualityLabel(value: string) {
    return imageQualityOptions.some((item) => item.value === value) ? generationLevelLabels[value] : value;
}

export function imageSizeLabel(size: string) {
    const scale = inferMediaScale(size);
    const ratio = inferMediaRatio(size);
    if (ratio === "auto" || size === "auto") return "自动";
    if (scale === "auto") return ratio;
    return `${scale} · ${ratio}`;
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="h-9 cursor-pointer whitespace-nowrap rounded-full border px-2 text-sm transition hover:opacity-80"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function DimensionInput({ prefix, value, disabled, theme, alignToStep, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; alignToStep: boolean; onChange: (value: number | null) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = alignDimension(Math.max(1, Math.floor(Number(input.value) || value || 1024)), alignToStep);
        input.value = String(next);
        onChange(next);
    };

    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input
                type="number"
                min={1}
                disabled={disabled}
                className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value || ""}
                key={`${prefix}-${value}`}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function AspectIcon({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const ratio = width / height;
    const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
    const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
    return (
        <span className="grid h-7 w-9 place-items-center">
            <span className="border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
        </span>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}

function alignDimension(value: number, enabled: boolean) {
    return enabled ? Math.ceil(value / DIMENSION_STEP) * DIMENSION_STEP : value;
}
