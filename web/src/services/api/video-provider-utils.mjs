export function effectiveVideoResolution(value, { videoApiFormat = "standard", isSeedance = false, isSeedanceFast = false } = {}) {
    if (videoApiFormat === "duomi") return "720";
    const resolution = value === "480p" || value === "low" ? "480" : value === "720p" || value === "auto" || value === "high" || value === "medium" ? "720" : String(value || "").replace(/p$/i, "") || "720";
    if (!isSeedance) return resolution;
    if (!new Set(["480", "720", "1080"]).has(resolution)) return "720";
    return isSeedanceFast && resolution === "1080" ? "720" : resolution;
}

export function withEffectiveVideoResolution(config, context = {}) {
    return { ...config, vquality: `${effectiveVideoResolution(config?.vquality, context)}p` };
}

export function isXaiVideoModel(model) {
    const value = String(model || "")
        .trim()
        .toLowerCase();
    return value.includes("grok-imagine-video");
}

export function isUnsupportedXaiVideoModel(model) {
    const value = String(model || "")
        .trim()
        .toLowerCase();
    return value.startsWith("grok-") && !isXaiVideoModel(value);
}

export function videoCreatePathForModel(model) {
    return isXaiVideoModel(model) ? "/videos/generations" : "/videos";
}

export function xaiVideoDuration(value) {
    const seconds = Math.floor(Number(value) || 6);
    return Math.max(1, Math.min(15, seconds));
}

export function xaiVideoResolution(value) {
    const normalized = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/p$/, "");
    return normalized === "480" || normalized === "low" ? "480p" : "720p";
}

export function xaiVideoAspectRatioFromSize(value) {
    const normalized = String(value || "")
        .trim()
        .toLowerCase();
    if (["16:9", "9:16", "1:1"].includes(normalized)) return normalized;
    const match = normalized.match(/^(\d+)x(\d+)$/);
    if (!match) return "16:9";
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return "16:9";
    const ratio = width / height;
    const options = [
        ["16:9", 16 / 9],
        ["9:16", 9 / 16],
        ["1:1", 1],
    ];
    return options.reduce((best, item) => (Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best), options[0])[0];
}

export function videoTaskIdFromPayload(payload) {
    if (!payload || typeof payload !== "object") return "";
    return String(payload.id || payload.request_id || payload.task_id || payload.data?.id || payload.data?.request_id || payload.data?.task_id || "");
}

export function videoResultUrlFromPayload(payload) {
    if (!payload || typeof payload !== "object") return "";
    const candidates = [
        payload.url,
        payload.video_url,
        payload.content?.video_url,
        payload.result?.url,
        payload.result_url,
        payload.video?.url,
        payload.output?.url,
        Array.isArray(payload.output) ? payload.output[0]?.url || payload.output[0]?.video_url : undefined,
        Array.isArray(payload.data) ? payload.data[0]?.url || payload.data[0]?.video_url : undefined,
        payload.data?.url,
        payload.data?.video_url,
        payload.data?.content?.video_url,
        payload.data?.result?.url,
        payload.data?.result_url,
        payload.data?.video?.url,
        payload.data?.data?.url,
        payload.data?.data?.video_url,
    ];
    return String(candidates.find((value) => typeof value === "string" && value) || "");
}

export function videoTaskStatusFromPayload(payload) {
    if (!payload || typeof payload !== "object") return "pending";
    const rawStatus = payload.status || payload.data?.status || payload.data?.state || payload.state;
    const value = String(rawStatus || "")
        .trim()
        .toLowerCase();
    if (["completed", "succeeded", "success", "done"].includes(value)) return "completed";
    if (["failed", "cancelled", "canceled", "expired", "error"].includes(value)) return "failed";
    return "pending";
}
