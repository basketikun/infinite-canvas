import type { DuomiVideoRequest, DuomiVideoRequestBody } from "./duomi-video-provider-utils.mjs";

export interface DuomiVideoGenerationTask {
    id: string;
    provider: "duomi";
    model: string;
}

export type DuomiVideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: { url: string; mimeType: "video/mp4" } } | { status: "failed"; error: string };

export interface DuomiVideoCreateInput {
    path: string;
    body: DuomiVideoRequestBody;
    signal?: AbortSignal;
}

export interface DuomiVideoPollInput {
    path: string;
    signal?: AbortSignal;
}

export interface CreateDuomiVideoLifecycleOptions {
    model: string;
    request: DuomiVideoRequest;
    create: (input: DuomiVideoCreateInput) => Promise<unknown>;
    signal?: AbortSignal;
}

export interface PollDuomiVideoLifecycleOptions {
    task: DuomiVideoGenerationTask;
    poll: (input: DuomiVideoPollInput) => Promise<unknown>;
    signal?: AbortSignal;
}

export function createDuomiVideoLifecycleTask(options: CreateDuomiVideoLifecycleOptions): Promise<DuomiVideoGenerationTask>;
export function pollDuomiVideoLifecycleTask(options: PollDuomiVideoLifecycleOptions): Promise<DuomiVideoGenerationTaskState>;
