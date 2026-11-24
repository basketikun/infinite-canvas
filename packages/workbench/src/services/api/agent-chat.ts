import { nanoid } from "nanoid";
import type { ModelMessage } from "ai";
import { formatChatImagePrompt } from "@infinite-canvas/shared/chat";
import { PluginError } from "@infinite-canvas/shared/plugins";

import { useAgentStore } from "@workbench/stores/use-agent-store";
import { useCanvasStore } from "@workbench/stores/canvas/use-canvas-store";
import { agentHistoryReady, confirmChatSubmission, useAgentChatStore, type AgentChatImage, type AgentChatItem, type ChatSubmission } from "@workbench/stores/use-agent-chat-store";
import { channelWrites, resolveModelRequestConfig, useConfigStore } from "@workbench/stores/use-config-store";
import { callScriptsReady } from "@workbench/stores/use-call-script-store";
import { createCanvasTools } from "@workbench/lib/agent/canvas-tools";
import { runModelCall } from "./model-plugin";
import type { TextAgentResult } from "./text-agent";

const instructions = "你是无限画布助手。先用 canvas_get_state 读取精简概览，需要完整内容时用 canvas_get_nodes 按 ID 查询；选中内容用 selectedOnly，批量修改用 canvas_apply_ops。写操作只返回本次变化，无需每次再读取全图。用 canvas_list_models 查询模型，不猜模型名；生成统一用 canvas_create_generation_flow，autoRun=true 提交生成，false 只创建流程。只操作当前项目，尊重节点原始内容与图片比例。需要分组时用 canvas_apply_ops 的 group_nodes 创建真实组，不要用文本标题代替；成员用 set_group_members 调整，ungroup_nodes 解散。移动组会带动成员，删除组会保留成员。用户上传的参考图可以直接查看；将原图或「我的素材」放入画布时用 canvas_insert_media（参考图传 storageKey，素材传 assetId），不要重画、编造图片地址或编码。需要早先的参考图时用 canvas_list_references；要判断图片内容或生成结果时用 canvas_view_image；插入后返回的节点 ID 可以用于生成流程的 referenceNodeIds。生成任务提交后使用 generation_get_status 查询结果，不要把已提交说成已完成。工具失败或操作中断后先确认画布实际状态，不重复提交付费生成。不要向用户暴露密钥、内部错误或工具的原始响应。使用中文回答。";

type AgentMessageOptions = { images?: AgentChatImage[]; compact?: boolean; submission?: ChatSubmission; signal?: AbortSignal; onSaved?: (state: "current" | "advanced" | "previous") => void; onSaveError?: (error: unknown) => void };

export function createChatSubmission(projectId: string, prompt: string, images?: AgentChatImage[], reservedThread?: string, previous?: ChatSubmission): ChatSubmission {
    const selected = useAgentChatStore.getState().activeThreadIds[projectId];
    return {
        projectId, selected, threadId: selected ?? reservedThread ?? nanoid(), item: { id: previous?.item.id ?? nanoid(), role: "user", text: prompt, images: images?.map((image) => ({ ...image })) },
        previous: previous?.item, base: previous?.write?.before,
        message: { role: "user", content: images?.length ? [
            { type: "text", text: formatChatImagePrompt(prompt, images) },
            ...images.map((image) => ({ type: "file" as const, data: image.storageKey, mediaType: image.mimeType })),
        ] : prompt },
    };
}

export async function stopAgentMessage(projectIds: readonly string[]) {
    const run = useAgentChatStore.getState().run;
    if (!run || !projectIds.includes(run.projectId)) return;
    run.controller.abort();
    await run.done;
}

