import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { executeModel as runModel, type SavedCallScripts } from "@infinite-canvas/model-runtime/execute";
import type { ScriptHost } from "@infinite-canvas/model-runtime/script";
import { uploadPublicMedia } from "@infinite-canvas/model-runtime/object-storage";
import { modelConnectionFingerprint } from "@infinite-canvas/shared/channels";
import { ModelExecutionError, type LocalModelRequest, type ModelAsset, type ModelSource } from "@infinite-canvas/shared/model-http";
import type { WorkspaceConfig } from "@infinite-canvas/shared/workspace-config";
import type { ModelCallUpstream } from "@infinite-canvas/shared/model-calls";
import type { FsStorage } from "../storage/fs-storage.js";
import { findChannelGroup } from "./channels.js";

export type RemoteVideo = { upstreamId: string; channelFingerprint: string; call: LocalModelRequest["call"] };
type TaskOptions = { taskId?: string; remote?: RemoteVideo; onUpstream?: (entry: ModelCallUpstream) => void };

export async function executeModel(storage: FsStorage, request: LocalModelRequest, signal: AbortSignal, onText: (text: string) => void, { taskId, remote, onUpstream }: TaskOptions = {}): Promise<ModelAsset | ModelAsset[] | string | RemoteVideo | { pending: true }> {
    if (remote && (!taskId || !remote.channelFingerprint)) throw new ModelExecutionError("MODEL_LOCAL_VIDEO_CONNECTION_UNVERIFIED");
    const { channel, group } = await findChannelGroup(storage, request.call.groupId);
    if (remote && remote.channelFingerprint !== await modelConnectionFingerprint(taskId!, channel, group)) throw new ModelExecutionError("MODEL_VIDEO_CONNECTION_CHANGED");
    const model = group.models.find((item) => item.name === request.call.model);
    if (!model || !group.apiKey || !channel.baseUrl) throw new ModelExecutionError("MODEL_CONFIG_MISSING");
    const capability = request.action === "video-query" ? "video" : request.action;
    if (model.capability !== capability || request.action !== "video-query" && model.scriptId !== request.call.scriptId) throw new ModelExecutionError("MODEL_CONFIG_MISSING");
    const config = { ...request.call, baseUrl: channel.baseUrl, apiKey: group.apiKey, agentSettings: model.agentSettings };
    const workspace = await storage.read<WorkspaceConfig>("privateConfig", "workspace");
    const savedScripts = await storage.read<{ state: SavedCallScripts }>("scripts", "state");
    const toBlob = async (source: string | Blob) => {
        signal.throwIfAborted();
        if (source instanceof Blob) return source;
        if (source.startsWith("asset:")) {
            const url = new URL(source);
            if (!["images", "media"].includes(url.hostname)) throw new ModelExecutionError("MODEL_REFERENCE_MISSING");
            const asset = await storage.openAsset(url.hostname, decodeURIComponent(url.pathname.slice(1)));
            if (!asset) throw new ModelExecutionError("MODEL_REFERENCE_MISSING");
            try { return new Blob([await asset.handle.readFile({ signal })], { type: asset.mime }); }
            finally { await asset.handle.close(); }
        }
        const response = await fetch(source, { signal });
        if (!response.ok) throw new ModelExecutionError("MODEL_REFERENCE_MISSING");
        return response.blob();
    };
    const toDataUrl = async (source: string | Blob) => {
        if (typeof source === "string" && source.startsWith("data:")) return source;
        const blob = await toBlob(source);
        return `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`;
    };
    const sourceUrl = (source: ModelSource) => {
        if ("collection" in source) return `asset://${source.collection}/${encodeURIComponent(source.key)}`;
        if (!["http:", "https:"].includes(new URL(source.url).protocol)) throw new ModelExecutionError("MODEL_REFERENCE_MISSING");
        return source.url;
    };
    const host: ScriptHost = {
        mapUrl: (url) => url, toBlob, toDataUrl,
        toPublicUrl: async (source) => {
            if (!workspace?.value) throw new ModelExecutionError("SCRIPT_STORAGE_REQUIRED");
            return uploadPublicMedia(source, workspace.value.objectStorage, toBlob, (url) => url, signal);
        },
    };
    const saveMedia = async (sources: (string | Blob)[], collection: ModelAsset["collection"], prefix: string): Promise<ModelAsset[]> => {
        signal.throwIfAborted();
        const files = sources.map(() => ({ collection, key: `${prefix}:${randomUUID()}` }));
        const results = await Promise.allSettled(sources.map(async (source, index) => {
            let blob: Blob;
            try { blob = await toBlob(source); }
            catch { signal.throwIfAborted(); throw new ModelExecutionError("MODEL_RESULT_MISSING"); }
            if (!blob.size || blob.type.includes("json") || blob.type.startsWith("text/")) throw new ModelExecutionError("MODEL_RESULT_MISSING");
            const bytes = Buffer.from(await blob.arrayBuffer());
            signal.throwIfAborted();
            const file = files[index];
            await storage.saveAsset(collection, file.key, Readable.from(bytes), blob.type, "models");
            return { ...file, mimeType: blob.type };
        }));
        signal.throwIfAborted();
        return results.map((item) => {
            if (item.status === "rejected") throw item.reason;
            return item.value;
        });
    };
    const scripts = savedScripts?.value?.state ?? { scripts: [], removedBuiltinIds: [], pluginScripts: [] };
    // 文本只记录摘要，图片、音频与视频记录实际发给模型服务的请求。
    const run = { config, scripts, signal, onDelta: onText, onUpstream: request.action === "text" ? undefined : onUpstream };
    if (request.action === "video-query") {
        if (!remote) throw new ModelExecutionError("MODEL_TASK_MISSING");
        const state = await runModel({ ...run, action: "video-query", call: remote.call, taskId: remote.upstreamId }, host);
        if (state.status === "pending") return { pending: true } as const;
        if (state.status === "failed") throw new ModelExecutionError("MODEL_TASK_FAILED", state.message);
        const [file] = await saveMedia([state.result.blob || state.result.url!], "media", "video");
        return file;
    }
    if (request.action === "video" && !taskId) throw new ModelExecutionError("MODEL_TASK_CONFLICT");
    const inputs = async () => ({
        images: request.images?.map(sourceUrl), videos: request.videos?.map(sourceUrl), audios: request.audios?.map(sourceUrl),
        messages: await Promise.all((request.messages || []).map(async (message) => ({
            role: message.role,
            content: typeof message.content === "string" ? message.content : await Promise.all(message.content.map(async (part) => part.type === "text" ? part : { type: "image_url", image_url: { url: "collection" in part.image_url ? await toDataUrl(sourceUrl(part.image_url)) : sourceUrl(part.image_url) } })),
        }))),
    });
    const generation = { ...run, call: request.call, prompt: request.prompt, options: request.options, inputs };
    if (request.action === "image") return saveMedia(await runModel({ ...generation, action: "image" }, host), "images", "image");
    if (request.action === "text") return runModel({ ...generation, action: "text" }, host);
    if (request.action === "audio") {
        const [file] = await saveMedia([await runModel({ ...generation, action: "audio" }, host)], "media", "audio");
        return file;
    }
    const video = await runModel({ ...generation, action: "video" }, host);
    if ("id" in video) return { upstreamId: video.id, channelFingerprint: await modelConnectionFingerprint(taskId!, channel, group), call: request.call } satisfies RemoteVideo;
    const [file] = await saveMedia([video.result.blob || video.result.url!], "media", "video");
    return file;
}
