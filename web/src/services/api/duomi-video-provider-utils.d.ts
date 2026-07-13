export type VideoApiFormat = "standard" | "duomi";
export type DuomiVideoTaskStatus = "pending" | "completed" | "failed";

export interface DuomiVideoRequest {
    model: string;
    prompt: string;
    size: string;
    seconds?: string | number;
    referenceUrls: string[];
}

export interface DuomiVideoRequestBody {
    model: string;
    prompt: string;
    aspect_ratio: string;
    duration: number;
    quality: "720p";
    image_urls: string[];
    oversea: false;
}

export const DUOMI_VIDEO_MODELS: string[];
export const DUOMI_VIDEO_MODEL_SUGGESTIONS: string[];
export const DUOMI_VIDEO_POLL_INTERVAL_MS: number;
export const DUOMI_VIDEO_POLL_MAX_ATTEMPTS: number;

export function isDuomiVideoModel(model: string): boolean;
export function normalizeVideoApiFormat(value: unknown): VideoApiFormat;
export function mergeFetchedVideoModels(videoApiFormat: VideoApiFormat, currentModels: string[], fetchedModels: string[]): string[];
export function duomiVideoCreatePath(): string;
export function duomiVideoTaskPath(id: string | number): string;
export function duomiVideoRequestBody(request: DuomiVideoRequest): DuomiVideoRequestBody;
export function duomiVideoTaskIdFromPayload(payload: unknown): string;
export function duomiVideoTaskStatusFromPayload(payload: unknown): DuomiVideoTaskStatus;
export function duomiVideoTaskErrorMessage(payload: unknown): string;
export function duomiVideoUrlsFromPayload(payload: unknown): string[];
