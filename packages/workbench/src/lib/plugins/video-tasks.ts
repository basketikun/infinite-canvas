import { z } from "zod";
import type { GenerateVideoResult, PluginTaskHandle, PluginVideoTaskState, SubmitVideoResult } from "@infinite-canvas/plugin-sdk";
import { assertModelTaskTarget, ModelExecutionError, type ModelTask, type PluginTaskTarget, type WebPluginVideoReceipt } from "@infinite-canvas/shared/model-http";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { sha256 } from "@infinite-canvas/shared/utils/sha256";
import { storedAssetFromUrl } from "@workbench/lib/media-source";
import { models } from "@workbench/services/api/models/runtime";
import { createVideoGenerationTask, pollVideoGenerationTask, resolveGeneratedVideo, storeGeneratedVideo, videoChannelFingerprint } from "@workbench/services/api/video";
import { mediaBlobMetadata, readMediaBlob } from "@workbench/services/file-storage";
import { storage } from "@workbench/services/storage/runtime";
import { callScriptsReady } from "@workbench/stores/use-call-script-store";
import { channelWrites, useConfigStore, type AiConfig } from "@workbench/stores/use-config-store";
import type { ReferenceImage } from "@workbench/types/image";

export type PluginVideoOwner = Omit<PluginTaskTarget, "page">;
const tokenSchema = z.string().uuid();
const localVideoAsset = z.object({ collection: z.literal("media"), key: z.string().min(1), mimeType: z.string().min(1) }).strict();

function verifiedLocalTask(task: ModelTask, id: string, target: PluginTaskTarget) {
    try { assertModelTaskTarget(task, id, target); }
    catch { throw new PluginError("PLUGIN_TASK_UNAVAILABLE"); }
    if (task.action !== "video") throw new PluginError("PLUGIN_TASK_UNAVAILABLE");
}

function localState(status: string, result: ModelTask["result"]): PluginVideoTaskState {
    switch (status) {
        case "queued":
        case "running": return { status: "pending" };
        case "paused":
        case "failed":
        case "cancelled":
        case "interrupted": return { status };
        case "completed": {
            const asset = localVideoAsset.safeParse(result);
            if (!asset.success) throw new PluginError("PLUGIN_OPERATION_FAILED");
            return { status, result: { storageKey: asset.data.key, mimeType: asset.data.mimeType } };
        }
        default: throw new PluginError("PLUGIN_OPERATION_FAILED");
    }
}

function throwTaskError(signal: AbortSignal, error: unknown): never {
    signal.throwIfAborted();
    if (error instanceof PluginError && error.code === "PLUGIN_TASK_UNAVAILABLE") throw new PluginError("PLUGIN_TASK_UNAVAILABLE");
    if (error instanceof ModelExecutionError && (error.code === "MODEL_TASK_MISSING" || error.code === "MODEL_TASK_CONFLICT" || error.code === "MODEL_VIDEO_CONNECTION_CHANGED")) throw new PluginError("PLUGIN_TASK_UNAVAILABLE");
    console.error("[plugins] video task failed", error);
    throw new PluginError("PLUGIN_OPERATION_FAILED");
}

