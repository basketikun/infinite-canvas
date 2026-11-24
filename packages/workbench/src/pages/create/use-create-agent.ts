import { useCallback, useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { channelWrites, getModelConfigIssue, resolveModelRequestConfig, type AiConfig } from "@workbench/stores/use-config-store";
import { callScriptsReady } from "@workbench/stores/use-call-script-store";
import type { AgentTokenUsage } from "@workbench/lib/agent/agent-chat-usage";
import { runModelCall } from "@workbench/services/api/model-plugin";
import { hasToolCall, type ModelMessage } from "ai";
import type { TextAgentResult } from "@workbench/services/api/text-agent";
import type { ReferenceImage } from "@workbench/types/image";
import { agentTitle, deleteAgentThread, readAgentThreads, saveAgentThread, type CreateAgentItem, type CreateAgentThread } from "@workbench/services/create/agent-logs";
import { createAgentSystemPrompt, createCreateAgentTools } from "./create-agent-tools";

type SendOptions = { references: ReferenceImage[] };
type RunOptions = SendOptions & { visible?: boolean; notice?: string };

function usageOf(usage: { inputTokens?: number; outputTokens?: number; outputTokenDetails?: { reasoningTokens?: number }; inputTokenDetails?: { cacheReadTokens?: number } }): AgentTokenUsage {
    return {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
        cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens,
    };
}

function safeOutput(output: unknown) {
    try {
        const text = JSON.stringify(output);
        return text.length > 24000 ? `${text.slice(0, 24000)}…` : text;
    } catch {
        return String(output);
    }
}

/**
 * 创作页 Agent 会话：复用文本模型的工具循环，生成结果继续写入普通创作记录。
 */
export function useCreateAgent({ config, openConfigDialog }: {
    config: AiConfig;
    openConfigDialog: (shouldPromptContinue?: boolean) => void;
}) {
    const [threads, setThreads] = useState<CreateAgentThread[]>([]);
    const [ready, setReady] = useState(false);
    const [runningSession, setRunningSession] = useState<string | null>(null);
    const [compacting, setCompacting] = useState(false);
    const threadsRef = useRef<CreateAgentThread[]>([]);
    const runRef = useRef<AbortController | null>(null);
    const removedRef = useRef(new Set<string>());

    useEffect(() => {
        const controller = new AbortController();
        void readAgentThreads(controller.signal).then((loaded) => {
            if (controller.signal.aborted) return;
            threadsRef.current = loaded;
            setThreads(loaded);
            setReady(true);
        }).catch((error) => {
            if (controller.signal.aborted) return;
            console.error("[create-agent] read threads", error);
            setReady(true);
        });
        return () => controller.abort();
    }, []);

    useEffect(() => () => runRef.current?.abort(), []);

    const commit = useCallback((thread: CreateAgentThread, persist: boolean) => {
        if (removedRef.current.has(thread.id)) return;
        threadsRef.current = [thread, ...threadsRef.current.filter((item) => item.id !== thread.id)];
        setThreads(threadsRef.current);
        if (persist) void saveAgentThread(thread).catch((error) => console.error("[create-agent] save thread", error));
    }, []);

    const patchItem = useCallback((sessionId: string, itemId: string, updater: (item: CreateAgentItem) => CreateAgentItem) => {
        const current = threadsRef.current.find((thread) => thread.id === sessionId);
        if (!current) return;
        commit({ ...current, items: current.items.map((item) => item.id === itemId ? updater(item) : item), updatedAt: Date.now() }, true);
    }, [commit]);

    const send = useCallback(async (sessionId: string, prompt: string, options: RunOptions) => {
        const text = prompt.trim();
        if (!text || runRef.current) return;
        const current = threadsRef.current.find((item) => item.id === sessionId);
        const entry: CreateAgentItem = options.visible === false
            ? { id: nanoid(), role: "notice", text: options.notice || "继续执行后续步骤。", createdAt: Date.now() }
            : { id: nanoid(), role: "user", text, createdAt: Date.now() };
        const items: CreateAgentItem[] = [...(current?.items ?? []), entry];
        const messages: ModelMessage[] = [...(current?.messages ?? []), { role: "user", content: text }];
        const now = Date.now();
        const thread: CreateAgentThread = {
            id: sessionId,
            title: current?.title || agentTitle(text),
            createdAt: current?.createdAt ?? now,
            updatedAt: now,
            items,
            messages,
            contextTokens: current?.contextTokens,
        };
        let latest = thread;
        const update = (nextItems: CreateAgentItem[], nextMessages = latest.messages) => {
            latest = { ...latest, items: nextItems, messages: nextMessages, updatedAt: Date.now() };
            commit(latest, false);
        };
        commit(thread, true);

        const controller = new AbortController();
        runRef.current = controller;
        setRunningSession(sessionId);
        const { signal } = controller;
        const toolItemIds = new Map<string, string>();
        let assistantId = "";
        let pendingReasoning = "";
        try {
            await Promise.all([callScriptsReady, channelWrites.flush()]);
            signal.throwIfAborted();
            if (getModelConfigIssue(config, config.textModel)) {
                openConfigDialog(true);
                throw new Error("TEXT_CONFIG_MISSING");
            }
            const requestConfig = resolveModelRequestConfig(config, config.textModel);
            requestConfig.reasoningEffort = requestConfig.agentSettings?.reasoningEffort ?? config.reasoningEffort;
            const result = await runModelCall<TextAgentResult>({
                capability: "text",
                script: requestConfig.script,
                config: requestConfig,
                tools: createCreateAgentTools(),
                stopWhen: hasToolCall("generate_image", "generate_video", "generate_audio"),
                messages: [{ role: "system", content: createAgentSystemPrompt }, ...messages],
                contextTokens: latest.contextTokens,
                signal,
                onAgentCompacting: (value) => setCompacting(value),
                onAgentContextCompacted: (compactedMessages, usage) => {
                    latest = {
                        ...latest,
                        messages: compactedMessages.slice(1),
                        contextTokens: undefined,
                        updatedAt: Date.now(),
                        items: [...latest.items, { id: nanoid(), role: "notice", text: "已压缩较早的对话，保留最近两轮原文。", usage: usageOf(usage), createdAt: Date.now() }],
                    };
                    commit(latest, true);
                },
                onReasoningDelta: (text) => {
                    if (!assistantId) { pendingReasoning += text; return; }
                    update(latest.items.map((item) => item.id === assistantId && item.role === "assistant" ? { ...item, reasoning: (item.reasoning ?? "") + text } : item));
                },
                onAgentEvent: (event) => {
                    if (event.type === "start-step") {
                        assistantId = nanoid();
                        const reasoning = pendingReasoning || undefined;
                        pendingReasoning = "";
                        update([...latest.items, { id: assistantId, role: "assistant", text: "", reasoning, status: "running", createdAt: Date.now() }]);
                    } else if (event.type === "text-delta") {
                        update(latest.items.map((item) => item.id === assistantId && item.role === "assistant" ? { ...item, text: item.text + event.text } : item));
                    } else if (event.type === "reasoning-delta") {
                        update(latest.items.map((item) => item.id === assistantId && item.role === "assistant" ? { ...item, reasoning: (item.reasoning ?? "") + event.text } : item));
                    } else if (event.type === "tool-call") {
                        // 每次 update_plan 都在当前时间线位置新增一张规划卡片，不回头改写之前的计划。
                        const id = nanoid();
                        const draft = event.toolName === "generate_image" || event.toolName === "generate_video" || event.toolName === "generate_audio";
                        toolItemIds.set(event.toolCallId, id);
                        update([...latest.items, { id, role: "tool", toolName: event.toolName, input: event.input, status: "running", createdAt: Date.now(), references: draft ? options.references : undefined }]);
                        commit(latest, true);
                    } else if (event.type === "tool-result") {
                        const id = toolItemIds.get(event.toolCallId);
                        if (!id) return;
                        const output = event.output && typeof event.output === "object" ? event.output as { ok?: boolean; status?: string } : null;
                        const failed = Boolean(output && output.ok === false);
                        const waiting = output?.status === "awaiting_confirmation";
                        update(latest.items.map((item) => item.id === id && item.role === "tool" ? { ...item, status: failed ? "failed" : waiting ? "waiting" : "done", output: safeOutput(event.output) } : item));
                        commit(latest, true);
                    } else if (event.type === "tool-error") {
                        const id = toolItemIds.get(event.toolCallId);
                        if (!id) return;
                        update(latest.items.map((item) => item.id === id && item.role === "tool" ? { ...item, status: "failed", output: "工具没有完成，请稍后重试。" } : item));
                        commit(latest, true);
                    } else if (event.type === "finish-step") {
                        const usage = usageOf(event.usage);
                        latest = {
                            ...latest,
                            contextTokens: event.usage.inputTokens !== undefined && event.usage.outputTokens !== undefined ? event.usage.inputTokens + event.usage.outputTokens : latest.contextTokens,
                        };
                        update(latest.items.map((item) => item.id === assistantId && item.role === "assistant" ? { ...item, status: "done", usage } : item));
                        commit(latest, true);
                    }
                },
                onAgentStepEnd: (step) => {
                    latest = { ...latest, messages: [...latest.messages, ...step.response.messages], updatedAt: Date.now() };
                    commit(latest, true);
                },
            });
            if (typeof result === "string" || !result.messages) throw new Error("TEXT_TOOLS_UNSUPPORTED");
            signal.throwIfAborted();
            const lastUser = latest.items.findLastIndex((item) => item.role === "user");
            const responded = latest.items.slice(lastUser + 1).some((item) => item.role === "tool" || item.role === "notice" || item.role === "assistant" && item.text.trim());
            if (!responded) {
                latest = { ...latest, items: [...latest.items, { id: nanoid(), role: "error", text: "模型本次没有返回内容，请重试或更换文本模型。", createdAt: Date.now() }] };
                commit(latest, true);
            }
        } catch (error) {
            if (removedRef.current.has(sessionId)) return;
            const aborted = signal.aborted;
            const message = aborted ? "已停止本次 Agent 运行，已完成的生成保留在记录中。"
                : error instanceof Error && error.message === "TEXT_TOOLS_UNSUPPORTED" ? "当前调用方式不支持工具调用，请在渠道设置中选择支持工具调用的文本模型或调用方式。"
                    : error instanceof Error && error.message === "TEXT_CONFIG_MISSING" ? "请先在渠道设置中选择可用的文本模型。"
                        : error instanceof Error && error.message === "CHAT_COMPACTION_FAILED" ? "上下文压缩没有完成，本次运行已停止。可稍后重试，或新建对话继续。"
                            : error instanceof Error && error.message === "CHAT_CONTEXT_TOO_RECENT" ? "最近两轮内容需要保留，目前没有更早的内容可以压缩，请新建对话后继续。"
                                : "本次 Agent 运行没有完成，请检查模型与渠道设置后重试。";
            const nextItems = latest.items.map((item) => (item.role === "assistant" || item.role === "tool") && item.status === "running" ? { ...item, status: "failed" as const } : item);
            latest = { ...latest, items: [...nextItems, { id: nanoid(), role: "error", text: message, createdAt: Date.now() }] };
            commit(latest, true);
        } finally {
            runRef.current = null;
            setRunningSession(null);
            setCompacting(false);
        }
    }, [commit, config, openConfigDialog]);

    // 用户确认生成后带着结果继续同一轮对话，让 Agent 接着执行规划里的下一步。
    const continueGeneration = useCallback((sessionId: string, note: string, options: SendOptions) => {
        const current = threadsRef.current.find((thread) => thread.id === sessionId);
        if (!current || runRef.current || current.items.some((item) => item.role === "tool" && (item.status === "waiting" || item.status === "generating"))) return;
        return send(sessionId, note, { ...options, visible: false, notice: "已确认生成，继续执行后续步骤。" });
    }, [send]);

    const stop = useCallback(() => runRef.current?.abort(), []);

    const remove = useCallback(async (sessionId: string) => {
        removedRef.current.add(sessionId);
        threadsRef.current = threadsRef.current.filter((item) => item.id !== sessionId);
        setThreads(threadsRef.current);
        try { await deleteAgentThread(sessionId); } catch (error) { console.error("[create-agent] delete thread", error); }
        if (runningSession === sessionId) runRef.current?.abort();
    }, [runningSession]);

    return { threads, ready, runningSession, compacting, send, continueGeneration, stop, remove, patchItem };
}
