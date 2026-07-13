import { duomiPublicReferenceUrls } from "./duomi-provider-utils.mjs";
import { xaiVideoAspectRatioFromSize } from "./video-provider-utils.mjs";

export const DUOMI_VIDEO_MODELS = ["grok-video-1.5"];
export const DUOMI_VIDEO_MODEL_SUGGESTIONS = [...DUOMI_VIDEO_MODELS];
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

export function duomiVideoCreatePath() {
    return "/v1/videos/generations";
}

export function duomiVideoTaskPath(id) {
    return `/v1/videos/tasks/${encodeURIComponent(normalizedId(id))}`;
}

export function duomiVideoRequestBody({ model, prompt, size, seconds, referenceUrls }) {
    if (!isDuomiVideoModel(model)) throw new Error(`${model} 不是已确认的多米视频模型`);
    return {
        model,
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
    const data = isRecord(payload.data) ? payload.data : undefined;
    const normalized = String(payload.state ?? payload.status ?? data?.state ?? data?.status ?? "")
        .trim()
        .toLowerCase();
    if (COMPLETED_STATUSES.has(normalized)) return "completed";
    if (FAILED_STATUSES.has(normalized)) return "failed";
    return "pending";
}

export function duomiVideoTaskErrorMessage(payload) {
    if (!isRecord(payload)) return "";
    const data = isRecord(payload.data) ? payload.data : undefined;
    const topLevelError = isRecord(payload.error) ? payload.error.message : undefined;
    const dataError = isRecord(data?.error) ? data.error.message : undefined;
    return [payload.msg, payload.message, topLevelError, data?.msg, data?.message, dataError].find(isNonEmptyString)?.trim() || "";
}

export function duomiVideoUrlsFromPayload(payload) {
    if (!isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data.videos)) return [];
    return payload.data.videos.map((video) => (isRecord(video) && typeof video.url === "string" ? video.url.trim() : "")).filter(Boolean);
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

function isNonEmptyString(value) {
    return typeof value === "string" && Boolean(value.trim());
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