export async function submitPluginVideo(owner: PluginVideoOwner, config: AiConfig, prompt: string, references: ReferenceImage[], signal: AbortSignal): Promise<SubmitVideoResult> {
    try {
        signal.throwIfAborted();
        const handle = { token: crypto.randomUUID(), ...(owner.workId !== undefined && { workId: owner.workId }) };
        const id = await sha256(new TextEncoder().encode(handle.token).buffer);
        const target: PluginTaskTarget = { ...owner, page: "plugin" };
        const web = storage.pluginVideoTasks;
        if (!models.tasks) {
            if (!web) throw new PluginError("PLUGIN_OPERATION_FAILED");
            await web.prepare();
        }
        signal.throwIfAborted();
        let submission: Promise<ModelTask> | undefined;
        const task = await createVideoGenerationTask(config, prompt, references, models.tasks ? {
            taskId: id, target, signal, onTaskSubmission: (receipt) => { submission = receipt; },
        } : { signal });
        signal.throwIfAborted();
        if (models.tasks) {
            if (!submission || task.id !== id || task.result) throw new PluginError("PLUGIN_TASK_UNAVAILABLE");
            verifiedLocalTask(await submission, id, target);
        } else if (task.result) {
            const file = await storeGeneratedVideo(task.result!, signal);
            signal.throwIfAborted();
            const result: GenerateVideoResult = { ...(file.storageKey ? { storageKey: file.storageKey } : { url: file.url }), mimeType: file.mimeType, width: file.width, height: file.height, durationMs: file.durationMs };
            return { kind: "completed", result };
        } else {
            const fingerprint = await videoChannelFingerprint(config, task.model, handle.token);
            await web!.save({ id, target, state: { status: "pending", task, channelFingerprint: fingerprint } });
        }
        signal.throwIfAborted();
        return { kind: "accepted", handle };
    } catch (error) { throwTaskError(signal, error); }
}

export async function readPluginVideoTask(owner: PluginVideoOwner, handle: PluginTaskHandle, signal: AbortSignal): Promise<PluginVideoTaskState> {
    try {
        signal.throwIfAborted();
        if (!tokenSchema.safeParse(handle?.token).success || handle.workId !== owner.workId) throw new PluginError("PLUGIN_TASK_UNAVAILABLE");
        const id = await sha256(new TextEncoder().encode(handle.token).buffer);
        const target: PluginTaskTarget = { ...owner, page: "plugin" };
        signal.throwIfAborted();
        if (models.tasks) {
            const snapshot = await models.tasks.read(id, signal);
            signal.throwIfAborted();
            verifiedLocalTask(snapshot, id, target);
            return localState(snapshot.status, snapshot.result);
        }
        const web = storage.pluginVideoTasks;
        if (!web) throw new PluginError("PLUGIN_OPERATION_FAILED");
        const receipt = await web.read(id, target);
        signal.throwIfAborted();
        if (receipt.state.status !== "pending") return receipt.state;
        const { task } = receipt.state;
        await Promise.all([channelWrites.flush(), callScriptsReady]);
        const config = useConfigStore.getState().config;
        if (await videoChannelFingerprint(config, task.model, handle.token) !== receipt.state.channelFingerprint) throw new PluginError("PLUGIN_TASK_UNAVAILABLE");
        signal.throwIfAborted();
        const query = await pollVideoGenerationTask(config, task, { signal });
        signal.throwIfAborted();
        if (query.status === "pending") {
            const latest = await web.read(id, target);
            signal.throwIfAborted();
            return latest.state.status === "pending" ? { status: "pending" } : latest.state;
        }
        let state: WebPluginVideoReceipt["state"] = { status: "failed" };
        let bytes: Blob | undefined;
        if (query.status === "completed") {
            const source = await resolveGeneratedVideo(query.result, signal);
            signal.throwIfAborted();
            if ("external" in source) {
                state = { status: "completed", result: { url: source.external.url, mimeType: source.external.mimeType } };
            } else {
                const asset = typeof source.input === "string" ? storedAssetFromUrl(source.input) : undefined;
                if (asset && asset.collection !== "media") throw new PluginError("PLUGIN_OPERATION_FAILED");
                const blob = typeof source.input === "string" ? await readMediaBlob(asset?.key, source.input, { signal }) : source.input;
                const metadata = await mediaBlobMetadata(blob, signal);
                state = { status: "completed", result: { storageKey: asset?.key ?? `video:${crypto.randomUUID()}`, mimeType: blob.type || "application/octet-stream", ...metadata } };
                if (!asset) bytes = blob;
            }
        } else if (query.status !== "failed") throw new PluginError("PLUGIN_OPERATION_FAILED");
        signal.throwIfAborted();
        const saved = await web.save({ id, target, state }, task, bytes);
        signal.throwIfAborted();
        if (saved.state.status === "pending") throw new PluginError("PLUGIN_OPERATION_FAILED");
        return saved.state;
    } catch (error) { throwTaskError(signal, error); }
}
