import axios from "axios";

import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { modelOptionName, resolveModelRequestConfig, withLocalProxy, type AiConfig } from "@/stores/use-config-store";
import {
    apiText,
    assertTripoProxy,
    detectModel3dMime,
    model3dMimeFromUrl,
    skipTransientTripoError,
    TRIPO_FAILED_STATES,
    TRIPO_POLL_INTERVAL_MS,
    TRIPO_POLL_TIMEOUT_MS,
    tripoDelay,
    tripoHeaders,
    tripoRequest,
    tripoTaskFailed,
    tripoUrl,
    unwrapTripo,
    uploadTripoFile,
    type TripoEnvelope,
    type TripoRequestOptions,
} from "./tripo-shared";

// Follow-up Tripo operations that act on an existing 3D model: retexture, convert, rig, retarget,
// segment, complete, decimate — plus the two multiview image endpoints. Same async envelope as the
// generation flow, so the protocol layer in tripo-shared is reused as-is.

/**
 * Every endpoint validates `model` against its OWN enum, and none of them accepts the channel's
 * generation model (v3.1-20260211). Sending config.model here is a hard 1004, so each operation
 * carries its own allowed list and default instead of reading the channel selection.
 */
export const TEXTURE_MODELS = ["v3.0-20250812", "v2.5-20250123"];
export const RIG_MODELS = ["v1.0-20240301", "v2.5-20260210"];
export const SEGMENT_MODELS = ["v1.0-20250506", "v2.0-20260430"];
export const DECIMATE_MODELS = ["v2.0", "v1.0"];

/** GLB is the native generation output and is explicitly rejected by /models/convert. */
export const CONVERT_FORMATS = ["FBX", "GLTF", "USDZ", "OBJ", "STL", "3MF"];
export const RIG_TYPES = ["biped", "quadruped", "hexapod", "octopod", "avian", "serpentine", "aquatic"];
export const RIG_SPECS = ["tripo", "mixamo"];
export const RIG_OUT_FORMATS = ["glb", "fbx"];
export const SEGMENT_GRANULARITIES = ["simple", "balanced", "detailed"];
export const COMPLETION_MODES = ["ai_completion", "quick_cap"];
export const TEXTURE_QUALITIES = ["standard", "detailed", "extreme"];
export const MULTIVIEW_VIEWS = ["front", "left", "back", "right"] as const;

export type MultiviewView = (typeof MULTIVIEW_VIEWS)[number];

/** Preset animations for rig model v2.5-20260210, grouped by the rig type they apply to. */
export const RETARGET_PRESETS: Record<string, string[]> = {
    biped: ["preset:idle", "preset:walk", "preset:run", "preset:dive", "preset:climb", "preset:jump", "preset:slash", "preset:shoot", "preset:hurt", "preset:fall", "preset:turn"],
    quadruped: ["preset:quadruped:walk"],
    hexapod: ["preset:hexapod:walk"],
    octopod: ["preset:octopod:walk"],
    serpentine: ["preset:serpentine:march"],
    aquatic: ["preset:aquatic:march"],
    avian: [],
};

/** Which follow-up operations a produced model can feed. Retarget and complete accept nothing else. */
export type Model3dTaskKind = "generate" | "texture" | "convert" | "rig" | "retarget" | "segment" | "complete" | "decimate" | "multiview";

export type Model3dOpResult = { taskId: string; modelUrl: string; previewUrl?: string };
export type MultiviewResult = { taskId: string; views: Array<{ view: MultiviewView; url: string }> };
export type RigCheckResult = { riggable: boolean; rigType: string };

type TripoOpOutput = {
    model_url?: string;
    rendered_image_url?: string;
    riggable?: boolean;
    rig_type?: string;
    front_view_url?: string;
    left_view_url?: string;
    back_view_url?: string;
    right_view_url?: string;
};
type TripoOpTask = { task_id?: string; status?: string; progress?: number; output?: TripoOpOutput | null; error_message?: string };

function assertOpConfig(config: AiConfig) {
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    assertTripoProxy();
}

/**
 * Operations run on whichever channel owns the node's 3D model, so the request config comes from it. The
 * node's own model wins over the global default; only the channel is taken from it, since every operation
 * sends its own per-endpoint model enum in the body.
 */
function opRequestConfig(config: AiConfig) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.model3dModel);
    assertOpConfig(requestConfig);
    return requestConfig;
}