export async function sendAgentMessage(projectId: string, prompt: string, options: AgentMessageOptions = {}) {
    const agent = useAgentStore.getState();
    const context = agent.canvasContext;
    const history = useAgentChatStore.getState();
    const selected = history.activeThreadIds[projectId];
    if ((!prompt && !options.images?.length && !options.compact) || history.run || agent.runningThreadId || history.receiving.has(selected) || history.deletions.has(selected) || !useCanvasStore.getState().openProject(projectId)) return;
    if (!context || context.snapshot.projectId !== projectId || context.signal.aborted || options.signal?.aborted) return;
    const submission = options.compact ? undefined : options.submission ?? createChatSubmission(projectId, prompt, options.images);
    if (submission && (submission.started || submission.projectId !== projectId || submission.selected !== selected)) return;
    const controller = new AbortController();
    let finish!: () => void;
    const run = { projectId, threadId: submission?.threadId ?? selected, controller, done: new Promise<void>((resolve) => { finish = resolve; }) };
    useAgentChatStore.setState({ run });
    const stop = () => controller.abort(context.signal.reason);
    const leave = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", leave, { once: true });
    context.signal.addEventListener("abort", stop, { once: true });
    const unsubscribe = useAgentStore.subscribe((state) => {
        if (state.canvasContext?.signal !== context.signal || state.canvasContext.snapshot.projectId !== projectId) controller.abort();
    });
    const watchThread = useAgentChatStore.subscribe((state, old) => {
        const next = state.activeThreadIds[projectId];
        if (next !== old.activeThreadIds[projectId] && !(submission?.started && !selected && next === submission.threadId)) controller.abort();
    });
    agent.setAgentState({ controller });
    try {
        await Promise.all([agentHistoryReady, callScriptsReady]);
        controller.signal.throwIfAborted();
        const current = useAgentChatStore.getState();
        if (!useCanvasStore.getState().openProject(projectId) || current.activeThreadIds[projectId] !== selected) return;
        if (selected && !current.threads.some((thread) => thread.id === selected && thread.projectId === projectId)) return;
        if (submission) {
            const state = await confirmChatSubmission(submission, controller.signal);
            controller.signal.throwIfAborted();
            if (useAgentChatStore.getState().activeThreadIds[projectId] !== selected) return;
            submission.started = true;
            options.signal?.removeEventListener("abort", leave);
            options.onSaved?.(state);
            if (!selected) current.selectThread(projectId, submission.threadId);
            if (state !== "current") return;
        }
        if (!run.threadId) return;
        await runAgentMessage(projectId, run.threadId, options, controller);
    } catch (error) {
        if (!controller.signal.aborted) {
            console.error("[agent] message failed", error);
            if (submission && !submission.started) {
                options.onSaveError?.(error);
                const current = useAgentChatStore.getState();
                if (error instanceof PluginError && error.code === "PLUGIN_CONFLICT" && !selected && !current.activeThreadIds[projectId] && current.threads.some((row) => row.id === submission.threadId && row.projectId === projectId)) current.selectThread(projectId, submission.threadId);
            }
        }
    } finally {
        context.signal.removeEventListener("abort", stop);
        options.signal?.removeEventListener("abort", leave);
        unsubscribe();
        watchThread();
        if (useAgentChatStore.getState().run === run) {
            useAgentChatStore.setState({ run: null });
            if (useAgentStore.getState().controller === controller) agent.setAgentState({ runningThreadId: "", controller: null, liveItems: [], compacting: false });
        }
        finish();
    }
}

