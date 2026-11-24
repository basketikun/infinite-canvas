import { createParser } from "eventsource-parser";
import { assertModelTaskTarget, modelAssetUrl, modelErrorMessages, ModelExecutionError, type LocalModelRequest, type ModelAsset, type ModelErrorCode, type ModelMediaInput, type ModelSource, type ModelStreamEvent, type ModelTask } from "@infinite-canvas/shared/model-http";
import type { ModelCall, ModelTextEvent } from "@infinite-canvas/shared/model-execution";
import { storage } from "@workbench/services/storage/runtime";
import { storedAssetFromUrl } from "@workbench/lib/media-source";
import { channelWrites } from "@workbench/stores/use-config-store";
import { workspaceConfigWrites } from "@workbench/stores/use-workspace-config-store";
import { callScriptsSaved } from "@workbench/stores/use-call-script-store";
import type { ModelAdapter, ModelRequestOptions } from "./types";
import { observeModels } from "./observe";

async function taskRequest(url: string, init: RequestInit) {
    try {
        const response = await fetch(url, init);
        if (response.ok) return response;
        const { error } = await response.json();
        throw Object.hasOwn(modelErrorMessages, error.code) ? new ModelExecutionError(error.code, error.message) : new ModelExecutionError("MODEL_UNAVAILABLE");
    } catch (error) {
        init.signal?.throwIfAborted();
        throw error instanceof ModelExecutionError ? error : new ModelExecutionError("MODEL_UNAVAILABLE");
    }
}

async function readTaskResponse(url: string, init: RequestInit): Promise<ModelTask> {
    const response = await taskRequest(url, init);
    return response.json().catch(() => {
        init.signal?.throwIfAborted();
        throw new ModelExecutionError("MODEL_UNAVAILABLE");
    });
}

type TaskWatcher = { taskId: string; revision: string; resolve: (task: ModelTask) => void; reject: (reason: unknown) => void };
const watchers = new Set<TaskWatcher>();
let polling: AbortController | undefined;

// 所有生成共用一个长轮询，批量任务不会占满页面查询、素材与 MCP 需要的连接。
async function pollChanges() {
    if (polling) {
        polling.abort();
        return;
    }
    while (watchers.size) {
        const batch = [...watchers];
        const controller = new AbortController();
        polling = controller;
        try {
            const snapshot = await readTaskResponse("/api/models/task/changes", {
                method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
                body: JSON.stringify(batch.map(({ taskId, revision }) => ({ taskId, revision }))),
            });
            for (const item of batch) {
                if (item.taskId === snapshot.taskId && watchers.delete(item)) item.resolve(snapshot);
            }
        } catch (error) {
            if (!controller.signal.aborted) {
                for (const item of batch) if (watchers.delete(item)) item.reject(error);
            }
        } finally {
            polling = undefined;
        }
    }
}

async function waitForChange(task: ModelTask, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const { promise, resolve, reject } = Promise.withResolvers<ModelTask>();
    const watcher = { taskId: task.taskId, revision: task.revision, resolve, reject };
    watchers.add(watcher);
    const abort = () => {
        watchers.delete(watcher);
        reject(signal?.reason);
        polling?.abort();
    };
    signal?.addEventListener("abort", abort, { once: true });
    void pollChanges();
    try { return await promise; } finally { signal?.removeEventListener("abort", abort); }
}

const tasks: NonNullable<ModelAdapter["tasks"]> = {
    read(taskId, signal) {
        return readTaskResponse(`/api/models/task/${encodeURIComponent(taskId)}`, { signal });
    },
    async wait(taskId, { signal, onText, resume, target, onTerminalFailure } = {}) {
        let snapshot = await tasks.read(taskId, signal);
        assertModelTaskTarget(snapshot, taskId, target);
        if (resume && snapshot.status === "paused") {
            signal?.throwIfAborted();
            await taskRequest(`/api/models/task/${encodeURIComponent(taskId)}/resume`, { method: "POST", signal });
            snapshot = await tasks.read(taskId, signal);
        }
        let previousText: string | undefined;
        for (;;) {
            signal?.throwIfAborted();
            assertModelTaskTarget(snapshot, taskId, target);
            if (snapshot.text !== undefined && snapshot.text !== previousText) {
                previousText = snapshot.text;
                onText?.(snapshot.text, snapshot);
            }
            if (snapshot.status === "completed") return snapshot;
            if (snapshot.status !== "running") {
                if (snapshot.status === "failed" || snapshot.status === "interrupted" || snapshot.status === "cancelled") onTerminalFailure?.(snapshot);
                throw new ModelExecutionError(snapshot.code!, snapshot.message);
            }
            snapshot = await waitForChange(snapshot, signal);
        }
    },
    async cancel(taskId, target, signal) {
        if (target) {
            const snapshot = await tasks.read(taskId, signal);
            assertModelTaskTarget(snapshot, taskId, target);
            if (snapshot.status !== "running") return snapshot;
        }
        signal?.throwIfAborted();
        await taskRequest(`/api/models/task/${encodeURIComponent(taskId)}/cancel`, { method: "POST", signal });
        if (target) {
            const result = await tasks.read(taskId, signal);
            assertModelTaskTarget(result, taskId, target);
            return result;
        }
    },
};

