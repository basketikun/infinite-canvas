import { type ReactNode, useState } from "react";
import { ConfigProvider, Switch } from "antd";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { resolveAspectImageSize } from "@/services/api/image";
import type { AiConfig } from "@/stores/use-config-store";

const qualityOptions = [
    { value: "auto", labelKey: "auto" },
    { value: "high", labelKey: "high" },
    { value: "medium", labelKey: "medium" },
    { value: "low", labelKey: "low" },
];
const DIMENSION_STEP = 16;

const aspectOptions = [
    { value: "1:1", label: "1:1", width: 1024, height: 1024, icon: "square" },
    { value: "3:2", label: "3:2", width: 1536, height: 1024, icon: "landscape" },
    { value: "2:3", label: "2:3", width: 1024, height: 1536, icon: "portrait" },
    { value: "4:3", label: "4:3", width: 1360, height: 1024, icon: "landscape" },
    { value: "3:4", label: "3:4", width: 1024, height: 1360, icon: "portrait" },
    { value: "16:9", label: "16:9", width: 1824, height: 1024, icon: "landscape" },
    { value: "9:16", label: "9:16", width: 1024, height: 1824, icon: "portrait" },
    { value: "auto", label: "auto", width: 0, height: 0, icon: "auto" },
];

// 分辨率:长边像素。与比例自由组合,算出显式像素尺寸(质量保持独立)。
const resolutionOptions = [
    { value: "auto", label: "auto" },
    { value: "1k", label: "1K", longEdge: 1024 },
    { value: "2k", label: "2K", longEdge: 2048 },
    { value: "4k", label: "4K", longEdge: 3840 },
];
const RESOLUTION_ORDER = ["4k", "2k", "1k"];

function matchAspect(activeSize: string, options: typeof aspectOptions) {
    if (!activeSize) return null;
    if (activeSize === "auto") return options.find((item) => item.value === "auto") || null;
    const exact = options.find((item) => item.value === activeSize);
    if (exact) return exact;
    const dims = activeSize.match(/^(\d+)x(\d+)$/);
    if (!dims) return null;
    const target = Number(dims[1]) / Number(dims[2]);
    let best: (typeof options)[number] | null = null;
    let bestDiff = Infinity;
    for (const item of options) {
        if (item.width <= 0 || item.height <= 0) continue;
        const diff = Math.abs(item.width / item.height - target);
        if (diff < bestDiff) {
            bestDiff = diff;
            best = item;
        }
    }
    return best;
}

function matchResolution(activeSize: string): string {
    if (!activeSize || activeSize === "auto") return "auto";
    const dims = activeSize.match(/^(\d+)x(\d+)$/);
    if (!dims) return "auto";
    const longEdge = Math.max(Number(dims[1]), Number(dims[2]));
    if (longEdge <= 1536) return "1k";
    if (longEdge <= 2944) return "2k";
    return "4k";
}

export const imageQualityOptions = qualityOptions.map((item) => ({ value: item.value, get label() { return i18n.t(`settingsPanels.common.${item.labelKey}`); } }));
export const imageAspectOptions = aspectOptions.map((item) => ({ value: item.value, label: item.label }));

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "size" | "count" | "background", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
};

