import { network } from "@workbench/services/network/runtime";
import { ToolLoopAgent, wrapLanguageModel, type ModelMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

import { models } from "./models/runtime";
import { modelCallMiddleware } from "./models/observe-text";
import type { TextAgentProtocol } from "@infinite-canvas/shared/model-execution";
import { isChatImageKey } from "@infinite-canvas/shared/chat";
import type { RunPluginArgs } from "./model-plugin";
import { compactAgentContext } from "./agent-context";
import { getImageBlob } from "@workbench/services/image-storage";

export type TextAgentSettings = Pick<ConstructorParameters<typeof ToolLoopAgent>[0], "providerOptions" | "maxOutputTokens">;

export type TextAgentResult = { text: string; messages: ModelMessage[] };

/**
 * Chat Completions 兼容服务（如 DeepSeek）把思考放在 delta.reasoning_content，
 * OpenAI 提供方会丢弃该字段，这里旁路复制一份原始流并转发思考增量。
 */
function reasoningText(value: unknown, depth = 0): string {
    if (!value || typeof value !== "object" || depth > 6) return "";
    if (Array.isArray(value)) {
        for (const item of value) { const text = reasoningText(item, depth + 1); if (text) return text; }
        return "";
    }
    const record = value as Record<string, unknown>;
    for (const key of ["reasoning_content", "reasoning_text"]) {
        if (typeof record[key] === "string" && record[key]) return record[key] as string;
    }
    for (const child of Object.values(record)) { const text = reasoningText(child, depth + 1); if (text) return text; }
    return "";
}

function forwardReasoning(response: Response, onDelta: (text: string) => void) {
    if (!response.body) return response;
    const [body, monitor] = response.body.tee();
    void (async () => {
        const reader = monitor.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let index = buffer.indexOf("\n\n");
                while (index >= 0) {
                    const event = buffer.slice(0, index);
                    buffer = buffer.slice(index + 2);
                    for (const line of event.split("\n")) {
                        if (!line.startsWith("data:")) continue;
                        const payload = line.slice(5).trim();
                        if (!payload || payload === "[DONE]") continue;
                        try {
                            const event = JSON.parse(payload) as { type?: unknown; delta?: unknown };
                            // DeepSeek 的 Responses 用 response.reasoning_text.delta 返回思考正文，AI SDK 只处理摘要事件，会丢掉它。
                            const text = event.type === "response.reasoning_text.delta" && typeof event.delta === "string" ? event.delta : reasoningText(event);
                            if (text) onDelta(text);
                        } catch { /* 忽略非 JSON 心跳 */ }
                    }
                    index = buffer.indexOf("\n\n");
                }
            }
        } catch (error) {
            if (!(error instanceof DOMException && error.name === "AbortError")) console.error("[text-agent] reasoning stream", error);
        } finally {
            reader.releaseLock();
        }
    })();
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/**
 * 使用成熟 SDK 处理流式文本、工具参数和各协议的推理上下文。
 */
export async function runTextAgent(protocol: TextAgentProtocol, args: RunPluginArgs, settings: TextAgentSettings = {}): Promise<TextAgentResult> {
    const { config, signal } = args;
    const address = new URL(config.baseUrl);
    const version = protocol === "gemini" ? "v1beta" : "v1";
    if (!/\/v1(?:beta)?\/?$/.test(address.pathname)) address.pathname += `${address.pathname.endsWith("/") ? "" : "/"}${version}`;
    const options = {
        apiKey: config.apiKey,
        baseURL: address.href.replace(/\/$/, ""),
        fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
            const response = await models.fetchText(config, protocol, String(url), init);
            return (protocol === "chat-completions" || protocol === "responses") && args.onReasoningDelta ? forwardReasoning(response, args.onReasoningDelta) : response;
        },
    };
    const baseModel = protocol === "gemini" ? createGoogleGenerativeAI(options)(config.model)
        : protocol === "anthropic" ? createAnthropic({ ...options, headers: { "anthropic-dangerous-direct-browser-access": "true" } })(config.model)
        : protocol === "responses" ? createOpenAI(options).responses(config.model)
        : createOpenAI(options).chat(config.model);
    const model = args.tools ? wrapLanguageModel({ model: baseModel, middleware: modelCallMiddleware(config, "chat") }) : baseModel;
    const summaryModel = wrapLanguageModel({ model: baseModel, middleware: modelCallMiddleware(config, "summary") });
    if (args.compactContext) {
        await compactAgentContext(summaryModel, args.messages as ModelMessage[], args);
        return { text: "", messages: [] };
    }
    const agent = new ToolLoopAgent({
        model,
        allowSystemInMessages: true,
        tools: args.tools,
        // 沿用原先的串行执行方式；调用方可以指定在某个工具后暂停，不额外设置轮次上限。
        stopWhen: args.stopWhen ?? [],
        toolCallConcurrency: 1,
        onStepStart: args.onAgentStepStart,
        onStepEnd: args.onAgentStepEnd,
        maxRetries: 0,
        maxOutputTokens: settings.maxOutputTokens,
        prepareStep: async ({ messages, steps }) => {
            signal?.throwIfAborted();
            const usage = steps.at(-1)?.usage;
            const contextTokens = steps.length ? usage?.inputTokens !== undefined && usage.outputTokens !== undefined ? usage.inputTokens + usage.outputTokens : undefined : args.contextTokens;
            if (config.agentSettings?.contextWindow && config.agentSettings.autoCompact !== false && contextTokens !== undefined && contextTokens >= config.agentSettings.contextWindow * 0.8) {
                return { messages: await compactAgentContext(summaryModel, messages, args) };
            }
        },
        experimental_download: async (requests) => Promise.all(requests.map(async ({ url, isUrlSupportedByModel }) => {
            signal?.throwIfAborted();
            if (isChatImageKey(url.href)) {
                const blob = await getImageBlob(url.href);
                if (!blob) throw new Error("CHAT_REFERENCE_MISSING");
                return { data: new Uint8Array(await blob.arrayBuffer()), mediaType: blob.type };
            }
            if (isUrlSupportedByModel) return null;
            const response = await fetch(network.url(url.href), { signal });
            if (!response.ok) throw new Error("CHAT_REFERENCE_MISSING");
            return { data: new Uint8Array(await response.arrayBuffer()), mediaType: response.headers.get("content-type") ?? undefined };
        })),
        providerOptions: settings.providerOptions,
    });
    const result = await agent.stream({ messages: args.messages as ModelMessage[], abortSignal: signal });
    let text = "";
    for await (const event of result.fullStream) {
        if (event.type === "error") throw event.error;
        args.onAgentEvent?.(event);
        if (event.type === "text-delta") {
            text += event.text;
            args.onDelta?.(text);
        }
    }
    signal?.throwIfAborted();
    const finishReason = await result.finishReason;
    if (finishReason === "length" || finishReason === "content-filter" || finishReason === "error") throw new Error("TEXT_INCOMPLETE");
    return { text: await result.text, messages: await result.responseMessages };
}
