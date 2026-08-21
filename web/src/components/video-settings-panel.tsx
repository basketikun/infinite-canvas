import { type ReactNode } from "react";
import { Switch } from "antd";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { boolConfig, comfyH3TemplateKind, resolveModelForCapability, resolveModelWorkflow, type AiConfig, type ComfyH3TemplateKind } from "@/stores/use-config-store";

const resolutionOptions = [
    { value: "720", label: "720p" },
    { value: "480", label: "480p" },
];

const sizeOptions = [
    { value: "1280x720", labelKey: "landscape", width: 1280, height: 720 },
    { value: "720x1280", labelKey: "portrait", width: 720, height: 1280 },
    { value: "1024x1024", labelKey: "square", width: 1024, height: 1024 },
    { value: "1792x1024", labelKey: "widescreen", width: 1792, height: 1024 },
    { value: "1024x1792", labelKey: "tall", width: 1024, height: 1792 },
    { value: "auto", labelKey: "auto", width: 0, height: 0 },
];

const ratioOptions = [
    { value: "16:9", labelKey: "landscape", w: 16, h: 9 },
    { value: "9:16", labelKey: "portrait", w: 9, h: 16 },
    { value: "1:1", labelKey: "square", w: 1, h: 1 },
    { value: "4:3", labelKey: "standardLandscape", w: 4, h: 3 },
    { value: "3:4", labelKey: "standardPortrait", w: 3, h: 4 },
    { value: "21:9", labelKey: "cinematic", w: 21, h: 9 },
];

const secondOptions = [6, 10, 12, 16, 20];
const h3SecondOptions = [6, 10, 12, 15];
const DEFAULT_H3_RESOLUTION_MULTIPLE = 32;

function roundHalfToEven(value: number) {
    const floor = Math.floor(value);
    const fraction = value - floor;
    if (Math.abs(fraction - 0.5) < Number.EPSILON * Math.max(1, Math.abs(value))) return floor % 2 === 0 ? floor : floor + 1;
    return Math.round(value);
}

/** Mirror ComfyUI ResolutionSelector: megapixels use 1024² and both edges snap to the workflow's multiple. */
export function computeVideoDimensions(ratio: string, resolution: string, multiple = DEFAULT_H3_RESOLUTION_MULTIPLE) {
    const [rw, rh] = ratio.split(":").map(Number);
    if (!rw || !rh) return { width: 1280, height: 720 };
    const shortSide = Math.max(1, Number(resolution) || 720);
    const nominalWidth = rw >= rh ? Math.round((shortSide * rw) / rh) : shortSide;
    const nominalHeight = rw >= rh ? shortSide : Math.round((shortSide * rh) / rw);
    const megapixels = Math.max(0.1, Math.min(16, Math.round(((nominalWidth * nominalHeight) / (1024 * 1024)) * 100) / 100));
    const scale = Math.sqrt((megapixels * 1024 * 1024) / (rw * rh));
    const step = Math.max(1, Math.floor(multiple) || DEFAULT_H3_RESOLUTION_MULTIPLE);
    const width = Math.max(step, roundHalfToEven((rw * scale) / step) * step);
    const height = Math.max(step, roundHalfToEven((rh * scale) / step) * step);
    return { width, height };
}

function h3ResolutionMultiple(config: AiConfig, model: string, template: ComfyH3TemplateKind) {
    try {
        const workflow = resolveModelWorkflow(config, model);
        if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) return DEFAULT_H3_RESOLUTION_MULTIPLE;
        const nodes = workflow as Record<string, unknown>;
        const targetClass = template === "ref2va" ? "MiniMaxH3ReferenceToVideo" : "MiniMaxH3ImageToVideo";
        const target = Object.values(nodes).find((value) => value && typeof value === "object" && (value as { class_type?: unknown }).class_type === targetClass) as { inputs?: Record<string, unknown> } | undefined;
        const selectorId = [target?.inputs?.width, target?.inputs?.height]
            .filter((value): value is unknown[] => Array.isArray(value))
            .map((value) => String(value[0]))
            .find((id) => (nodes[id] as { class_type?: unknown } | undefined)?.class_type === "ResolutionSelector");
        const node = (selectorId ? nodes[selectorId] : Object.values(nodes).find((value) => value && typeof value === "object" && (value as { class_type?: unknown }).class_type === "ResolutionSelector")) as { inputs?: { multiple?: unknown } } | undefined;
        const multiple = Number(node?.inputs?.multiple);
        return Number.isFinite(multiple) && multiple > 0 ? Math.floor(multiple) : DEFAULT_H3_RESOLUTION_MULTIPLE;
    } catch {
        return DEFAULT_H3_RESOLUTION_MULTIPLE;
    }
}

