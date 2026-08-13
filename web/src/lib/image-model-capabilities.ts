export const UNSUPPORTED_IMAGE_PARAMETER_MESSAGE = "当前模型不支持该尺寸或参数，请切换模型或选择支持的尺寸。";
export const GPT_IMAGE_ENTERPRISE_SIZE_TIP = "当前模型不支持该尺寸，请切换到 gpt-image-2-enterprise、gpt-image-2-4K、grok-imagine-image，或选择 1024x1024、1024x1536、1536x1024、auto。";
export const GPT_IMAGE_CONFIG_SIZE_TIP = "当前模型配置不支持该尺寸，请选择可用尺寸或切换模型。";
export const GPT_IMAGE_RESTRICTED_SIZES = ["1024x1024", "1024x1536", "1536x1024", "auto"] as const;
export const GROK_IMAGE_RESOLUTIONS = ["1k", "2k"] as const;
export const GROK_IMAGE_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;

export type ImageModelCapability = {
    sizes?: string[];
    resolutions?: string[];
    aspectRatios?: string[];
};

export type ImageParameterConfig = {
    size?: string;
    imageResolution?: string;
    imageAspectRatio?: string;
    imageModelCapabilities?: Record<string, ImageModelCapability>;
};

const GPT_IMAGE_RESTRICTED_MODELS: Record<string, true> = { "gpt-image-1-enterprise": true, "gpt-image-1.5-enterprise": true };
const GPT_IMAGE_2_MODELS: Record<string, true> = { "gpt-image-2-enterprise": true, "gpt-image-2-4k": true };
const GPT_IMAGE_RESTRICTED_SIZE_SET: Record<string, true> = { "1024x1024": true, "1024x1536": true, "1536x1024": true, auto: true };
const GPT_IMAGE_2_DEFAULT_SIZE_SET: Record<string, true> = { "4k": true, "3840x2160": true, "1024x1024": true, "1024x1536": true, "1536x1024": true, auto: true };
const GROK_IMAGE_RESOLUTION_SET: Record<string, true> = { "1k": true, "2k": true };
const GROK_IMAGE_ASPECT_RATIO_SET: Record<string, true> = { "1:1": true, "16:9": true, "9:16": true, "4:3": true, "3:4": true, "3:2": true, "2:3": true };

export function isGptImageRestrictedModel(model: string) {
    return Boolean(GPT_IMAGE_RESTRICTED_MODELS[normalizeModelName(model)]);
}

export function isGptImage2Model(model: string) {
    return Boolean(GPT_IMAGE_2_MODELS[normalizeModelName(model)]);
}

export function isGrokImageModel(model: string) {
    return normalizeModelName(model) === "grok-imagine-image";
}
export function cleanImageParametersForModel<T extends ImageParameterConfig>(config: T, model: string): T {
    if (isGrokImageModel(model)) return { ...config, size: "", imageResolution: normalizeGrokImageResolution(config.imageResolution), imageAspectRatio: normalizeGrokImageAspectRatio(config.imageAspectRatio) } as T;
    return { ...config, size: config.size || "auto", imageResolution: "", imageAspectRatio: "" } as T;
}

export function imageModelParameterPatch(model: string, config: ImageParameterConfig = {}) {
    const cleaned = cleanImageParametersForModel(config, model);
    return { size: cleaned.size, imageResolution: cleaned.imageResolution, imageAspectRatio: cleaned.imageAspectRatio };
}

export function getImageParameterIssue(config: ImageParameterConfig, model: string) {
    if (isGrokImageModel(model) && (!isImageResolutionAllowed(model, config.imageResolution || "", config) || !isImageAspectRatioAllowed(model, config.imageAspectRatio || "", config))) return "当前模型需要选择支持的分辨率和画幅比例。";
    if (isGptImageRestrictedModel(model) && !isImageSizeAllowed(model, config.size || "", config)) return "当前模型不支持当前尺寸，请先切换尺寸或模型。";
    if (!isGrokImageModel(model) && !isImageSizeAllowed(model, config.size || "", config)) return GPT_IMAGE_CONFIG_SIZE_TIP;
    return "";
}

