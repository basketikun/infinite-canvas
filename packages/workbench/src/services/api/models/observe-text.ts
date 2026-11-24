import type { LanguageModelMiddleware } from "ai";
import type { ModelExecutionConfig } from "@infinite-canvas/shared/model-execution";
import type { ModelCallRequest } from "@infinite-canvas/shared/model-calls";
import { modelErrorMessages } from "@infinite-canvas/shared/model-http";
import { startModelCall, summarizeMessages } from "./observe";

type TextResult = {
    finishReason: { unified: string };
    usage: { inputTokens: { total: number | undefined }; outputTokens: { total: number | undefined } };
};

function requestOf(params: { prompt?: unknown; tools?: unknown }): ModelCallRequest | undefined {
    const messages = Array.isArray(params.prompt) ? summarizeMessages(params.prompt as { role: string; content: string | readonly unknown[] }[]) : undefined;
    const tools = Array.isArray(params.tools) ? params.tools.flatMap((item) => typeof (item as { name?: unknown }).name === "string" ? [(item as { name: string }).name] : []) : undefined;
    if (!messages?.length && !tools?.length) return undefined;
    return { ...(messages?.length && { messages }), ...(tools?.length && { tools }) };
}

function responseText(result: { content?: unknown }) {
    if (!Array.isArray(result.content)) return undefined;
    const text = result.content.map((part) => {
        const value = part as { type?: string; text?: string };
        return value.type === "text" && typeof value.text === "string" ? value.text : "";
    }).join("");
    return text || undefined;
}

function finishTextCall(call: ReturnType<typeof startModelCall>, result: TextResult, text?: string) {
    const success = !["length", "content-filter", "error", "interrupted"].includes(result.finishReason.unified);
    call.finish(success ? "success" : "failed", {
        inputTokens: result.usage.inputTokens.total,
        outputTokens: result.usage.outputTokens.total,
    }, success ? undefined : modelErrorMessages.SCRIPT_TEXT_INCOMPLETE, success ? undefined : "SCRIPT_TEXT_INCOMPLETE", success && text !== undefined ? { text } : undefined);
}

/**
 * 在 SDK 已解析的每轮结果上统计，工具执行不计入模型耗时，流中错误也不能视为成功。
 */
export function modelCallMiddleware(config: ModelExecutionConfig, kind: "chat" | "summary"): LanguageModelMiddleware {
    return {
        async wrapGenerate({ doGenerate, params }) {
            const call = startModelCall(kind, config, params.abortSignal, requestOf(params));
            try {
                const result = await doGenerate();
                finishTextCall(call, result, responseText(result));
                return result;
            } catch (error) {
                call.fail(error);
                throw error;
            }
        },
        async wrapStream({ doStream, params }) {
            const call = startModelCall(kind, config, params.abortSignal, requestOf(params));
            try {
                const result = await doStream();
                const reader = result.stream.getReader();
                let ended = false;
                let text = "";
                const abort = () => call.finish("cancelled");
                params.abortSignal?.addEventListener("abort", abort, { once: true });
                if (params.abortSignal?.aborted) abort();
                const release = () => {
                    params.abortSignal?.removeEventListener("abort", abort);
                    reader.releaseLock();
                };
                return { ...result, stream: new ReadableStream({
                    async pull(controller) {
                        try {
                            const chunk = await reader.read();
                            if (chunk.done) {
                                if (!ended) call.finish("failed", undefined, modelErrorMessages.SCRIPT_TEXT_INCOMPLETE, "SCRIPT_TEXT_INCOMPLETE");
                                release();
                                controller.close();
                                return;
                            }
                            if (chunk.value.type === "text-delta") {
                                const delta = (chunk.value as { delta?: unknown }).delta;
                                if (typeof delta === "string") text += delta;
                            } else if (chunk.value.type === "finish") {
                                ended = true;
                                finishTextCall(call, chunk.value, text || undefined);
                            } else if (chunk.value.type === "error") call.fail(chunk.value.error);
                            controller.enqueue(chunk.value);
                        } catch (error) {
                            call.fail(error);
                            release();
                            controller.error(error);
                        }
                    },
                    async cancel(reason) {
                        call.finish("cancelled");
                        try { await reader.cancel(reason); } finally { release(); }
                    },
                }) };
            } catch (error) {
                call.fail(error);
                throw error;
            }
        },
    };
}