/** Map any stored size value ("1280x720" or "auto") to the closest ratio option value. */
export function ratioFromSize(size: string) {
    const match = /^(\d+)x(\d+)$/.exec(size || "");
    if (!match) return "16:9";
    const ratioValue = Number(match[1]) / Number(match[2]);
    let best = ratioOptions[0].value;
    let bestDiff = Infinity;
    for (const item of ratioOptions) {
        const diff = Math.abs(Math.log(ratioValue / (item.w / item.h)));
        if (diff < bestDiff) {
            bestDiff = diff;
            best = item.value;
        }
    }
    return best;
}

export const videoResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSizeOptions = sizeOptions.map((item) => ({
    value: item.value,
    get label() {
        return i18n.t(`settingsPanels.video.sizes.${item.labelKey}`);
    },
}));
export const videoSecondOptions = secondOptions.map((value) => String(value));

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoRandomSeed" | "videoSeed", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: VideoSettingsPanelProps) {
    const { t } = useTranslation();

    const storedSeconds = config.videoSeconds || "6";
    const size = normalizeVideoSizeValue(config.size);
    const officialDimensions = readSizeDimensions(size);
    const resolution = normalizeVideoResolutionValue(config.vquality);
    const videoModel = resolveModelForCapability(config, config.model, "video");
    const h3Template = comfyH3TemplateKind(config, videoModel);
    const isComfyH3Template = Boolean(h3Template);
    const seconds = isComfyH3Template ? String(Math.max(1, Math.min(15, Math.round(Number(storedSeconds) || 6)))) : storedSeconds;
    const displayedSecondOptions = isComfyH3Template ? h3SecondOptions : secondOptions;
    const resolutionMultiple = h3Template ? h3ResolutionMultiple(config, videoModel, h3Template) : DEFAULT_H3_RESOLUTION_MULTIPLE;
    const ratio = ratioFromSize(config.size);
    const h3Dimensions = computeVideoDimensions(ratio, resolution, resolutionMultiple);
    const randomSeed = boolConfig(config.videoRandomSeed, true);
    const seed = config.videoSeed || "";
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || officialDimensions[key] || 720));
        onConfigChange("size", `${key === "width" ? next : officialDimensions.width}x${key === "height" ? next : officialDimensions.height}`);
    };
    const applyRatio = (value: string) => {
        const next = computeVideoDimensions(value, resolution, resolutionMultiple);
        onConfigChange("size", `${next.width}x${next.height}`);
    };
    const applyResolution = (value: string) => {
        const next = computeVideoDimensions(ratio, normalizeVideoResolutionValue(value), resolutionMultiple);
        onConfigChange("size", `${next.width}x${next.height}`);
        onConfigChange("vquality", value);
    };
    const setRandomSeed = (checked: boolean) => {
        if (!checked && !seed) onConfigChange("videoSeed", String(Math.floor(Math.random() * 1e15)));
        onConfigChange("videoRandomSeed", String(checked));
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}
                <SettingGroup title={t("settingsPanels.video.quality")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {resolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => (isComfyH3Template ? applyResolution(item.value) : onConfigChange("vquality", item.value))}>
                                {item.label}
                            </OptionPill>
                        ))}
                        <ResolutionInput value={resolution} theme={theme} onChange={(value) => (isComfyH3Template ? applyResolution(value) : onConfigChange("vquality", value))} />
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.size")} color={theme.node.muted}>
                    {isComfyH3Template ? (
                        <>
                            <div className="flex h-9 items-center justify-center gap-2 rounded-xl border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                                <span className="tabular-nums">{h3Dimensions.width}</span>
                                <span className="opacity-45">×</span>
                                <span className="tabular-nums">{h3Dimensions.height}</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2.5">
                                {ratioOptions.map((item) => (
                                    <button
                                        key={item.value}
                                        type="button"
                                        className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80"
                                        style={{ borderColor: ratio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onClick={() => applyRatio(item.value)}
                                    >
                                        <SizePreview width={item.w} height={item.h} color={theme.node.text} />
                                        <span>{t(`settingsPanels.video.ratios.${item.labelKey}`)}</span>
                                        <span className="text-[11px] leading-none opacity-55">{item.value}</span>
                                    </button>
                                ))}
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                                <DimensionInput prefix="W" value={officialDimensions.width} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("width", value)} />
                                <span className="text-lg opacity-45">↔</span>
                                <DimensionInput prefix="H" value={officialDimensions.height} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("height", value)} />
                            </div>
                            <div className="grid grid-cols-3 gap-2.5">
                                {sizeOptions.map((item) => (
                                    <button
                                        key={item.value}
                                        type="button"
                                        className="flex h-[78px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                        style={{ borderColor: size === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onClick={() => onConfigChange("size", item.value)}
                                    >
                                        <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                                        <span>{t(`settingsPanels.video.sizes.${item.labelKey}`)}</span>
                                        {item.value === "auto" ? null : <span className="text-[11px] leading-none opacity-55">{item.value}</span>}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.seconds")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {displayedSecondOptions.map((value) => (
                            <OptionPill key={value} selected={seconds === String(value)} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                {value}s
                            </OptionPill>
                        ))}
                        <NumberInput value={seconds} min={1} max={isComfyH3Template ? 15 : 20} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} />
                    </div>
                </SettingGroup>
                {isComfyH3Template ? (
                    <SettingGroup title={t("settingsPanels.video.seed")} color={theme.node.muted}>
                        <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                            <SwitchRow label={t("settingsPanels.video.randomSeed")} checked={randomSeed} theme={theme} onChange={setRandomSeed} />
                            {randomSeed ? null : <NumberInput value={seed} min={0} max={999999999999999} theme={theme} onChange={(value) => onConfigChange("videoSeed", String(Math.max(0, Math.floor(Number(value) || 0))))} />}
                        </div>
                    </SettingGroup>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    return `${normalizeVideoResolutionValue(value)}p`;
}

export function videoSizeLabel(value: string) {
    if (value === "adaptive" || value === "auto") return i18n.t("settingsPanels.video.adaptive");
    const size = normalizeVideoSizeValue(value);
    const option = sizeOptions.find((item) => item.value === size);
    return option ? i18n.t(`settingsPanels.video.sizes.${option.labelKey}`) : size;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return i18n.t("settingsPanels.video.smart");
    return `${value || "6"}s`;
}

export function normalizeVideoSizeValue(value: string) {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    return ["9:16", "2:3", "3:4"].includes(value) ? "720x1280" : "1280x720";
}

export function normalizeVideoResolutionValue(value: string) {
    if (value === "480p" || value === "low") return "480";
    if (value === "720p" || value === "auto" || value === "high" || value === "medium") return "720";
    return value.replace(/p$/i, "") || "720";
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            disabled={disabled}
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
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
            <input
                type="number"
                min={1}
                className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onMouseDown={(event) => event.stopPropagation()}
            />
            <span className="grid w-7 place-items-center pr-1" style={{ color: theme.node.muted }}>
                p
            </span>
        </label>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
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
                value={value || ""}
                onChange={(event) => onChange(Number(event.target.value) || null)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function NumberInput({ value, min, max, theme, onChange }: { value: string; min: number; max: number; theme: CanvasTheme; onChange: (value: string) => void }) {
    return (
        <input
            type="number"
            min={min}
            max={max}
            className="h-9 w-full rounded-full border bg-transparent px-3 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onMouseDown={(event) => event.stopPropagation()}
        />
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

function readSizeDimensions(size: string) {
    if (size === "auto") return { width: 0, height: 0 };
    const match = size.match(/^(\d+)x(\d+)$/);
    return { width: Number(match?.[1]) || 1280, height: Number(match?.[2]) || 720 };
}

function SwitchRow({ label, checked, theme, onChange }: { label: string; checked: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-8 items-center justify-between gap-3">
            <span className="text-sm" style={{ color: theme.node.text }}>
                {label}
            </span>
            <span onMouseDown={(event) => event.stopPropagation()}>
                <Switch size="small" checked={checked} onChange={onChange} />
            </span>
        </div>
    );
}
