import axios from "axios";

import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { isModel3dFaceLimitAuto } from "@/lib/model3d-face-limit";
import { modelOptionName, resolveModelRequestConfig, withLocalProxy, type AiConfig } from "@/stores/use-config-store";
import {
    skipTransientTripoError,
    apiText,
    assertTripoProxy,
    isTripoTaskFailed,
    TRIPO_FAILED_STATES,
    TRIPO_POLL_INTERVAL_MS,
    TRIPO_POLL_TIMEOUT_MS,
    tripoDelay,
    tripoHeaders,
    tripoRequest,
    tripoTaskFailed,
    detectModel3dMime,
    model3dMimeFromUrl,
    tripoUrl,
    unwrapTripo,
    uploadTripoFile,
    type TripoEnvelope,
    type TripoRequestOptions,
} from "./tripo-shared";

// Tripo 3D generation. The protocol is fully async: create a task, poll it, then download the result.

// Tripo exposes no model-list endpoint; the generation API validates against this fixed set,
// so the channel editor offers it directly instead of calling /models.
export const TRIPO_MODELS = ["v3.1-20260211", "v3.0-20250812", "v2.5-20250123", "P1-20260311", "P2-20260801"];

/**
 * Models that accept `quad` (four-sided polygons instead of triangles). In the P series only P2 supports it —
 * P1 hard-rejects the field with a 1004 rather than ignoring it — and in the H series it needs v3.0 or newer.
 * The field is dropped for every other model so switching models cannot turn a valid request into a 1004.
 */
const QUAD_MODELS = ["P2-20260801", "v3.0-20250812", "v3.1-20260211"];

export function supportsModel3dQuad(model: string | undefined) {
    return QUAD_MODELS.includes(modelOptionName(model || "").trim());
}

type RequestOptions = TripoRequestOptions;
type TripoTaskOutput = { model_url?: string; rendered_image_url?: string; generated_image_url?: string };
type TripoTask = { task_id?: string; status?: string; progress?: number; output?: TripoTaskOutput | null; error_message?: string };

export type Model3dGenerationOptions = RequestOptions & {
    /** Image source for image-to-model: a file_token, a public URL, or a previous task id. */
    input?: string;
    faceLimit?: number;
    texture?: boolean;
    pbr?: boolean;
    textureQuality?: string;
    quad?: boolean;
};
export type Model3dTask = { id: string; model: string };
export type Model3dResult = { modelUrl: string; previewUrl?: string; mimeType: string };
export type Model3dTaskState = { status: "pending"; progress: number } | { status: "completed"; result: Model3dResult } | { status: "failed"; error: string };

function assertModel3dConfig(config: AiConfig) {
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    if (!config.model.trim()) throw new Error(apiText("model3dModelRequired"));
    assertTripoProxy();
}

export const isModel3dTaskFailed = isTripoTaskFailed;

/**
 * Upload an image so image-to-model can reference it; Tripo rejects data: URLs and local blobs.
 * The channel is resolved here rather than trusting the caller's config: baseUrl and apiKey live on the
 * channel, not at the top level, and this upload runs before createModel3dTask does its own resolving.
 */
export async function uploadModel3dImage(config: AiConfig, file: File, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.model3dModel);
    assertModel3dConfig(requestConfig);
    return uploadTripoFile(requestConfig, file, options);
}

/** Config keeps these as strings for the settings panel; Tripo wants booleans and a number. */
export function model3dRequestOptions(config: AiConfig): Pick<Model3dGenerationOptions, "faceLimit" | "texture" | "pbr" | "textureQuality" | "quad"> {
    const faceLimit = isModel3dFaceLimitAuto(config.model3dFaceLimit) ? Number.NaN : Number(config.model3dFaceLimit);
    const model = config.model || config.model3dModel;
    return {
        texture: config.model3dTexture !== "false",
        pbr: config.model3dPbr !== "false",
        ...(config.model3dTextureQuality ? { textureQuality: config.model3dTextureQuality } : {}),
        ...(Number.isFinite(faceLimit) && faceLimit >= 1 ? { faceLimit: Math.floor(faceLimit) } : {}),
        // Only sent for a model that accepts it, and only when asked for: quad defaults to false server-side.
        ...(config.model3dQuad === "true" && supportsModel3dQuad(model) ? { quad: true } : {}),
    };
}

