import { generationLevelLabels } from "@workbench/constant/labels";
import { audioFormatOptions, audioSpeedLabel, audioVoiceOptions } from "./audio-generation";
import { mediaRatioOptions, mediaScaleOptions, videoRatioOptions } from "./media-size";

/** 偏好设置中可增删的生成可选项，运行时面板只展示启用的项。 */
export type GenerationOptionCategory =
    | "quality"
    | "imageScale"
    | "imageRatio"
    | "imageCount"
    | "videoResolution"
    | "videoRatio"
    | "audioVoice"
    | "audioFormat"
    | "audioSpeed";

export type GenerationOption = { value: string; label: string; enabled: boolean };

export type GenerationOptions = Record<GenerationOptionCategory, GenerationOption[]>;

const qualityValues = ["auto", "low", "medium", "high", "xhigh", "max"];
const imageCountValues = ["1", "2", "3", "4", "5", "6"];
const videoResolutionValues = ["480", "720", "1080"];
const audioSpeedValues = ["0.75", "1", "1.25", "1.5"];

const ratioLabel = (value: string) => value === "auto" ? "自动" : value;

export const generationOptionCatalog: Record<GenerationOptionCategory, { label: string; options: { value: string; label: string }[] }> = {
    quality: {
        label: "图片质量",
        options: qualityValues.map((value) => ({ value, label: generationLevelLabels[value] ?? value })),
    },
    imageScale: {
        label: "图片分辨率",
        options: mediaScaleOptions.map((value) => ({ value, label: value === "auto" ? "自动" : value.toUpperCase() })),
    },
    imageRatio: {
        label: "图片宽高比",
        options: mediaRatioOptions.map((item) => ({ value: item.value, label: ratioLabel(item.value) })),
    },
    imageCount: {
        label: "图片张数",
        options: imageCountValues.map((value) => ({ value, label: `${value} 张` })),
    },
    videoResolution: {
        label: "视频清晰度",
        options: videoResolutionValues.map((value) => ({ value, label: `${value}p` })),
    },
    videoRatio: {
        label: "视频比例",
        options: videoRatioOptions.map((item) => ({ value: item.value, label: ratioLabel(item.value) })),
    },
    audioVoice: {
        label: "音频声音",
        options: audioVoiceOptions,
    },
    audioFormat: {
        label: "音频格式",
        options: audioFormatOptions,
    },
    audioSpeed: {
        label: "音频语速",
        options: audioSpeedValues.map((value) => ({ value, label: audioSpeedLabel(value) })),
    },
};

export const defaultGenerationOptions: GenerationOptions = Object.fromEntries(
    Object.entries(generationOptionCatalog).map(([category, item]) => [category, item.options.map((option) => ({ ...option, enabled: true }))]),
) as GenerationOptions;

function optionEntry(value: unknown): GenerationOption | null {
    if (!value || typeof value !== "object") return null;
    const entry = value as Partial<GenerationOption>;
    if (typeof entry.value !== "string" || !entry.value.trim()) return null;
    return { value: entry.value.trim(), label: typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : entry.value.trim(), enabled: entry.enabled !== false };
}

export function normalizeGenerationOptions(value?: Partial<GenerationOptions> | null): GenerationOptions {
    return Object.fromEntries(
        Object.entries(generationOptionCatalog).map(([category, item]) => {
            const key = category as GenerationOptionCategory;
            const saved = Array.isArray(value?.[key]) ? value[key]!.map(optionEntry).filter((entry): entry is GenerationOption => Boolean(entry)) : [];
            const byValue = new Map(saved.map((entry) => [entry.value, entry]));
            const options: GenerationOption[] = item.options.map((option) => {
                const current = byValue.get(option.value);
                return { value: option.value, label: current?.label || option.label, enabled: current?.enabled !== false };
            });
            for (const entry of saved) if (!options.some((option) => option.value === entry.value)) options.push(entry);
            if (!options.some((option) => option.enabled)) options[0] = { ...options[0], enabled: true };
            return [category, options];
        }),
    ) as GenerationOptions;
}

/** 保证当前值即使被移除也仍能在面板里显示和识别。 */
export function visibleOptions<T extends { value: string; label: string }>(options: readonly T[], current: string) {
    const list = [...options];
    if (current && !list.some((option) => option.value === current)) list.unshift({ value: current, label: current } as unknown as T);
    return list;
}
