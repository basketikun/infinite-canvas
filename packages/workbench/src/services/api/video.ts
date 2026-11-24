import { nanoid } from "nanoid";
import { modelAssetUrl, type ModelAsset, ModelExecutionError } from "@infinite-canvas/shared/model-http";
import { modelConnectionFingerprint } from "@infinite-canvas/shared/channels";

import { clampVideoSeconds, computeVideoSize, inferVideoRatio } from "@workbench/lib/media-size";
import { readMediaBlob, uploadMediaFile, type UploadedFile } from "@workbench/services/file-storage";
import { boolConfig, channelWrites, encodeGroupModel, findGroupModel, resolveModelRequestConfig, type AiConfig } from "@workbench/stores/use-config-store";
import { callScriptsReady } from "@workbench/stores/use-call-script-store";
import { models } from "./models/runtime";
import type { ModelRequestOptions, VideoGenerationResult, VideoGenerationTask, VideoGenerationTaskState } from "./models/types";
import type { ReferenceImage } from "@workbench/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@workbench/types/media";

type VideoMediaOptions = ModelRequestOptions & { videos?: ReferenceVideo[]; audios?: ReferenceAudio[] };

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationResult> {
    return waitForVideoGenerationTask(config, await createVideoGenerationTask(config, prompt, references, options), options);
}

// 每笔任务的随机标识参与摘要，待查记录不保存渠道凭据。
export function videoChannelFingerprint(config: AiConfig, model: string, token: string) {
    const target = findGroupModel(config, model);
    if (!target?.model) throw new ModelExecutionError("MODEL_VIDEO_CONNECTION_CHANGED");
    return modelConnectionFingerprint(token, target.channel, target.group);
}

export async function waitForVideoGenerationTask(config: AiConfig | (() => Promise<AiConfig>), task: VideoGenerationTask, options?: ModelRequestOptions): Promise<VideoGenerationResult> {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const current = typeof config === "function" ? await config() : config;
        options?.signal?.throwIfAborted();
        const state = await pollVideoGenerationTask(current, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") {
            const error = new Error(state.error);
            error.name = "VideoTaskFailed";
            throw error;
        }
        if (attempt === 119) break;
        await delay(2500, options?.signal);
    }
    throw new Error("视频生成超时，请稍后重试");
}

export function isVideoTaskFailed(error: unknown) {
    return error instanceof Error && error.name === "VideoTaskFailed";
}

export function isLocalVideoPending(error: unknown) {
    return error instanceof ModelExecutionError && ["MODEL_UNAVAILABLE", "MODEL_TASK_PAUSED", "MODEL_VIDEO_CONNECTION_CHANGED", "MODEL_LOCAL_VIDEO_CONNECTION_UNVERIFIED"].includes(error.code);
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    await Promise.all([callScriptsReady, channelWrites.flush()]);
    const model = config.model || config.videoModel;
    const requestConfig = resolveModelRequestConfig(config, model);
    const ratio = inferVideoRatio(config.size);
    const result = await models.createVideoTask({
        call: requestConfig, prompt,
        images: references.map((image) => ({ url: image.url || image.dataUrl, storageKey: image.storageKey })),
        videos: options?.videos?.map((video) => ({ url: video.url, storageKey: video.storageKey })),
        audios: options?.audios?.map((audio) => ({ url: audio.url, storageKey: audio.storageKey })),
        options: { seconds: clampVideoSeconds(config.videoSeconds), size: normalizeVideoSize(config.size, config.vquality), resolution: normalizeVideoResolution(config.vquality), ratio: ratio === "auto" ? "16:9" : ratio, generateAudio: boolConfig(config.videoGenerateAudio, true), watermark: boolConfig(config.videoWatermark, false), mode: resolveVideoMode(config.videoMode, references.length) },
    }, options);
    const identity = { model: encodeGroupModel(requestConfig.groupId, requestConfig.model), scriptId: requestConfig.scriptId, script: requestConfig.script };
    return "id" in result ? { ...identity, id: result.id } : { ...identity, id: nanoid(), result: result.result };
}

export async function waitForLocalVideo(taskId: string, options?: ModelRequestOptions & { resume?: boolean }): Promise<VideoGenerationResult> {
    const snapshot = await models.tasks!.wait(taskId, { signal: options?.signal, target: options?.target, resume: options?.resume, onTerminalFailure: options?.onTerminal });
    const asset = snapshot.result as ModelAsset;
    return { url: modelAssetUrl(asset), mimeType: asset.mimeType };
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: ModelRequestOptions): Promise<VideoGenerationTaskState> {
    if (models.tasks && !task.result) return { status: "completed", result: await waitForLocalVideo(task.id, options) };
    await Promise.all([callScriptsReady, channelWrites.flush()]);
    if (!task.scriptId) throw new ModelExecutionError("MODEL_CONFIG_MISSING");
    const requestConfig = resolveModelRequestConfig(config, task.model, task.scriptId);
    if (task.result) return { status: "completed", result: task.result };
    return models.queryVideoTask({ call: { ...requestConfig, script: task.script }, taskId: task.id }, options);
}

export async function storeGeneratedVideo(result: VideoGenerationResult, signal?: AbortSignal): Promise<UploadedFile> {
    const source = await resolveGeneratedVideo(result, signal);
    return "external" in source ? source.external : uploadMediaFile(source.input, "video", signal);
}

export async function resolveGeneratedVideo(result: VideoGenerationResult, signal?: AbortSignal): Promise<{ input: string | Blob } | { external: UploadedFile & { url: string } }> {
    signal?.throwIfAborted();
    if (result.blob) return { input: result.blob };
    if (result.url) {
        if (!/^https?:\/\//i.test(result.url) || !URL.canParse(result.url)) return { input: result.url };
        try {
            return { input: await readMediaBlob(undefined, result.url, { signal }) };
        } catch (error) {
            signal?.throwIfAborted();
            if (!(error instanceof TypeError)) throw new ModelExecutionError("MODEL_RESULT_MISSING");
            return { external: { url: result.url, bytes: 0, mimeType: result.mimeType || "video/mp4" } };
        }
    }
    throw new Error("视频接口没有返回可播放的视频");
}

function resolveVideoMode(mode: string | undefined, imageCount: number): "frames" | "reference" {
    if (mode === "reference" || imageCount > 2) return "reference";
    return "frames";
}

function normalizeVideoSize(value: string, resolution?: string) {
    if (value === "auto") return null;
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value || "16:9");
    if (ratio === "auto") return null;
    return computeVideoSize(resolution || "720", ratio);
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}
