import { network } from "@workbench/services/network/runtime";
import { executeModel } from "@infinite-canvas/model-runtime/execute";
import type { ModelCall } from "@infinite-canvas/shared/model-execution";
import { useCallScriptStore } from "@workbench/stores/use-call-script-store";
import { createBrowserScriptHost } from "../model-plugin";
import type { ModelAdapter, ModelRequestOptions } from "./types";
import { observeModels } from "./observe";
import { ModelExecutionError, modelErrorMessages, type ModelMediaInput } from "@infinite-canvas/shared/model-http";
import { imageToDataUrl } from "@workbench/services/image-storage";
import { readMediaBlob } from "@workbench/services/file-storage";

type ModelReference = { kind: "image"; media: ModelMediaInput } | { kind: "media"; media: ModelMediaInput; temporaryUrls: Map<string, Blob> };

async function readReferences(references: ModelReference[], signal?: AbortSignal) {
    signal?.throwIfAborted();
    const results = await Promise.allSettled(references.map(async (reference) => {
        signal?.throwIfAborted();
        const { media } = reference;
        let url = media.url;
        if (media.storageKey) {
            if (reference.kind === "image") url = await imageToDataUrl(media, { signal });
            else {
                const blob = await readMediaBlob(media.storageKey, media.url, { signal });
                signal?.throwIfAborted();
                url = URL.createObjectURL(blob);
                reference.temporaryUrls.set(url, blob);
            }
        }
        signal?.throwIfAborted();
        if (!url) throw new ModelExecutionError("MODEL_REFERENCE_MISSING");
        return url;
    }));
    signal?.throwIfAborted();
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {
        console.error("[models] read reference", failed.reason);
        throw new ModelExecutionError("MODEL_REFERENCE_MISSING");
    }
    return results.map((result) => (result as PromiseFulfilledResult<string>).value);
}

function browserRun(call: ModelCall, options?: ModelRequestOptions) {
    return { call, config: call, scripts: useCallScriptStore.getState(), signal: options?.signal, onUpstream: options?.onUpstream };
}

export function createBrowserModels(): ModelAdapter {
    return observeModels({
        async fetchText(config, protocol, url, init) {
            const target = network.url(url);
            try { return await fetch(target, init); }
            catch (error) {
                if (init?.signal?.aborted) throw error;
                throw new Error(target === url ? "TEXT_NETWORK_FAILED" : "TEXT_PROXY_FAILED", { cause: error });
            }
        },
        async generateImages({ call, images, ...request }, options) {
            return executeModel({ ...browserRun(call, options), ...request, action: "image", inputs: async (signal) => ({
                images: await readReferences(images.map((media) => ({ media, kind: "image" as const })), signal),
            }) }, createBrowserScriptHost(options?.signal));
        },
        async generateText({ call, messages }, { signal, onEvent }) {
            return executeModel({ ...browserRun(call, { signal }), action: "text", onDelta: (text) => onEvent({ type: "text", text }), inputs: async (signal) => {
                const images = await readReferences(messages.flatMap((message) => typeof message.content === "string" ? [] : message.content.flatMap((part) => part.type === "image_url" ? [{ media: part.image_url, kind: "image" as const }] : [])), signal);
                let index = 0;
                return { messages: messages.map((message) => typeof message.content === "string" ? message : { ...message, content: message.content.map((part) => part.type === "image_url" ? { ...part, image_url: { url: images[index++] } } : part) }) };
            } }, createBrowserScriptHost(signal));
        },
        async generateAudio({ call, ...request }, options) {
            return executeModel({ ...browserRun(call, options), ...request, action: "audio" }, createBrowserScriptHost(options?.signal));
        },
        async createVideoTask({ call, images, videos, audios, ...request }, options) {
            const temporaryUrls = new Map<string, Blob>();
            try {
                const submission = await executeModel({ ...browserRun(call, options), ...request, action: "video", inputs: async (signal) => {
                    const sources = await readReferences([
                        ...images.map((media) => ({ media, kind: "image" as const })),
                        ...(videos?.map((media) => ({ media, kind: "media" as const, temporaryUrls })) ?? []),
                        ...(audios?.map((media) => ({ media, kind: "media" as const, temporaryUrls })) ?? []),
                    ], signal);
                    const audioIndex = images.length + (videos?.length ?? 0);
                    return { images: sources.slice(0, images.length), videos: videos && sources.slice(images.length, audioIndex), audios: audios && sources.slice(audioIndex) };
                } }, createBrowserScriptHost(options?.signal));
                if ("id" in submission) return submission;
                const inputBlob = submission.result.url && temporaryUrls.get(submission.result.url);
                return inputBlob ? { result: { blob: inputBlob } } : submission;
            } finally {
                for (const url of temporaryUrls.keys()) URL.revokeObjectURL(url);
            }
        },
        async queryVideoTask({ call, taskId }, options) {
            const state = await executeModel({ ...browserRun(call, options), action: "video-query", taskId }, createBrowserScriptHost(options?.signal));
            return state.status === "failed" ? { status: "failed", error: state.message ?? modelErrorMessages.MODEL_TASK_FAILED } : state;
        },
    });
}

