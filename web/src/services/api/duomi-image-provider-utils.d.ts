export const DUOMI_IMAGE_MODELS: string[];
export const DUOMI_IMAGE_MODEL_SUGGESTIONS: string[];
export const DUOMI_POLL_INTERVAL_MS: number;
export const DUOMI_POLL_MAX_ATTEMPTS: number;

export type DuomiTaskStatus = "pending" | "completed" | "failed";

export interface DuomiImageRequest {
    model: string;
    prompt: string;
    size: string;
    quality: string;
    referenceUrls: string[];
}

export interface DuomiImageRequestBody {
    model: string;
    prompt: string;
    size?: string;
    quality?: string;
    aspect_ratio?: string;
    image_size?: string;
    image_urls?: string[];
}

export function isDuomiImageModel(model: string): boolean;
export function isDuomiNanoBananaModel(model: string): boolean;
export function duomiCreatePath(model: string, referenceUrls: string[]): string;
export function duomiTaskPath(model: string, id: string): string;
export function duomiImageRequestBody(request: DuomiImageRequest): DuomiImageRequestBody;
export function duomiTaskIdFromPayload(model: string, payload: unknown): string;
export function duomiTaskStatusFromPayload(model: string, payload: unknown): DuomiTaskStatus;
export function duomiImageUrlsFromPayload(model: string, payload: unknown): string[];
export function duomiTaskErrorMessage(model: string, payload: unknown): string;
export function duomiReferenceUrls(urls: string[]): string[];
