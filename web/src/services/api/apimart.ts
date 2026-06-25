import axios from "axios";
import { nanoid } from "nanoid";

import { getMediaBlob } from "@/services/file-storage";
import { apimartImageUploadPath, directApimartReferenceImageUrl } from "@/services/apimart-reference-url";
import { getImageBlob } from "@/services/image-storage";
import { buildApiUrl, modelOptionName, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type RequestOptions = { signal?: AbortSignal };
type TaskKind = "image" | "video";
type ApimartTaskPayload = {
    code?: number;
    msg?: string;
    data?: Record<string, unknown> | Array<Record<string, unknown>>;
    task_id?: string;
    id?: string;
    error?: { message?: string };
};
type ApimartTaskStatus = "processing" | "completed" | "failed" | "submitted" | "queued" | "running";
type ApimartTaskResult = { status: "pending" } | { status: "completed"; urls: string[] } | { status: "failed"; error: string };

export type ApimartImageResult = { id: string; dataUrl: string };
export type ApimartVideoTaskState = { status: "pending" } | { status: "completed"; result: { url: string; mimeType: string } } | { status: "failed"; error: string };

export function isApimartImageModel(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return value === "gemini-3-pro-image" || value === "gemini-3-pro-image-preview";
}

export function isHappyHorseModel(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return value === "happyhorse-1.0" || value === "happyhorse-1.1";
}

export function isApimartSeedance2Config(config: Pick<AiConfig, "baseUrl" | "model" | "videoModel">) {
    const value = modelOptionName(config.model || config.videoModel).toLowerCase();
    return isApimartBaseUrl(config.baseUrl) && (value === "doubao-seedance-2.0" || value === "doubao-seedance-2.0-fast" || value === "doubao-seedance-2.0-face" || value === "doubao-seedance-2.0-fast-face");
}

export function isApimartBaseUrl(baseUrl: string) {
    const value = baseUrl.toLowerCase();
    return value.includes("api.apimart.ai") || value.includes("api.apib.ai");
}

export function normalizeApimartImageResolution(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "high" || normalized === "4k") return "4K";
    if (normalized === "medium" || normalized === "2k") return "2K";
    return "1K";
}

export function normalizeApimartImageSize(value: string) {
    return normalizeRatio(value, "1:1");
}

export function normalizeHappyHorseResolution(value: string) {
    const normalized = value.trim().toLowerCase().replace(/p$/, "");
    if (normalized === "1080" || normalized === "high") return "1080P";
    return "720P";
}

export function normalizeHappyHorseDuration(value: string) {
    const seconds = Math.floor(Number(value) || 5);
    return Math.max(3, Math.min(15, seconds));
}

export function normalizeHappyHorseSize(value: string) {
    return normalizeRatio(value, "16:9");
}

export function extractApimartTaskId(payload: unknown) {
    const root = asRecord(payload);
    const data = root ? root.data : undefined;
    const first = Array.isArray(data) ? asRecord(data[0]) : asRecord(data);
    return stringValue(first?.task_id) || stringValue(first?.id) || stringValue(root?.task_id) || stringValue(root?.id);
}

export function extractApimartResultUrls(payload: unknown) {
    const task = unwrapTaskPayload(payload);
    const result = asRecord(task.result);
    return {
        images: extractMediaUrls(result?.images),
        videos: extractMediaUrls(result?.videos),
    };
}

export async function requestApimartImages(config: AiConfig, prompt: string, count: number, options?: RequestOptions): Promise<ApimartImageResult[]> {
    const taskId = await createApimartTask(config, "/images/generations", {
        model: modelOptionName(config.model || config.imageModel),
        prompt,
        size: normalizeApimartImageSize(config.size),
        n: count,
        resolution: normalizeApimartImageResolution(config.quality),
    }, options);
    const urls = await pollApimartTaskUrls(config, taskId, "image", options);
    console.log("[apimart:image:urls]", { taskId, model: modelOptionName(config.model || config.imageModel), urls });
    return urls.map((dataUrl) => ({ id: nanoid(), dataUrl }));
}

export async function createHappyHorseTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: RequestOptions) {
    const payload: Record<string, unknown> = {
        model: modelOptionName(model),
        prompt,
        resolution: normalizeHappyHorseResolution(config.vquality),
        size: normalizeHappyHorseSize(config.size),
        duration: normalizeHappyHorseDuration(config.videoSeconds),
        watermark: config.videoWatermark === "true",
    };
    const imageUrls = await Promise.all(references.slice(0, 9).map((image) => resolveReferenceImageUrl(config, image, options)));
    if (imageUrls.length === 1) payload.first_frame_image = imageUrls[0];
    if (imageUrls.length > 1) payload.image_urls = imageUrls;
    return createApimartTask(config, "/videos/generations", payload, options);
}