export function createHttpModels(): ModelAdapter {
    async function source(input: ModelMediaInput, collection: "images" | "media", signal?: AbortSignal): Promise<ModelSource> {
        signal?.throwIfAborted();
        if (input.storageKey) return { collection, key: input.storageKey };
        if (!input.url) throw new ModelExecutionError("MODEL_REFERENCE_MISSING");
        const saved = storedAssetFromUrl(input.url);
        if (saved) return saved;
        if (/^https?:/.test(input.url)) return { url: input.url };
        if (!/^(blob:|data:)/.test(input.url)) throw new ModelExecutionError("MODEL_REFERENCE_MISSING");
        try {
            const response = await fetch(input.url, { signal });
            if (!response.ok) throw new ModelExecutionError("MODEL_REFERENCE_MISSING");
            const key = `reference:${crypto.randomUUID()}`;
            await storage[collection].setItem(key, await response.blob());
            signal?.throwIfAborted();
            return { collection, key };
        } catch {
            signal?.throwIfAborted();
            throw new ModelExecutionError("MODEL_REFERENCE_MISSING");
        }
    }
    async function execute<T>(action: LocalModelRequest["action"], call: ModelCall, payload: Omit<LocalModelRequest, "action" | "call">, options?: ModelRequestOptions & { onEvent?: (event: ModelTextEvent) => void }): Promise<T> {
        const { groupId, model, scriptId, script, systemPrompt, reasoningEffort } = call;
        try {
            await Promise.all([channelWrites.flush(), callScriptsSaved, workspaceConfigWrites.flush()]);
            options?.signal?.throwIfAborted();
            if (options?.taskId || action === "video") {
                const taskId = options?.taskId ?? crypto.randomUUID();
                await options?.beforeSubmit?.();
                options?.signal?.throwIfAborted();
                const submission = readTaskResponse("/api/models/task", {
                    method: "POST", headers: { "content-type": "application/json" },
                    body: JSON.stringify({ taskId, target: options?.target, request: { action, call: { groupId, model, scriptId, script, systemPrompt, reasoningEffort }, ...payload } }),
                }).then((snapshot) => { assertModelTaskTarget(snapshot, taskId, options?.target); return snapshot; });
                options?.onTaskSubmission?.(submission);
                let submitted = await submission;
                if (!options?.onTaskSubmission && options?.signal?.aborted && options.signal.reason?.message === "task-stop") await tasks.cancel(taskId, options?.target);
                options?.signal?.throwIfAborted();
                const reportUpstream = (task: ModelTask) => task.upstream?.forEach((entry) => options?.onUpstream?.(entry));
                if (action === "video") {
                    // 等本地服务完成提交，调用记录才能带上实际请求；提交失败时与网页模式一样直接报错。
                    while (submitted.status === "running" && !submitted.upstream) submitted = await waitForChange(submitted, options?.signal);
                    reportUpstream(submitted);
                    if (submitted.status === "failed") throw new ModelExecutionError(submitted.code!, submitted.message);
                    return { id: taskId } as T;
                }
                const snapshot = await tasks.wait(taskId, {
                    signal: options?.signal, target: options?.target,
                    onTerminalFailure: (task) => { reportUpstream(task); options?.onTerminal?.(); },
                    onText: (text) => options?.onEvent?.({ type: "text", text }),
                });
                reportUpstream(snapshot);
                return snapshot.result as T;
            }
            const response = await fetch("/api/models/execute", {
                method: "POST", headers: { "content-type": "application/json" }, signal: options?.signal,
                body: JSON.stringify({ action, call: { groupId, model, scriptId, script, systemPrompt, reasoningEffort }, ...payload } satisfies LocalModelRequest),
            });
            if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) throw new ModelExecutionError("MODEL_UNAVAILABLE");
            let completed = false;
            let result: T;
            const parser = createParser({ onEvent: ({ data }) => {
                const event = JSON.parse(data) as ModelStreamEvent<T>;
                if (event.type === "error") throw Object.hasOwn(modelErrorMessages, event.code) ? new ModelExecutionError(event.code, event.message) : new ModelExecutionError("MODEL_FAILED");
                if (event.type === "text") options?.onEvent?.(event);
                if (event.type === "upstream") event.upstream.forEach((entry) => options?.onUpstream?.(entry));
                if (event.type === "result") { completed = true; result = event.result; }
            } });
            const reader = response.body!.getReader();
            const decoder = new TextDecoder();
            try {
                for (;;) {
                    const chunk = await reader.read();
                    if (chunk.done) break;
                    parser.feed(decoder.decode(chunk.value, { stream: true }));
                }
                parser.feed(decoder.decode());
                parser.reset({ consume: true });
            } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
            options?.signal?.throwIfAborted();
            if (!completed) throw new ModelExecutionError("MODEL_UNAVAILABLE");
            return result!;
        } catch (error) {
            options?.signal?.throwIfAborted();
            throw error instanceof ModelExecutionError ? error : new ModelExecutionError("MODEL_UNAVAILABLE");
        }
    }
    return observeModels({
        tasks,
        async generateImages(request, options) {
            const images = await Promise.all(request.images.map((image) => source(image, "images", options?.signal)));
            return (await execute<ModelAsset[]>("image", request.call, { prompt: request.prompt, images, options: request.options }, options)).map(modelAssetUrl);
        },
        async generateAudio(request, options) {
            return modelAssetUrl(await execute<ModelAsset>("audio", request.call, { prompt: request.prompt, options: request.options }, options));
        },
        async generateText(request, options) {
            const messages = await Promise.all(request.messages.map(async (message) => ({
                role: message.role,
                content: typeof message.content === "string" ? message.content : await Promise.all(message.content.map(async (part) => part.type === "text" ? part : { type: "image_url" as const, image_url: await source(part.image_url, "images", options.signal) })),
            })));
            return execute<string>("text", request.call, { messages }, options);
        },
        async createVideoTask(request, options) {
            const [images, videos, audios] = await Promise.all([
                Promise.all(request.images.map((image) => source(image, "images", options?.signal))),
                Promise.all((request.videos || []).map((video) => source(video, "media", options?.signal))),
                Promise.all((request.audios || []).map((audio) => source(audio, "media", options?.signal))),
            ]);
            return execute<{ id: string }>("video", request.call, { prompt: request.prompt, images, videos, audios, options: request.options }, options);
        },
        async queryVideoTask(request, options) {
            const task = await tasks.wait(request.taskId, { signal: options?.signal, target: options?.target, onTerminalFailure: options?.onTerminal });
            const asset = task.result as ModelAsset;
            return { status: "completed", result: { url: modelAssetUrl(asset), mimeType: asset.mimeType } };
        },
        async fetchText(config, protocol, url, init) {
            await channelWrites.flush();
            const headers = new Headers(init?.headers);
            const protocolHeaders = Object.fromEntries(["anthropic-version", "anthropic-beta", "openai-beta"].filter((name) => headers.has(name)).map((name) => [name, headers.get(name)!]));
            try {
                return await fetch("/api/models/agent", {
                    method: "POST", headers: { "content-type": "application/json" }, signal: init?.signal,
                    body: JSON.stringify({ groupId: config.groupId, model: config.model, protocol, protocolHeaders, stream: protocol === "gemini" ? new URL(url).searchParams.get("alt") === "sse" : Boolean(JSON.parse(init!.body as string).stream), body: JSON.parse(init!.body as string) }),
                });
            } catch {
                init?.signal?.throwIfAborted();
                throw new ModelExecutionError("MODEL_UNAVAILABLE");
            }
        },
    });
}