async function createOpTask(config: AiConfig, path: string, body: Record<string, unknown>, options?: TripoRequestOptions) {
    const response = await tripoRequest("model3dOpTaskCreateFailed", () =>
        axios.post<TripoEnvelope<TripoOpTask>>(tripoUrl(config, path), body, { headers: tripoHeaders(config, "application/json"), signal: options?.signal }),
    );
    const taskId = unwrapTripo(response.data, "model3dOpTaskCreateFailed").task_id;
    if (!taskId) throw new Error(apiText("model3dOpNoTaskId"));
    return taskId;
}

async function pollOpTask(config: AiConfig, taskId: string, options?: TripoRequestOptions) {
    const response = await tripoRequest("model3dOpTaskQueryFailed", () => axios.get<TripoEnvelope<TripoOpTask>>(tripoUrl(config, `/tasks/${taskId}`), { headers: tripoHeaders(config), signal: options?.signal }));
    return unwrapTripo(response.data, "model3dOpTaskQueryFailed");
}

/**
 * Poll until the task reaches a terminal state. A terminal Tripo failure is tagged via tripoTaskFailed
 * so callers can tell it apart from a timeout and decide whether to keep the task id for a retry.
 */
async function waitForOpTask(config: AiConfig, taskId: string, ready: (output: TripoOpOutput) => boolean, options?: TripoRequestOptions & { onProgress?: (progress: number) => void }) {
    const deadline = performance.now() + TRIPO_POLL_TIMEOUT_MS;
    for (;;) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const task = await pollOpTask(config, taskId, options).catch(skipTransientTripoError);
        if (task?.status === "success" && task.output && ready(task.output)) return task.output;
        if (task && TRIPO_FAILED_STATES.includes(task.status || "")) throw tripoTaskFailed(task.error_message || apiText("model3dOpFailed"));
        if (task) options?.onProgress?.(Number(task.progress) || 0);
        if (performance.now() >= deadline) throw new Error(apiText("model3dOpTimeout"));
        await tripoDelay(TRIPO_POLL_INTERVAL_MS, options?.signal);
    }
}

/** Shared runner for the eight operations whose output is a new model file. */
async function runModelOp(config: AiConfig, path: string, body: Record<string, unknown>, options?: Model3dOpOptions): Promise<Model3dOpResult> {
    const requestConfig = opRequestConfig(config);
    // The model picker stores "channelId::model" so two channels can offer the same model name. Tripo must
    // receive the bare name or it answers 1004 with the composite echoed back, so it is stripped here rather
    // than at each call site: every endpoint below takes its model from either a preset enum or the picker.
    const taskId = await createOpTask(requestConfig, path, typeof body.model === "string" ? { ...body, model: modelOptionName(body.model) } : body, options);
    options?.onTaskCreated?.(taskId);
    const output = await waitForOpTask(requestConfig, taskId, (value) => Boolean(value.model_url), options);
    return { taskId, modelUrl: output.model_url || "", previewUrl: output.rendered_image_url };
}

export type Model3dOpOptions = TripoRequestOptions & {
    /** Called with the task id as soon as it exists, so the node can store it and resume after a refresh. */
    onTaskCreated?: (taskId: string) => void;
    onProgress?: (progress: number) => void;
};

/** Resume a task whose id was already stored on a node (page refresh mid-operation). */
export async function waitForModel3dOp(config: AiConfig, taskId: string, options?: Model3dOpOptions): Promise<Model3dOpResult> {
    const requestConfig = opRequestConfig(config);
    const output = await waitForOpTask(requestConfig, taskId, (value) => Boolean(value.model_url), options);
    return { taskId, modelUrl: output.model_url || "", previewUrl: output.rendered_image_url };
}

/**
 * Resolve the `input` for an operation. Tripo accepts a prior task_id, a file_token, or a URL; a task id
 * keeps the bytes server-side, so it is preferred. When the node has no usable task id (an older node, or
 * one restored from storage) the stored model is uploaded to get a file_token instead.
 */
export async function resolveOpInput(config: AiConfig, source: { taskId?: string; storageKey?: string; mimeType?: string }, options?: TripoRequestOptions) {
    if (source.taskId) return source.taskId;
    if (!source.storageKey) throw new Error(apiText("model3dOpSourceMissing"));
    const blob = await getMediaBlob(source.storageKey);
    if (!blob) throw new Error(apiText("model3dOpSourceMissing"));
    const requestConfig = opRequestConfig(config);
    return uploadTripoFile(requestConfig, new File([blob], "model.glb", { type: source.mimeType || "model/gltf-binary" }), options);
}