export function ImageSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", maxCount = 15, quickCount = 10 }: ImageSettingsPanelProps) {
    const { t } = useTranslation();
    const [snapDimensionToStep, setSnapDimensionToStep] = useState(true);
    const quality = config.quality || "auto";
    const count = Math.max(1, Math.min(maxCount, Math.floor(Math.abs(Number(config.count)) || 1)));
    const activeSize = config.size || "auto";
    const transparentBackground = config.background === "transparent";
    const selectedAspect = matchAspect(activeSize, aspectOptions);
    const selectedResolution = matchResolution(activeSize);
    const dimensions = readSizeDimensions(activeSize, selectedAspect || aspectOptions[0]);
    const selectAspect = (value: string) => {
        if (value === "auto") {
            onConfigChange("size", "auto");
            return;
        }
        const currentRes = resolutionOptions.find((item) => item.value === selectedResolution);
        if (currentRes?.longEdge) {
            // 保持当前分辨率优先;当前分辨率下该比例不可行时,依次降级到 2k / 1k
            const startIndex = RESOLUTION_ORDER.indexOf(currentRes.value);
            for (let i = startIndex; i < RESOLUTION_ORDER.length; i++) {
                const target = resolutionOptions.find((item) => item.value === RESOLUTION_ORDER[i]);
                if (!target?.longEdge) continue;
                const size = resolveAspectImageSize(value, target.longEdge);
                if (size) {
                    onConfigChange("size", size);
                    return;
                }
            }
            onConfigChange("size", value);
            return;
        }
        onConfigChange("size", value);
    };
    const selectResolution = (value: string) => {
        if (value === "auto") {
            onConfigChange("size", selectedAspect && selectedAspect.value !== "auto" ? selectedAspect.value : "auto");
            return;
        }
        const res = resolutionOptions.find((item) => item.value === value);
        if (!res?.longEdge) return;
        const aspect = selectedAspect && selectedAspect.value !== "auto" ? selectedAspect.value : "1:1";
        const size = resolveAspectImageSize(aspect, res.longEdge);
        if (size) onConfigChange("size", size);
    };
    const resolutionDisabled = (value: string) => {
        const res = resolutionOptions.find((item) => item.value === value);
        if (!res?.longEdge) return false;
        const aspect = selectedAspect && selectedAspect.value !== "auto" ? selectedAspect.value : null;
        if (!aspect) return true;
        return resolveAspectImageSize(aspect, res.longEdge) === null;
    };
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 1024));
        const width = key === "width" ? next : dimensions.width;
        const height = key === "height" ? next : dimensions.height;
        onConfigChange("size", `${alignDimension(width, snapDimensionToStep)}x${alignDimension(height, snapDimensionToStep)}`);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                className={className}
                style={{ color: theme.node.text }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.target instanceof HTMLInputElement) return;
                    if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
                }}
            >
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.image.title")}</div> : null}
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.quality")}</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {qualityOptions.map((item) => (
                            <OptionPill key={item.value} selected={quality === item.value} theme={theme} onClick={() => onConfigChange("quality", item.value)}>
                                {t(`settingsPanels.common.${item.labelKey}`)}
                            </OptionPill>
                        ))}
                    </div>
                </div>
                <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                        <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.size")}</SettingTitle>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                {t("settingsPanels.image.align16")}
                            </span>
                            <span title={t("settingsPanels.image.align16Hint")} onMouseDown={(event) => event.stopPropagation()}>
                                <Switch size="small" checked={snapDimensionToStep} onChange={setSnapDimensionToStep} />
                            </span>
                        </div>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={activeSize === "auto"} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("width", value)} />
                        <span className="text-lg opacity-45">↔</span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={activeSize === "auto"} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("height", value)} />
                    </div>
                </div>
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.aspectRatio")}</SettingTitle>
                    <div className="grid grid-cols-5 gap-2">
                        {aspectOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: selectedAspect?.value === item.value ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => selectAspect(item.value)}
                            >
                                <AspectIcon type={item.icon} width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.resolution")}</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {resolutionOptions.map((item) => (
                            <OptionPill
                                key={item.value}
                                selected={selectedResolution === item.value}
                                disabled={resolutionDisabled(item.value)}
                                theme={theme}
                                onClick={() => selectResolution(item.value)}
                            >
                                {item.value === "auto" ? t("settingsPanels.common.auto") : item.label}
                            </OptionPill>
                        ))}
                    </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                        <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.transparent")}</SettingTitle>
                        <div className="text-xs" style={{ color: theme.node.muted, opacity: 0.75 }}>
                            {t("settingsPanels.image.transparentHint")}
                        </div>
                    </div>
                    <span onMouseDown={(event) => event.stopPropagation()}>
                        <Switch size="small" checked={transparentBackground} onChange={(checked) => onConfigChange("background", checked ? "transparent" : "")} />
                    </span>
                </div>
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.count")}</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {Array.from({ length: quickCount }, (_, index) => index + 1).map((value) => (
                            <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                                {t("settingsPanels.image.images", { count: value })}
                            </OptionPill>
                        ))}
                        <CountInput value={count} max={maxCount} theme={theme} onChange={(value) => onConfigChange("count", String(value || 1))} />
                    </div>
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: { Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text } },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageQualityLabel(value: string) {
    return (["auto", "high", "medium", "low"].includes(value) ? i18n.t(`settingsPanels.common.${value}`) : value);
}

export function imageSizeLabel(size: string) {
    if (/^\d+x\d+$/.test(size)) {
        const aspect = matchAspect(size, aspectOptions);
        const resLabel = resolutionOptions.find((item) => item.value === matchResolution(size))?.label;
        return aspect && aspect.value !== "auto" && resLabel ? `${aspect.label} ${resLabel}` : size;
    }
    return aspectOptions.find((item) => item.value === size)?.label || size;
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            disabled={disabled}
            className={`h-9 rounded-full border px-2 text-sm transition ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:opacity-80"}`}
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

function CountInput({ value, max, theme, onChange }: { value: number; max: number; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="col-span-2 flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input
                type="number"
                min={1}
                max={max}
                className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                value={value || ""}
                onChange={(event) => onChange(Number(event.target.value) || null)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function AspectIcon({ type, width, height, color }: { type: string; width: number; height: number; color: string }) {
    if (type === "auto") return null;
    const ratio = width / Math.max(1, height);
    const boxWidth = ratio >= 1 ? 20 : Math.max(8, 20 * ratio);
    const boxHeight = ratio >= 1 ? Math.max(8, 20 / ratio) : 20;
    return (
        <span className="grid h-6 w-8 place-items-center">
            <span className="rounded-[3px] border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
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

function readSizeDimensions(size: string, fallback: { width: number; height: number }) {
    const match = size?.match(/^(\d+)x(\d+)$/);
    return {
        width: match ? Number(match[1]) : fallback.width,
        height: match ? Number(match[2]) : fallback.height,
    };
}

function alignDimension(value: number, enabled: boolean) {
    return enabled ? Math.ceil(value / DIMENSION_STEP) * DIMENSION_STEP : value;
}