export async function createApimartSeedance2Task(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions) {
    const payload: Record<string, unknown> = {
        model: modelOptionName(model),
        prompt,
        resolution: normalizeSeedance2Resolution(config.vquality, model),
        size: normalizeHappyHorseSize(config.size),
        duration: normalizeSeedance2Duration(config.videoSeconds),
        generate_audio: config.videoGenerateAudio === "true",
        watermark: config.videoWatermark === "true",
    };
    const imageUrls = await Promise.all(references.slice(0, 9).map((image) => resolveReferenceImageUrl(config, image, options)));
    const videoUrls = await Promise.all(videoReferences.slice(0, 3).map(resolveReferenceVideoUrl));
    const audioUrls = await Promise.all(audioReferences.slice(0, 3).map(resolveReferenceAudioUrl));
    if (imageUrls.length) payload.image_urls = imageUrls;
    if (videoUrls.length) payload.video_urls = videoUrls;
    if (audioUrls.length) payload.audio_urls = audioUrls;
    return createApimartTask(config, "/videos/generations", payload, options);
}

export async function pollHappyHorseTask(config: AiConfig, taskId: string, options?: RequestOptions): Promise<ApimartVideoTaskState> {
    const state = await pollApimartTask(config, taskId, "video", options);
    if (state.status === "pending" || state.status === "failed") return state;
    const url = state.urls[0];
    return url ? { status: "completed", result: { url, mimeType: "video/mp4" } } : { status: "failed", error: "APIMart 任务成功但没有返回视频 URL" };
}

async function createApimartTask(config: AiConfig, path: string, payload: Record<string, unknown>, options?: RequestOptions) {
    const response = await axios.post<ApimartTaskPayload>(apimartApiUrl(config, path), payload, { headers: apimartHeaders(config, "application/json"), signal: options?.signal });
    validateApimartEnvelope(response.data);
    const taskId = extractApimartTaskId(response.data);
    if (!taskId) throw new Error("APIMart 接口没有返回任务 ID");
    return taskId;
}

async function pollApimartTaskUrls(config: AiConfig, taskId: string, kind: TaskKind, options?: RequestOptions) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollApimartTask(config, taskId, kind, options);
        if (state.status === "completed") return state.urls;
        if (state.status === "failed") throw new Error(state.error);
        if (attempt === 119) throw new Error("APIMart 任务生成超时，请稍后重试");
        await delay(3000, options?.signal);
    }
    throw new Error("APIMart 任务生成超时，请稍后重试");
}

async function pollApimartTask(config: AiConfig, taskId: string, kind: TaskKind, options?: RequestOptions): Promise<ApimartTaskResult> {
    const response = await axios.get<ApimartTaskPayload>(apimartApiUrl(config, `/tasks/${encodeURIComponent(taskId)}?language=zh`), { headers: apimartHeaders(config), signal: options?.signal });
    validateApimartEnvelope(response.data);
    const task = unwrapTaskPayload(response.data);
    const status = stringValue(task.status).toLowerCase() as ApimartTaskStatus;
    if (status === "completed") {
        const urls = extractApimartResultUrls(response.data)[kind === "image" ? "images" : "videos"];
        return urls.length ? { status: "completed", urls } : { status: "failed", error: `APIMart 任务成功但没有返回${kind === "image" ? "图片" : "视频"} URL` };
    }
    if (status === "failed") {
        return { status: "failed", error: apimartErrorMessage(task) || "APIMart 任务生成失败" };
    }
    return { status: "pending" };
}

function apimartApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function apimartHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

async function resolveReferenceImageUrl(config: AiConfig, image: ReferenceImage, options?: RequestOptions) {
    const directUrl = directApimartReferenceImageUrl(image);
    if (directUrl) return directUrl;
    const uploadedUrl = await uploadApimartReferenceImage(config, image, options);
    if (uploadedUrl) return uploadedUrl;
    throw new Error("APIMart 视频参考图上传失败，请换一张图片或重新生成参考图。");
}

async function uploadApimartReferenceImage(config: AiConfig, image: ReferenceImage, options?: RequestOptions) {
    const blob = await referenceImageBlob(image);
    if (!blob) return "";
    const form = new FormData();
    form.append("file", blob, image.name || "reference.png");
    const response = await axios.post<ApimartTaskPayload>(apimartApiUrl(config, apimartImageUploadPath), form, { headers: apimartHeaders(config), signal: options?.signal });
    validateApimartEnvelope(response.data);
    return extractUploadedImageUrl(response.data);
}

