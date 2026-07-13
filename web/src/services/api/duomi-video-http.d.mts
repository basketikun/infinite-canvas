import type { DuomiVideoGenerationTask } from "./duomi-video-lifecycle.mjs";

export interface DuomiVideoReference {
    url?: string;
    dataUrl: string;
}

export interface DuomiVideoRequestInput {
    modelName: string;
    prompt: string;
    references: DuomiVideoReference[];
    size: string;
    seconds: string | number;
}

export interface DuomiVideoHttpRequestOptions {
    baseUrl: string;
    apiKey: string;
    useProxy: boolean;
    path: string;
    deadlineAt: number;
    now?: () => number;
    proxyUrl?: string;
    proxyHeaders?: Record<string, string>;
    proxyTargetHeader: string;
}

export interface DuomiVideoErrorOptions {
    signal?: AbortSignal;
    isCancellation?: boolean;
    isHttpError?: boolean;
}

export const DUOMI_VIDEO_TIMEOUT_ERROR: string;
export function duomiVideoDeadlineAt(now?: () => number): number;
export function duomiVideoRemainingTimeout(deadlineAt: number, now?: () => number): number;
export function buildDuomiVideoHttpRequest(options: DuomiVideoHttpRequestOptions): { url: string; headers: Record<string, string>; timeout: number };
export function duomiVideoRequestFromInputs(input: DuomiVideoRequestInput): { model: string; prompt: string; size: string; seconds: string | number; referenceUrls: string[] };
export function withDuomiVideoTaskModel(task: DuomiVideoGenerationTask, model: string): DuomiVideoGenerationTask;
export function translateDuomiVideoRequestError(error: unknown, options?: DuomiVideoErrorOptions): Error;
