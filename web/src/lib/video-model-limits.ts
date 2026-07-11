export type VideoRatio = "16:9" | "9:16" | "1:1";

export type VideoModelLimits = {
    durations: readonly number[];
    ratios: readonly VideoRatio[];
    resolutions: readonly string[];
    maxReferenceImages: number;
    supportsAudio: boolean;
};

const VIDEO_MODEL_LIMITS: Record<string, VideoModelLimits> = {
    "sora-2": { durations: [4, 8, 12], ratios: ["16:9", "9:16", "1:1"], resolutions: ["720p", "1080p"], maxReferenceImages: 1, supportsAudio: false },
    "sora-2-pro": { durations: [4, 8, 12, 20], ratios: ["16:9", "9:16", "1:1"], resolutions: ["720p", "1080p"], maxReferenceImages: 1, supportsAudio: false },
    "veo-3-fast": { durations: [4, 6, 8], ratios: ["16:9", "9:16", "1:1"], resolutions: ["720p"], maxReferenceImages: 1, supportsAudio: true },
    "veo-3": { durations: [4, 6, 8], ratios: ["16:9", "9:16", "1:1"], resolutions: ["720p", "1080p"], maxReferenceImages: 1, supportsAudio: true },
};

export const VIDEO_PROMPT_MAX_CHARS = 4000;
export const VIDEO_REFERENCE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_REFERENCE_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export function getVideoModelLimits(model: string) {
    return VIDEO_MODEL_LIMITS[model.trim().toLowerCase()];
}

export function videoRatio(value: string): VideoRatio | null {
    if (value === "16:9" || value === "9:16" || value === "1:1") return value;
    const match = value.match(/^(\d+)x(\d+)$/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width === height) return "1:1";
    if (width * 9 === height * 16) return "16:9";
    if (width * 16 === height * 9) return "9:16";
    return null;
}

export function videoSizeFromRatio(value: string) {
    const ratio = videoRatio(value);
    if (ratio === "9:16") return "720x1280";
    if (ratio === "1:1") return "1024x1024";
    return "1280x720";
}
