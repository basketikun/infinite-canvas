import type { AiConfig } from "@workbench/stores/use-config-store";

/** 创作页运行时可临时调整的生成参数；偏好设置中的值作为每次打开页面时的默认值。 */
export const runtimeOptionKeys = [
    "quality", "size", "count", "background",
    "vquality", "videoSeconds", "videoGenerateAudio", "videoWatermark", "videoMode",
    "audioVoice", "audioFormat", "audioSpeed",
] as const;

export type RuntimeOptionKey = (typeof runtimeOptionKeys)[number];

export function isRuntimeOptionKey(key: PropertyKey): key is RuntimeOptionKey {
    return typeof key === "string" && (runtimeOptionKeys as readonly string[]).includes(key);
}

export type RuntimeOptions = Partial<Pick<AiConfig, RuntimeOptionKey>>;