export function requestModel3dTexture(config: AiConfig, input: string, params: { model?: string; textureQuality?: string; pbr?: boolean; textureAlignment?: string }, options?: Model3dOpOptions) {
    return runModelOp(
        config,
        "/models/texture",
        {
            input,
            model: params.model || TEXTURE_MODELS[0],
            ...(params.textureQuality ? { texture_quality: params.textureQuality } : {}),
            ...(params.pbr === undefined ? {} : { pbr: params.pbr }),
            ...(params.textureAlignment ? { texture_alignment: params.textureAlignment } : {}),
        },
        options,
    );
}

export function requestModel3dConvert(config: AiConfig, input: string, params: { format: string; quad?: boolean; faceLimit?: number; textureSize?: number; textureFormat?: string }, options?: Model3dOpOptions) {
    return runModelOp(
        config,
        "/models/convert",
        {
            input,
            format: params.format,
            ...(params.quad === undefined ? {} : { quad: params.quad }),
            ...(params.faceLimit ? { face_limit: params.faceLimit } : {}),
            ...(params.textureSize ? { texture_size: params.textureSize } : {}),
            ...(params.textureFormat ? { texture_format: params.textureFormat } : {}),
        },
        options,
    );
}

/** Free and sub-second; run it before rigging so a non-riggable model does not burn credits. */
export async function requestRigCheck(config: AiConfig, input: string, options?: TripoRequestOptions): Promise<RigCheckResult> {
    const requestConfig = opRequestConfig(config);
    const taskId = await createOpTask(requestConfig, "/animations/rig-check", { input }, options);
    const output = await waitForOpTask(requestConfig, taskId, (value) => value.riggable !== undefined, options);
    return { riggable: Boolean(output.riggable), rigType: output.rig_type || "" };
}

export function requestModel3dRig(config: AiConfig, input: string, params: { model?: string; rigType?: string; spec?: string; outFormat?: string }, options?: Model3dOpOptions) {
    return runModelOp(
        config,
        "/animations/rig",
        {
            input,
            model: params.model || RIG_MODELS[1],
            ...(params.rigType ? { rig_type: params.rigType } : {}),
            ...(params.spec ? { spec: params.spec } : {}),
            ...(params.outFormat ? { out_format: params.outFormat } : {}),
        },
        options,
    );
}

/** `input` must be a rig task id — a file_token is rejected, so this only chains off an in-canvas rig. */
export function requestModel3dRetarget(config: AiConfig, rigTaskId: string, params: { animation: string; outFormat?: string; bakeAnimation?: boolean; animateInPlace?: boolean }, options?: Model3dOpOptions) {
    return runModelOp(
        config,
        "/animations/retarget",
        {
            input: rigTaskId,
            animation: params.animation,
            ...(params.outFormat ? { out_format: params.outFormat } : {}),
            ...(params.bakeAnimation === undefined ? {} : { bake_animation: params.bakeAnimation }),
            ...(params.animateInPlace === undefined ? {} : { animate_in_place: params.animateInPlace }),
        },
        options,
    );
}

export function requestModel3dSegment(config: AiConfig, input: string, params: { model?: string; granularity?: string; splitByConnectivity?: boolean }, options?: Model3dOpOptions) {
    return runModelOp(
        config,
        "/mesh/segment",
        {
            input,
            model: params.model || SEGMENT_MODELS[0],
            ...(params.granularity ? { segmentation_granularity: params.granularity } : {}),
            ...(params.splitByConnectivity === undefined ? {} : { split_by_connectivity: params.splitByConnectivity }),
        },
        options,
    );
}

/** `input` must be a mesh/segment task id; Tripo rejects anything else with a task-type error. */
export function requestModel3dComplete(config: AiConfig, segmentTaskId: string, params: { completionMode?: string }, options?: Model3dOpOptions) {
    return runModelOp(config, "/mesh/complete", { input: segmentTaskId, ...(params.completionMode ? { completion_mode: params.completionMode } : {}) }, options);
}

export function requestModel3dDecimate(config: AiConfig, input: string, params: { model?: string; faceLimit?: number; quad?: boolean }, options?: Model3dOpOptions) {
    return runModelOp(
        config,
        "/mesh/decimate",
        {
            input,
            model: params.model || DECIMATE_MODELS[0],
            ...(params.faceLimit ? { face_limit: params.faceLimit } : {}),
            ...(params.quad === undefined ? {} : { quad: params.quad }),
        },
        options,
    );
}

