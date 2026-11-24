import type { ModelExecutionConfig } from "@infinite-canvas/shared/model-execution";
import type { ModelCallFinished, ModelCallKind, ModelCallRequest, ModelCallResponse, ModelCallStarted, ModelCallUpstream, ModelCallUsage } from "@infinite-canvas/shared/model-calls";
import { ModelExecutionError, modelErrorMessages } from "@infinite-canvas/shared/model-http";
import { emitPluginEvent } from "@workbench/lib/plugins/runtime";
import { findModelGroup, useConfigStore } from "@workbench/stores/use-config-store";
import type { ModelAdapter } from "./types";

/**
 * 只发布调用元信息；插件监听与存储失败不能改变模型调用结果。
 */
export function startModelCall(kind: ModelCallKind, config: ModelExecutionConfig, signal?: AbortSignal, request?: ModelCallRequest) {
    const target = config.groupId ? findModelGroup(useConfigStore.getState().config.channels, config.groupId) : undefined;
    const started: ModelCallStarted = {
        id: crypto.randomUUID(), kind, model: config.model, startedAt: Date.now(),
        channelId: target?.channel.id, channelName: target?.channel.name,
        groupId: config.groupId, groupName: target?.group.name,
        ...(request && { request }),
    };
    const clock = performance.now();
    let finished = false;
    emitPluginEvent("model.call.started", started);
    const finish = (status: ModelCallFinished["status"], usage?: ModelCallUsage, errorMessage?: string, errorCode?: string, response?: ModelCallResponse, upstream?: ModelCallUpstream[]) => {
        if (finished) return;
        finished = true;
        emitPluginEvent("model.call.finished", {
            ...started, status: signal?.aborted ? "cancelled" : status,
            finishedAt: Date.now(), durationMs: performance.now() - clock, usage, errorMessage, errorCode, response,
            ...(upstream && { upstream }),
        });
    };
    return {
        finish,
        fail(error: unknown, upstream?: ModelCallUpstream[]) {
            const cancelled = signal?.aborted || (error instanceof Error && ["AbortError", "CanceledError"].includes(error.name));
            const modelError = error instanceof ModelExecutionError ? error : undefined;
            finish(
                cancelled ? "cancelled" : "failed",
                undefined,
                cancelled ? undefined : modelError ? modelError.message : modelErrorMessages.MODEL_FAILED,
                cancelled ? undefined : modelError?.code,
                undefined,
                upstream,
            );
        },
    };
}

/** 只保留文本和类型标记，避免把图片数据和工具快照写进调用记录。 */
export function summarizeMessages(messages: readonly { role: string; content: string | readonly unknown[] }[]) {
    return messages.map((message) => ({
        role: message.role,
        content: typeof message.content === "string"
            ? message.content
            : message.content.map((part) => {
                const value = part as { type?: string; text?: string; toolName?: string };
                if (value.type === "text" && typeof value.text === "string") return value.text;
                if (value.type === "tool-call") return `[调用工具${value.toolName ? ` ${value.toolName}` : ""}]`;
                if (value.type === "tool-result") return "[工具结果]";
                if (value.type === "reasoning") return "[思考]";
                return "[附件]";
            }).join("\n"),
    }));
}

export function observeModels(adapter: ModelAdapter): ModelAdapter {
    const run = async <T>(
        kind: ModelCallKind,
        config: ModelExecutionConfig,
        signal: AbortSignal | undefined,
        request: ModelCallRequest | undefined,
        describe: (result: T) => ModelCallResponse | undefined,
        action: (onUpstream?: (entry: ModelCallUpstream) => void) => Promise<T>,
    ) => {
        const call = startModelCall(kind, config, signal, request);
        // 文本只记录摘要；图片、音频与视频保留实际发给模型服务的请求。
        const upstream: ModelCallUpstream[] = [];
        try {
            const result = await action(kind === "text" ? undefined : (entry) => upstream.push(entry));
            const failed = kind === "video-query" && (result as { status: string }).status === "failed";
            call.finish(failed ? "failed" : "success", undefined, failed ? modelErrorMessages.MODEL_TASK_FAILED : undefined, failed ? "MODEL_TASK_FAILED" : undefined, failed ? undefined : describe(result), kind === "text" ? undefined : upstream);
            return result;
        } catch (error) {
            call.fail(error, kind === "text" ? undefined : upstream);
            throw error;
        }
    };
    return {
        ...adapter,
        generateImages: (request, options) => run("image", request.call, options?.signal,
            { prompt: request.prompt, images: request.images.length, options: { ...request.options } },
            (images) => ({ images: images.length }),
            (onUpstream) => adapter.generateImages(request, { ...options, onUpstream })),
        generateText: (request, options) => run("text", request.call, options.signal,
            { messages: summarizeMessages(request.messages) },
            (text) => ({ text }),
            () => adapter.generateText(request, options)),
        generateAudio: (request, options) => run("audio", request.call, options?.signal,
            { prompt: request.prompt, options: { ...request.options } },
            () => ({ audio: true }),
            (onUpstream) => adapter.generateAudio(request, { ...options, onUpstream })),
        createVideoTask: (request, options) => run("video", request.call, options?.signal,
            { prompt: request.prompt, images: request.images.length, videos: request.videos?.length, audios: request.audios?.length, options: { ...request.options } },
            (result) => ({ video: { ...("id" in result ? { taskId: result.id } : {}), completed: !("id" in result) } }),
            (onUpstream) => adapter.createVideoTask(request, { ...options, onUpstream })),
        queryVideoTask: adapter.tasks ? adapter.queryVideoTask : (request, options) => run("video-query", request.call, options?.signal,
            { taskId: request.taskId },
            (result) => ({ taskStatus: result.status }),
            (onUpstream) => adapter.queryVideoTask(request, { ...options, onUpstream })),
    };
}