export function isImageSizeAllowed(model: string, size: string, config?: ImageParameterConfig) {
    const normalized = normalizeSizeValue(size || "auto");
    const capability = imageModelCapability(config, model);
    if (isGptImageRestrictedModel(model)) return Boolean(GPT_IMAGE_RESTRICTED_SIZE_SET[normalized]) && capabilityAllows(capability?.sizes, normalized);
    if (isGptImage2Model(model)) return Boolean(GPT_IMAGE_2_DEFAULT_SIZE_SET[normalized]) && capabilityAllows(capability?.sizes, normalized);
    if (capability?.sizes?.length) return capabilityAllows(capability.sizes, normalized);
    return true;
}

export function isImageResolutionAllowed(model: string, value: string, config?: ImageParameterConfig) {
    if (!isGrokImageModel(model)) return true;
    const normalized = String(value || "").trim().toLowerCase();
    return Boolean(GROK_IMAGE_RESOLUTION_SET[normalized] && capabilityAllows(imageModelCapability(config, model)?.resolutions, normalized));
}

export function isImageAspectRatioAllowed(model: string, value: string, config?: ImageParameterConfig) {
    if (!isGrokImageModel(model)) return true;
    const normalized = String(value || "").trim().toLowerCase();
    return Boolean(GROK_IMAGE_ASPECT_RATIO_SET[normalized] && capabilityAllows(imageModelCapability(config, model)?.aspectRatios, normalized));
}

export function isGptImageEnterpriseSize(size: string) {
    return Boolean(GPT_IMAGE_RESTRICTED_SIZE_SET[normalizeSizeValue(size)]);
}

export function normalizeGptImageEnterpriseSize(size: string) {
    const normalized = normalizeSizeValue(size);
    return GPT_IMAGE_RESTRICTED_SIZE_SET[normalized] ? normalized : "";
}

export function normalizeGrokImageResolution(value: string | undefined) {
    const normalized = String(value || "").trim().toLowerCase();
    return GROK_IMAGE_RESOLUTION_SET[normalized] ? normalized : "1k";
}

export function normalizeGrokImageAspectRatio(value: string | undefined) {
    const normalized = String(value || "").trim().toLowerCase();
    return GROK_IMAGE_ASPECT_RATIO_SET[normalized] ? normalized : "1:1";
}

export function isGrokImageResolution(value: string) {
    return Boolean(GROK_IMAGE_RESOLUTION_SET[String(value || "").trim().toLowerCase()]);
}

export function isGrokImageAspectRatio(value: string) {
    return Boolean(GROK_IMAGE_ASPECT_RATIO_SET[String(value || "").trim().toLowerCase()]);
}

export function imageResolutionLabel(value: string) {
    return normalizeGrokImageResolution(value).toUpperCase();
}

export function imageAspectRatioLabel(value: string) {
    return normalizeGrokImageAspectRatio(value);
}

function grokParametersAllowed(config: ImageParameterConfig, model: string) {
    return isImageResolutionAllowed(model, config.imageResolution || "", config) && isImageAspectRatioAllowed(model, config.imageAspectRatio || "", config);
}

function imageModelCapability(config: ImageParameterConfig | undefined, model: string) {
    const capabilities = config?.imageModelCapabilities;
    if (!capabilities) return undefined;
    const normalized = normalizeModelName(model);
    return capabilities[model] || capabilities[normalized] || Object.entries(capabilities).find(([key]) => normalizeModelName(key) === normalized)?.[1];
}

function capabilityAllows(values: string[] | undefined, value: string) {
    if (!values?.length) return true;
    const normalized = normalizeSizeValue(value || "auto");
    return values.some((item) => normalizeSizeValue(item) === normalized);
}

function normalizeModelName(model: string) {
    return String(model || "").trim().toLowerCase();
}

function normalizeSizeValue(size: string) {
    return String(size || "").trim().toLowerCase();
}