export async function createModel3dTask(config: AiConfig, prompt: string, options?: Model3dGenerationOptions): Promise<Model3dTask> {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.model3dModel);
    assertModel3dConfig(requestConfig);
    const imageToModel = Boolean(options?.input);
    if (!imageToModel && !prompt.trim()) throw new Error(apiText("model3dPromptRequired"));
    // Tripo validates ranges per model version and returns a precise message, so parameters are passed through as-is.
    const body = {
        model: requestConfig.model,
        ...(imageToModel ? { input: options?.input } : { prompt: prompt.trim() }),
        ...(options?.faceLimit ? { face_limit: options.faceLimit } : {}),
        ...(options?.texture === undefined ? {} : { texture: options.texture }),
        ...(options?.pbr === undefined ? {} : { pbr: options.pbr }),
        ...(options?.textureQuality ? { texture_quality: options.textureQuality } : {}),
        ...(options?.quad === undefined ? {} : { quad: options.quad }),
    };
    const path = imageToModel ? "/generation/image-to-model" : "/generation/text-to-model";
    const response = await tripoRequest("model3dTaskCreateFailed", () =>
        axios.post<TripoEnvelope<TripoTask>>(tripoUrl(requestConfig, path), body, { headers: tripoHeaders(requestConfig, "application/json"), signal: options?.signal }),
    );
    const id = unwrapTripo(response.data, "model3dTaskCreateFailed").task_id;
    if (!id) throw new Error(apiText("noModel3dTaskId"));
    return { id, model: requestConfig.model };
}

export async function pollModel3dTask(config: AiConfig, task: Model3dTask, options?: RequestOptions): Promise<Model3dTaskState> {
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertModel3dConfig(requestConfig);
    const response = await tripoRequest("model3dTaskQueryFailed", () => axios.get<TripoEnvelope<TripoTask>>(tripoUrl(requestConfig, `/tasks/${task.id}`), { headers: tripoHeaders(requestConfig), signal: options?.signal }));
    const data = unwrapTripo(response.data, "model3dTaskQueryFailed");
    const modelUrl = data.output?.model_url;
    if (data.status === "success" && modelUrl) return { status: "completed", result: { modelUrl, previewUrl: data.output?.rendered_image_url, mimeType: "model/gltf-binary" } };
    if (data.status === "banned") return { status: "failed", error: apiText("model3dBanned") };
    if (data.status === "expired") return { status: "failed", error: apiText("model3dExpired") };
    if (TRIPO_FAILED_STATES.includes(data.status || "")) return { status: "failed", error: data.error_message || apiText("model3dGenerationFailed") };
    return { status: "pending", progress: Number(data.progress) || 0 };
}

export async function waitForModel3dTask(config: AiConfig, task: Model3dTask, options?: RequestOptions & { onProgress?: (progress: number) => void }): Promise<Model3dResult> {
    const deadline = performance.now() + TRIPO_POLL_TIMEOUT_MS;
    for (;;) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollModel3dTask(config, task, options).catch(skipTransientTripoError);
        if (state?.status === "completed") return state.result;
        if (state?.status === "failed") throw tripoTaskFailed(state.error);
        if (state) options?.onProgress?.(state.progress);
        if (performance.now() >= deadline) throw new Error(apiText("model3dTimeout"));
        await tripoDelay(TRIPO_POLL_INTERVAL_MS, options?.signal);
    }
}

/**
 * Persist the generated model locally. Signed Tripo URLs expire within a day and are re-signed on every task
 * query, so the blob is downloaded immediately instead of storing the URL. The output CDN allows cross-origin
 * reads, so it is fetched directly and handed to uploadMediaFile as a Blob to bypass the proxy.
 */
export async function storeGeneratedModel3d(result: Model3dResult): Promise<UploadedFile> {
    // The task is already paid for, so a flaky download is retried rather than discarding the result.
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3 && !response?.ok; attempt++) {
        if (attempt) await tripoDelay(TRIPO_POLL_INTERVAL_MS);
        response = await fetch(withLocalProxy(result.modelUrl)).catch(() => null);
    }
    if (!response?.ok) throw new Error(apiText("model3dDownloadFailed"));
    const blob = await response.blob();
    // Quad output on the H series comes back as FBX, so the real format is detected rather than assumed:
    // the CDN serves octet-stream and the viewer picks its loader from this mime type.
    const mimeType = await detectModel3dMime(blob, model3dMimeFromUrl(result.modelUrl, result.mimeType));
    const stored = await uploadMediaFile(new Blob([blob], { type: mimeType }), "model3d");
    return { ...stored, mimeType };
}

export async function storeModel3dPreview(previewUrl: string) {
    const response = await fetch(withLocalProxy(previewUrl));
    if (!response.ok) return null;
    return uploadMediaFile(await response.blob(), "model3d-preview");
}