async function runAgentMessage(projectId: string, threadId: string, options: AgentMessageOptions, controller: AbortController) {
    const agent = useAgentStore.getState();
    const history = useAgentChatStore.getState();
    const thread = useAgentChatStore.getState().threads.find((item) => item.id === threadId)!;
    let items: AgentChatItem[] = [...thread.items];
    const messages: ModelMessage[] = [...thread.messages];
    let contextMessages = [...(thread.contextMessages ?? thread.messages)];
    let contextTokens = thread.contextTokens;
    const { signal } = controller;
    const toolItemIds = new Map<string, string>();
    let assistantId = "";
    let compacted = false;
    let failureMessage = "请在渠道设置中选择可用的文本模型，再发送消息。";
    agent.setAgentState({ runningThreadId: threadId, controller, liveItems: items, activeTab: "chat" });
    const updateItem = (id: string, patch: Partial<AgentChatItem>) => {
        items = items.map((item) => item.id === id ? { ...item, ...patch } : item);
        agent.setAgentState({ liveItems: items });
    };
    try {
        await channelWrites.flush();
        signal.throwIfAborted();
        const config = useConfigStore.getState().config;
        const requestConfig = resolveModelRequestConfig(config, config.textModel);
        requestConfig.reasoningEffort = requestConfig.agentSettings?.reasoningEffort ?? config.reasoningEffort;
        failureMessage = "本次回复未完成，请稍后重试，或在渠道设置中检查模型与调用方式。";
        const result = await runModelCall<TextAgentResult>({
            capability: "text",
            script: requestConfig.script,
            config: requestConfig,
            tools: await createCanvasTools(projectId, signal),
            messages: [{ role: "system", content: `${instructions}\n当前项目：${projectId}\n${config.systemPrompt}` }, ...contextMessages],
            signal,
            contextTokens,
            compactContext: options.compact,
            onAgentCompacting: (compacting) => agent.setAgentState({ compacting }),
            onAgentContextCompacted: (compactedMessages, usage) => {
                signal.throwIfAborted();
                compacted = true;
                contextMessages = compactedMessages.slice(1);
                contextTokens = undefined;
                items = [...items, { id: nanoid(), role: "notice", text: "已总结较早内容，保留最近两轮原文。完整聊天记录仍可查看。", usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.outputTokenDetails.reasoningTokens, cacheReadTokens: usage.inputTokenDetails.cacheReadTokens } }];
                agent.setAgentState({ liveItems: items });
                history.updateThread(threadId, { items, contextMessages: [...contextMessages], contextTokens });
            },
            onAgentStepStart: () => {
                signal.throwIfAborted();
                if (useAgentStore.getState().canvasContext?.snapshot.projectId !== projectId) { controller.abort(); signal.throwIfAborted(); }
                if (useAgentChatStore.getState().storageError) {
                    failureMessage = "聊天记录保存失败，请检查浏览器存储空间后重试。";
                    throw new Error("CHAT_STORAGE_UNAVAILABLE");
                }
            },
            onAgentEvent: (event) => {
                if (event.type === "start-step") {
                    assistantId = nanoid();
                    items = [...items, { id: assistantId, role: "assistant", text: "", status: "running" }];
                    agent.setAgentState({ liveItems: items });
                } else if (event.type === "finish-step") {
                    contextTokens = event.usage.inputTokens !== undefined && event.usage.outputTokens !== undefined ? event.usage.inputTokens + event.usage.outputTokens : undefined;
                    updateItem(assistantId, {
                        status: "done",
                        outputTokensPerSecond: event.usage.outputTokens !== undefined && event.performance.timeToFirstOutputMs !== undefined && event.performance.responseTimeMs > event.performance.timeToFirstOutputMs
                            ? event.performance.outputTokensPerSecond : undefined,
                        usage: {
                            inputTokens: event.usage.inputTokens,
                            outputTokens: event.usage.outputTokens,
                            reasoningTokens: event.usage.outputTokenDetails.reasoningTokens,
                            cacheReadTokens: event.usage.inputTokenDetails.cacheReadTokens,
                        },
                    });
                    history.updateThread(threadId, { items, messages: [...messages], contextMessages: [...contextMessages], contextTokens });
                } else if (event.type === "text-delta") {
                    const item = items.find((item) => item.id === assistantId)!;
                    updateItem(assistantId, { text: item.text + event.text });
                } else if (event.type === "tool-call") {
                    const id = nanoid();
                    toolItemIds.set(event.toolCallId, id);
                    items = [...items, { id, role: "tool", text: "正在操作画布", toolName: event.toolName, status: "running" }];
                    agent.setAgentState({ liveItems: items });
                } else if (event.type === "tool-result") {
                    const failed = (event.output as { ok: boolean }).ok === false;
                    updateItem(toolItemIds.get(event.toolCallId)!, { status: failed ? "failed" : "done", text: failed ? "操作未完成，请检查画布后继续。" : "操作完成" });
                } else if (event.type === "tool-error") {
                    updateItem(toolItemIds.get(event.toolCallId)!, { status: "failed", text: "操作未完成，请检查画布后继续。" });
                }
            },
            onAgentStepEnd: (step) => { messages.push(...step.response.messages); contextMessages.push(...step.response.messages); },
        });
        if (options.compact) {
            if (!compacted) throw new Error("CHAT_COMPACTION_FAILED");
            return;
        }
        if (typeof result === "string" || !result.messages || !assistantId) {
            failureMessage = "当前调用方式尚未支持画布操作，请在渠道设置中选择支持工具调用的文本调用方式。";
            throw new Error("TEXT_TOOLS_UNSUPPORTED");
        }
        signal.throwIfAborted();
        if (!result.text) throw new Error("TEXT_EMPTY");
    } catch (error) {
        if (error instanceof Error && error.message === "TEXT_PROXY_FAILED") failureMessage = "使用本地代理的请求未能完成，请确认代理已启动，并在设置的「本地代理」中测试连接。";
        if (error instanceof Error && error.message === "TEXT_NETWORK_FAILED") failureMessage = "无法连接所选渠道，请检查网络与渠道地址；如果服务不允许网页直接访问，可在设置中配置本地代理后重试。";
        if (error instanceof Error && error.message === "CHAT_COMPACTION_FAILED") failureMessage = "上下文压缩未完成，本次发送已停止。原有内容仍保留，请重试压缩后继续。";
        if (error instanceof Error && error.message === "CHAT_CONTEXT_TOO_RECENT") failureMessage = "最近两轮内容需要保留，目前没有更早的内容可以压缩。请新建对话，或选择上下文容量更大的模型。";
        if (error instanceof Error && error.message === "CHAT_REFERENCE_MISSING") failureMessage = "参考图暂时无法读取，请重新添加图片后发送。";
        if (error instanceof Error && error.message === "TEXT_REASONING_UNSUPPORTED") failureMessage = "当前模型的调用方式不支持所选思考强度，请选择自动或其他档位。";
        const text = signal.aborted ? "已停止本次回复，已完成的画布操作会保留。" : failureMessage;
        items = items.map((item) => item.status === "running" ? { ...item, status: "failed" } : item);
        items.push({ id: nanoid(), role: "error", text });
        history.updateThread(threadId, { items, messages: [...messages], contextMessages: [...contextMessages], contextTokens });
    }
}