/** Multiview generation from a single image; the four view URLs come back on one task. */
async function runMultiviewOp(config: AiConfig, path: string, body: Record<string, unknown>, options?: Model3dOpOptions): Promise<MultiviewResult> {
    const requestConfig = opRequestConfig(config);
    const taskId = await createOpTask(requestConfig, path, body, options);
    options?.onTaskCreated?.(taskId);
    const output = await waitForOpTask(requestConfig, taskId, (value) => Boolean(value.front_view_url), options);
    const urls: Record<MultiviewView, string | undefined> = {
        front: output.front_view_url,
        left: output.left_view_url,
        back: output.back_view_url,
        right: output.right_view_url,
    };
    const views = MULTIVIEW_VIEWS.map((view) => ({ view, url: urls[view] || "" })).filter((item) => item.url);
    if (!views.length) throw new Error(apiText("model3dOpFailed"));
    return { taskId, views };
}

export function requestImageToMultiview(config: AiConfig, input: string, options?: Model3dOpOptions) {
    return runMultiviewOp(config, "/generation/image-to-multiview", { input }, options);
}

export function requestEditMultiview(config: AiConfig, input: string, prompts: Array<{ prompt: string; view: MultiviewView }>, options?: Model3dOpOptions) {
    if (!prompts.length) throw new Error(apiText("promptRequired"));
    return runMultiviewOp(config, "/generation/edit-multiview", { input, prompts }, options);
}

/**
 * Multiview to 3D. Views are sent in view-key form so order does not matter; the server canonicalizes
 * to [front, left, back, right]. Tripo requires the front view and at least two views in total.
 */
export function requestMultiviewToModel(
    config: AiConfig,
    views: Array<{ view: MultiviewView; input: string }>,
    params: { model: string; faceLimit?: number; texture?: boolean; pbr?: boolean; textureQuality?: string; textureAlignment?: string; orientation?: string; quad?: boolean },
    options?: Model3dOpOptions,
) {
    if (!views.some((item) => item.view === "front")) throw new Error(apiText("model3dMultiviewFrontRequired"));
    if (views.length < 2) throw new Error(apiText("model3dMultiviewTooFew"));
    return runModelOp(
        config,
        "/generation/multiview-to-model",
        {
            model: params.model,
            inputs: views.map((item) => ({ [item.view]: item.input })),
            ...(params.faceLimit ? { face_limit: params.faceLimit } : {}),
            ...(params.texture === undefined ? {} : { texture: params.texture }),
            ...(params.pbr === undefined ? {} : { pbr: params.pbr }),
            ...(params.textureQuality ? { texture_quality: params.textureQuality } : {}),
            ...(params.textureAlignment ? { texture_alignment: params.textureAlignment } : {}),
            ...(params.orientation ? { orientation: params.orientation } : {}),
            ...(params.quad === undefined ? {} : { quad: params.quad }),
        },
        options,
    );
}

/** Extensions for the formats /models/convert can emit, used for the download filename. */
const CONVERT_EXTENSIONS: Record<string, string> = { FBX: "fbx", GLTF: "gltf", USDZ: "usdz", OBJ: "obj", STL: "stl", "3MF": "3mf" };

export function convertExtension(format: string) {
    return CONVERT_EXTENSIONS[format.toUpperCase()] || format.toLowerCase();
}

/**
 * Store an operation's output locally. Signed Tripo URLs expire within a day, so the blob is downloaded
 * immediately. Tripo serves outputs from more than one CDN and not all of them send CORS headers (image
 * tasks use a CloudFront host that does not), so the fetch goes through the local proxy — which the
 * operation itself already required. The blob is passed to uploadMediaFile so it is not fetched twice.
 */
export async function storeModel3dOpResult(url: string, prefix = "model3d"): Promise<UploadedFile> {
    const response = await fetch(withLocalProxy(url));
    if (!response.ok) throw new Error(apiText("model3dDownloadFailed"));
    const blob = await response.blob();
    // Rig and retarget can emit FBX, and convert emits six non-glb formats, so the stored blob carries the
    // detected type — the viewer chooses its loader from it and the download gets a truthful mime.
    const mimeType = await detectModel3dMime(blob, model3dMimeFromUrl(url, blob.type || "model/gltf-binary"));
    return { ...(await uploadMediaFile(new Blob([blob], { type: mimeType }), prefix)), mimeType };
}