async function referenceImageBlob(image: ReferenceImage) {
    if (image.storageKey) {
        const blob = await getImageBlob(image.storageKey);
        if (blob) return blob;
    }
    const url = image.dataUrl || image.url || "";
    if (!url) return null;
    return (await fetch(url)).blob();
}

function extractUploadedImageUrl(payload: unknown): string {
    const root = asRecord(payload);
    const data = root?.data;
    const item = Array.isArray(data) ? asRecord(data[0]) : asRecord(data);
    return stringValue(item?.url) || stringValue(item?.image_url) || stringValue(item?.asset_url) || stringValue(root?.url) || stringValue(root?.image_url) || stringValue(root?.asset_url);
}

async function resolveReferenceVideoUrl(video: ReferenceVideo) {
    if (/^https?:\/\//i.test(video.url || "") || video.url?.startsWith("asset://")) return video.url;
    let blob: Blob | null = null;
    if (video.storageKey) blob = await getMediaBlob(video.storageKey);
    if (!blob && video.url?.startsWith("blob:")) blob = await (await fetch(video.url)).blob();
    if (!blob) throw new Error("APIMart Seedance 2.0 参考视频必须是公网 URL、素材 ID，或本地已保存的视频");
    return blobToDataUrl(blob);
}

async function resolveReferenceAudioUrl(audio: ReferenceAudio) {
    if (/^https?:\/\//i.test(audio.url || "") || audio.url?.startsWith("asset://")) return audio.url;
    let blob: Blob | null = null;
    if (audio.storageKey) blob = await getMediaBlob(audio.storageKey);
    if (!blob && audio.url?.startsWith("blob:")) blob = await (await fetch(audio.url)).blob();
    if (!blob) throw new Error("APIMart Seedance 2.0 参考音频必须是公网 URL、素材 ID，或本地已保存的音频");
    return blobToDataUrl(blob);
}

function normalizeSeedance2Resolution(value: string, model: string) {
    const normalized = value.trim().toLowerCase().replace(/p$/, "");
    const modelName = modelOptionName(model).toLowerCase();
    if ((normalized === "4k" || normalized === "2160") && modelName === "doubao-seedance-2.0") return "4k";
    if ((normalized === "1080" || normalized === "high") && !modelName.includes("fast")) return "1080p";
    return "720p";
}

function normalizeSeedance2Duration(value: string) {
    const seconds = Math.floor(Number(value) || 5);
    return Math.max(4, Math.min(15, seconds));
}

function normalizeRatio(value: string, fallback: string) {
    const normalized = value.trim();
    if (!normalized || normalized === "auto" || normalized === "adaptive") return fallback;
    if (/^\d+:\d+$/.test(normalized)) return normalized;
    const match = normalized.match(/^(\d+)x(\d+)$/);
    if (!match) return fallback;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return fallback;
    const ratio = width / height;
    const options = [
        ["16:9", 16 / 9],
        ["9:16", 9 / 16],
        ["1:1", 1],
        ["4:3", 4 / 3],
        ["3:4", 3 / 4],
        ["21:9", 21 / 9],
    ] as const;
    return options.reduce((best, item) => (Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best), options[0])[0];
}

function extractMediaUrls(value: unknown) {
    return (Array.isArray(value) ? value : [])
        .flatMap((item) => {
            const record = asRecord(item);
            const url = record?.url;
            if (Array.isArray(url)) return url.filter((item): item is string => typeof item === "string" && Boolean(item));
            return typeof url === "string" && url ? [url] : [];
        })
        .filter(Boolean);
}

function unwrapTaskPayload(payload: unknown) {
    const root = asRecord(payload);
    const data = root?.data;
    const task = Array.isArray(data) ? asRecord(data[0]) : asRecord(data);
    if (!task) throw new Error("APIMart 接口没有返回任务数据");
    return task;
}

function validateApimartEnvelope(payload: ApimartTaskPayload) {
    if (typeof payload.code === "number" && payload.code !== 0 && payload.code !== 200) throw new Error(payload.msg || "APIMart 请求失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

function apimartErrorMessage(task: Record<string, unknown>) {
    const error = asRecord(task.error);
    return stringValue(task.message) || stringValue(task.msg) || stringValue(error?.message);
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
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

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取本地素材失败"));
        reader.readAsDataURL(blob);
    });
}
