import { duomiPublicReferenceUrls, duomiPublicUrlOrEmpty, duomiRequestHeaders, duomiRequestUrl, isDuomiRequestTimeout } from "./duomi-provider-utils.mjs";

export { duomiRequestHeaders, duomiRequestUrl, isDuomiRequestTimeout };

export const DUOMI_IMAGE_MODELS = ["gpt-image-2", "gemini-2.5-flash-image", "gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"];
export const DUOMI_IMAGE_MODEL_SUGGESTIONS = [...DUOMI_IMAGE_MODELS];
export const DUOMI_POLL_INTERVAL_MS = 2000;
export const DUOMI_POLL_MAX_ATTEMPTS = 150;

export function mergeFetchedImageModels(imageApiFormat, currentModels, fetchedModels) {
    if (imageApiFormat !== "duomi") return fetchedModels;
    return Array.from(new Set([...currentModels, ...fetchedModels, ...DUOMI_IMAGE_MODEL_SUGGESTIONS].map((model) => model.trim()).filter(Boolean)));
}

const DUOMI_NANO_BANANA_MODELS = DUOMI_IMAGE_MODELS.slice(1);
const DUOMI_NANO_BANANA_ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const DUOMI_NANO_BANANA_SIZE_ERROR = `多米 NANO 图片尺寸仅支持 auto、${DUOMI_NANO_BANANA_ASPECT_RATIOS.join("、")} 或正整数 WIDTHxHEIGHT`;
const DUOMI_IMAGE_SIZE_BY_QUALITY = {
    low: "1K",
    medium: "2K",
    high: "4K",
    standard: "2K",
    hd: "4K",
};
const COMPLETED_STATUSES = new Set(["succeeded", "completed", "success", "done"]);
const FAILED_STATUSES = new Set(["error", "failed", "cancelled", "canceled", "expired"]);
const PENDING_STATUSES = new Set(["pending", "running", "queued", "processing"]);

export function isDuomiImageModel(model) {
    return DUOMI_IMAGE_MODELS.includes(String(model || "").trim());
}

export function isDuomiNanoBananaModel(model) {
    return DUOMI_NANO_BANANA_MODELS.includes(String(model || "").trim());
}

export function duomiImageRequestSize(model, size) {
    const normalizedSize = String(size || "").trim();
    if (!isDuomiNanoBananaModel(model)) return normalizedSize;
    if (normalizedSize.toLowerCase() === "auto") return "auto";
    if (DUOMI_NANO_BANANA_ASPECT_RATIOS.includes(normalizedSize)) return normalizedSize;
    const dimensions = normalizedSize.match(/^(\d+)x(\d+)$/i);
    const width = Number(dimensions?.[1]);
    const height = Number(dimensions?.[2]);
    if (!dimensions || width <= 0 || height <= 0) throw new Error(DUOMI_NANO_BANANA_SIZE_ERROR);
    const target = width / height;
    return DUOMI_NANO_BANANA_ASPECT_RATIOS.reduce((best, item) => {
        const [width, height] = item.split(":").map(Number);
        const [bestWidth, bestHeight] = best.split(":").map(Number);
        return Math.abs(width / height - target) < Math.abs(bestWidth / bestHeight - target) ? item : best;
    });
}

export function duomiCreatePath(model, referenceUrls) {
    if (!isDuomiNanoBananaModel(model)) return "/v1/images/generations";
    return referenceUrls.length ? "/api/gemini/nano-banana-edit" : "/api/gemini/nano-banana";
}

export function duomiTaskPath(model, id) {
    const basePath = isDuomiNanoBananaModel(model) ? "/api/gemini/nano-banana" : "/v1/tasks";
    return `${basePath}/${encodeURIComponent(id)}`;
}

export function duomiImageRequestBody({ model, prompt, size, quality, referenceUrls }) {
    const normalizedSize = duomiImageRequestSize(model, size);
    const normalizedQuality = String(quality || "")
        .trim()
        .toLowerCase();
    if (!isDuomiNanoBananaModel(model)) {
        return {
            model,
            prompt,
            ...(normalizedSize && normalizedSize.toLowerCase() !== "auto" ? { size: normalizedSize } : {}),
            ...(normalizedQuality && normalizedQuality !== "auto" ? { quality: normalizedQuality } : {}),
        };
    }

    const urls = Array.isArray(referenceUrls) ? referenceUrls : [];
    return {
        model,
        prompt,
        ...(urls.length === 1 && normalizedSize.toLowerCase() === "auto" ? {} : { aspect_ratio: normalizedSize }),
        ...(DUOMI_IMAGE_SIZE_BY_QUALITY[normalizedQuality] ? { image_size: DUOMI_IMAGE_SIZE_BY_QUALITY[normalizedQuality] } : {}),
        ...(urls.length ? { image_urls: [...urls] } : {}),
    };
}

export function duomiTaskIdFromPayload(model, payload) {
    if (!isRecord(payload)) return "";
    const value = isDuomiNanoBananaModel(model) && isRecord(payload.data) ? payload.data.task_id : payload.id;
    if (typeof value === "string") return value.trim();
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export function duomiTaskStatusFromPayload(model, payload) {
    if (!isRecord(payload) || duomiTaskErrorMessage(model, payload)) return "failed";
    const value = isDuomiNanoBananaModel(model) && isRecord(payload.data) ? payload.data.state : payload.state;
    const normalized = String(value || "")
        .trim()
        .toLowerCase();
    if (COMPLETED_STATUSES.has(normalized)) return "completed";
    if (FAILED_STATUSES.has(normalized)) return "failed";
    return PENDING_STATUSES.has(normalized) ? "pending" : "failed";
}

export function duomiImageUrlsFromPayload(model, payload) {
    if (!isRecord(payload) || !isRecord(payload.data)) return [];
    const images = isDuomiNanoBananaModel(model) ? (isRecord(payload.data.data) ? payload.data.data.images : undefined) : payload.data.images;
    if (!Array.isArray(images)) return [];
    return images.map((image) => (isRecord(image) ? duomiPublicUrlOrEmpty(image.url) : "")).filter(Boolean);
}

export function duomiTaskErrorMessage(model, payload) {
    if (!isRecord(payload)) return "";
    const nestedMessage = isDuomiNanoBananaModel(model) && isRecord(payload.data) ? payload.data.msg : undefined;
    const errorMessage = isRecord(payload.error) ? payload.error.message : undefined;
    return [nestedMessage, payload.msg, errorMessage].find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

export function duomiReferenceUrls(urls) {
    return duomiPublicReferenceUrls(urls, {
        min: 1,
        max: 10,
        errorMessage: "参考图必须是 1 至 10 个公网图片 URL",
    });
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
