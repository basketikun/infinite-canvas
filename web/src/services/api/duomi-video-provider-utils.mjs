import { duomiPublicReferenceUrls } from "./duomi-provider-utils.mjs";
import { DUOMI_IMAGE_MODEL_SUGGESTIONS, mergeFetchedImageModels } from "./duomi-image-provider-utils.mjs";
import { xaiVideoAspectRatioFromSize } from "./video-provider-utils.mjs";

export const DUOMI_VIDEO_MODELS = ["grok-video-1.5"];
export const DUOMI_VIDEO_MODEL_SUGGESTIONS = [...DUOMI_VIDEO_MODELS];
export const DUOMI_CHANNEL_MODEL_SUGGESTIONS = uniqueModels([...DUOMI_IMAGE_MODEL_SUGGESTIONS, ...DUOMI_VIDEO_MODEL_SUGGESTIONS]);
export const DUOMI_VIDEO_POLL_INTERVAL_MS = 2500;
export const DUOMI_VIDEO_POLL_MAX_ATTEMPTS = 120;

const COMPLETED_STATUSES = new Set(["succeeded", "completed", "success", "done"]);
const FAILED_STATUSES = new Set(["failed", "error", "cancelled", "canceled", "expired"]);

export function isDuomiVideoModel(model) {
    return DUOMI_VIDEO_MODELS.includes(String(model || "").trim());
}

export function normalizeVideoApiFormat(value) {
    return value === "duomi" ? "duomi" : "standard";
}

export function mergeFetchedVideoModels(videoApiFormat, currentModels, fetchedModels) {
    if (videoApiFormat !== "duomi") return uniqueModels(fetchedModels);
    return uniqueModels([...currentModels, ...fetchedModels, ...DUOMI_VIDEO_MODEL_SUGGESTIONS]);
}

export function mergeFetchedChannelModels({ imageApiFormat, videoApiFormat, currentModels, fetchedModels }) {
    const imageMergedModels = mergeFetchedImageModels(imageApiFormat, currentModels, fetchedModels);
    return mergeFetchedVideoModels(videoApiFormat, currentModels, imageMergedModels);
}

export function duomiVideoCreatePath() {
    return "/v1/videos/generations";
}

export function duomiVideoTaskPath(id) {
    return `/v1/videos/tasks/${encodeURIComponent(normalizedId(id))}`;
}

export function duomiVideoRequestBody({ model, prompt, size, seconds, referenceUrls }) {
    const normalizedModel = String(model || "").trim();
    if (!DUOMI_VIDEO_MODELS.includes(normalizedModel)) throw new Error(`${normalizedModel || model} 不是已确认的多米视频模型`);
    return {
        model: normalizedModel,
        prompt,
        aspect_ratio: xaiVideoAspectRatioFromSize(size),
        duration: normalizeDuration(seconds),
        quality: "720p",
        image_urls: duomiPublicReferenceUrls(referenceUrls ?? [], {
            min: 0,
            errorMessage: "多米 Grok 参考图仅支持公网图片 URL",
        }),
        oversea: false,
    };
}

export function duomiVideoTaskIdFromPayload(payload) {
    return isRecord(payload) ? normalizedId(payload.id) : "";
}

export function duomiVideoTaskStatusFromPayload(payload) {
    if (!isRecord(payload)) return "pending";
    if (duomiVideoTaskErrorMessage(payload)) return "failed";
    const normalized = String(payload.state ?? "")
        .trim()
        .toLowerCase();
    if (COMPLETED_STATUSES.has(normalized)) return "completed";
    if (FAILED_STATUSES.has(normalized)) return "failed";
    return "pending";
}

export function duomiVideoTaskErrorMessage(payload) {
    if (!isRecord(payload)) return "";
    const data = isRecord(payload.data) ? payload.data : undefined;
    const topLevelError = errorMessage(payload.error);
    const dataError = errorMessage(data?.error);
    return [payload.msg, payload.message, topLevelError, data?.msg, data?.message, dataError].find(isNonEmptyString)?.trim() || "";
}

export function duomiVideoUrlsFromPayload(payload) {
    if (!isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data.videos)) return [];
    return payload.data.videos.map((video) => (isRecord(video) ? publicVideoUrl(video.url) : "")).filter(Boolean);
}

function uniqueModels(models) {
    return Array.from(new Set(models.map((model) => String(model).trim()).filter(Boolean)));
}

function normalizeDuration(value) {
    const duration = Math.floor(Number(value) || 6);
    return Math.max(1, Math.min(20, duration));
}

function normalizedId(value) {
    if (typeof value === "string") return value.trim();
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function errorMessage(value) {
    if (typeof value === "string") return value;
    return isRecord(value) ? value.message : undefined;
}

function publicVideoUrl(value) {
    if (typeof value !== "string") return "";
    const normalized = value.trim();
    try {
        return duomiPublicReferenceUrls([normalized], { min: 1, max: 1 })[0] || "";
    } catch {
        return "";
    }
}

function isNonEmptyString(value) {
    return typeof value === "string" && Boolean(value.trim());
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
