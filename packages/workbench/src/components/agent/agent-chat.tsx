import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMatch } from "react-router-dom";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { nanoid } from "nanoid";
import { Textarea } from "@infinite-canvas/plugin-sdk/ui/textarea";
import { ArrowDownLeft, ArrowUp, ArrowUpRight, ChartPie, Gauge, ImagePlus, Square } from "lucide-react";
import { Conversation, ConversationContent, ConversationScrollButton } from "@workbench/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@workbench/components/ai-elements/message";
import { Shimmer } from "@workbench/components/ai-elements/shimmer";
import { Tool, ToolHeader } from "@workbench/components/ai-elements/tool";

import { ModelPicker } from "@workbench/components/model-picker";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { getAgentUsage } from "@workbench/lib/agent/agent-chat-usage";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import { findGroupModel, useConfigStore } from "@workbench/stores/use-config-store";
import { useAgentStore } from "@workbench/stores/use-agent-store";
import { holdChatDraft, useAgentChatStore, type ChatSubmission } from "@workbench/stores/use-agent-chat-store";
import { createChatSubmission, sendAgentMessage } from "@workbench/services/api/agent-chat";
import { AgentChatSettings } from "./agent-chat-settings";
import { AgentChatImages } from "./agent-chat-images";
import { useAgentImages } from "./use-agent-images";
import "./agent-chat.css";

const tokenCountFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

const starterPrompts = ["帮我整理当前画布上的节点", "根据画布内容写一段分镜文案", "用现有图片生成一组风格统一的新图"];

const toolLabels: Record<string, string> = {
    canvas_get_state: "读取画布", canvas_get_nodes: "读取节点详情", canvas_list_models: "查看模型", canvas_apply_ops: "编排画布",
    canvas_create_text_nodes: "创建文本", canvas_create_generation_flow: "创建生成流程",
    generation_get_status: "查看生成进度", prompts_search: "搜索提示词", assets_list: "查看资产", assets_add: "添加资产",
    canvas_list_references: "查看参考图", canvas_insert_media: "插入素材", canvas_view_image: "查看图片",
};

export function AgentChat() {
    const projectId = useMatch("/canvas/:id")!.params.id!;
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const threadId = useAgentChatStore((state) => state.activeThreadIds[projectId]);
    const thread = useAgentChatStore((state) => state.threads.find((item) => item.id === threadId));
    const storageError = useAgentChatStore((state) => state.storageError);
    const threadLocked = useAgentChatStore((state) => state.receiving.has(threadId) || state.deletions.has(threadId));
    const run = useAgentChatStore((state) => state.run);
    const runningThreadId = useAgentStore((state) => state.runningThreadId);
    const liveItems = useAgentStore((state) => state.liveItems);
    const compacting = useAgentStore((state) => state.compacting);
    const draftThread = useMemo(() => threadId ?? nanoid(), [projectId, threadId]);
    const { images, adding, error: imageError, addImages, removeImage, capture } = useAgentImages(projectId, threadId, draftThread);
    const fileRef = useRef<HTMLInputElement>(null);
    const activeImagePreview = useRef<(() => void) | null>(null);
    const [prompt, setPrompt] = useState("");
    const pending = useRef<ChatSubmission | undefined>(undefined);
    const [notice, setNotice] = useState<{ threadId?: string; text: string }>();
    const saveError = notice?.threadId === draftThread ? notice?.text : undefined;
    const hasDraft = Boolean(prompt || images.length || adding);
    useLayoutEffect(() => { if (threadId && hasDraft) return holdChatDraft(threadId); }, [threadId, hasDraft]);
    const ready = useAgentChatStore((state) => state.ready);
    const items = runningThreadId === threadId ? liveItems : thread?.items;
    const busy = Boolean(run || runningThreadId);
    const localRun = run && run.projectId === projectId && (run.threadId === threadId || pending.current?.threadId === run.threadId) ? run : null;
    const saving = Boolean(localRun && !runningThreadId);
    // 替换停止按钮，避免按下时的回复结束后，松开鼠标或空格却激活下一轮。
    const actionKey = useMemo(() => localRun ? crypto.randomUUID() : "send", [localRun]);
    const thinking = busy && runningThreadId === threadId && !items?.some((item) => item.status === "running" && (item.role === "tool" || item.text));
    const usage = useMemo(() => getAgentUsage(items?.flatMap((item) => item.usage ? [item.usage] : []) ?? []), [items]);
    const outputTokensPerSecond = items?.findLast((item) => item.usage)?.outputTokensPerSecond;
    const contextWindow = findGroupModel(config, config.textModel)?.model?.agentSettings?.contextWindow;
    const usageFields = [
        { label: "输入", value: usage.inputTokens, icon: ArrowDownLeft, detail: ["输入总量（包含缓存命中）", usage.cacheReadTokens !== undefined ? `缓存命中：${usage.cacheReadTokens.toLocaleString("zh-CN")} Token` : null, usage.cacheHitRate !== undefined ? `缓存率：${usage.cacheHitRate.toFixed(1)}%` : null].filter(Boolean).join("\n") },
        { label: "输出", value: usage.outputTokens, icon: ArrowUpRight, detail: ["输出总量（包含思考）", usage.reasoningTokens !== undefined ? `思考：${usage.reasoningTokens.toLocaleString("zh-CN")} Token` : null].filter(Boolean).join("\n") },
    ];

    useLayoutEffect(() => {
        pending.current = undefined;
        setNotice((current) => current?.threadId === draftThread ? current : undefined);
        setPrompt("");
    }, [projectId, draftThread]);

    const send = () => {
        const history = useAgentChatStore.getState();
        if ((!prompt && !images.length) || busy || adding || !ready || history.run || history.receiving.has(threadId) || history.deletions.has(threadId) || history.activeThreadIds[projectId] !== threadId) return;
        const batch = capture();
        if (!batch) return;
        const previous = pending.current;
        const unchanged = previous?.item.text === prompt && previous.item.images?.length === images.length && images.every((image, index) => image.storageKey === previous.item.images![index].storageKey);
        const submission = unchanged ? previous : createChatSubmission(projectId, prompt, images, draftThread, previous);
        pending.current = submission;
        setNotice(undefined);
        void sendAgentMessage(projectId, prompt, { images, submission, signal: batch.signal, onSaved(state) {
            if (batch.signal.aborted || pending.current !== submission) return;
            pending.current = undefined;
            if (state === "previous") {
                setNotice({ threadId: draftThread, text: "上次消息已在原对话中保存，当前草稿仍在。请核对后再发送。" });
                return;
            }
            batch.received();
            setPrompt((value) => value === prompt ? "" : value);
            if (state === "advanced") setNotice({ threadId: submission.threadId, text: "消息已保存，对话已有后续内容，本次未再请求回复。" });
        }, onSaveError(error) {
            if (batch.signal.aborted || pending.current !== submission) return;
            if (error instanceof PluginError && error.code === "PLUGIN_CONFLICT") {
                pending.current = undefined;
                setNotice({ threadId: draftThread, text: "对话已更改，请核对聊天记录和草稿后重新发送。" });
            } else setNotice({ threadId: draftThread, text: "消息尚未确认保存。草稿已保留，请重试发送。" });
        } });
    };

    return (
        <>
            {!items?.length ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-5 text-center">
                    <h3 className="text-sm font-medium">描述你想在画布上完成的事情</h3>
                    <div className="flex w-full flex-col gap-1.5">
                        {starterPrompts.map((text) => <Button key={text} type="button" variant="ghost" className="h-auto justify-center whitespace-normal rounded-xl px-3 py-2 text-center text-sm font-normal hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.muted }} disabled={threadLocked} onClick={() => setPrompt(text)}>{text}</Button>)}
                    </div>
                </div>
            ) : <Conversation className="min-h-0 flex-1">
                <ConversationContent className="gap-5 px-5 py-5">
                    {items.map((item) => item.role === "tool" ? (
                        <Tool key={item.id} className="mb-0" title={item.text}>
                            <ToolHeader type={`tool-${item.toolName}`} state={item.status === "running" ? "input-available" : item.status === "failed" ? "output-error" : "output-available"} title={toolLabels[item.toolName!] ?? "画布操作"} />
                        </Tool>
                    ) : item.role === "user" ? (
                        <Message key={item.id} from="user" className="max-w-[85%]">
                            {item.images?.length ? <AgentChatImages key={`${projectId}:${threadId}`} images={item.images} activePreview={activeImagePreview} /> : null}
                            {item.text ? <MessageContent className="whitespace-pre-wrap break-words leading-7">{item.text}</MessageContent> : null}
                        </Message>
                    ) : item.role === "error" || item.role === "notice" ? (
                        <p key={item.id} role="status" className="text-sm leading-6" style={{ color: theme.node.muted }}>{item.text}</p>
                    ) : item.text ? (
                        <Message key={item.id} from="assistant" className="max-w-full">
                            <MessageResponse className="agent-streamdown" isAnimating={item.status === "running"} lineNumbers={false} controls={{ code: { copy: true, download: false }, table: { copy: true, download: false, fullscreen: false } }} translations={{ copyCode: "复制代码", copied: "已复制", copyLink: "复制链接" }}>{item.text}</MessageResponse>
                        </Message>
                    ) : null)}
                    {thinking ? <div role="status" aria-live="polite"><Shimmer className="text-sm">{compacting ? "正在压缩上下文…" : "正在思考…"}</Shimmer></div> : null}
                </ConversationContent>
                <ConversationScrollButton aria-label="回到最新消息" />
            </Conversation>}
            <div className="shrink-0 px-3 pb-3">
                {saveError || storageError ? <p role="alert" className="mb-2 text-xs" style={{ color: theme.node.muted }}>{saveError || "聊天记录暂时无法读取或保存，请检查存储后重试。"}{storageError && <Button type="button" variant="ghost" size="xs" onClick={() => void useAgentChatStore.getState().flush().catch((error) => console.error("[agent] retry chat storage", error))}>重试聊天记录</Button>}</p> : null}
                {usageFields.some(({ value }) => value !== undefined) || outputTokensPerSecond !== undefined || thread?.contextTokens !== undefined ? (
                    <div className="mb-2 flex flex-nowrap items-center justify-center gap-3 whitespace-nowrap px-1 text-xs leading-5 tabular-nums" style={{ color: theme.node.muted }} role="group" aria-label="当前对话用量">
                        {usageFields.map(({ label, value, icon: Icon, detail }) => value === undefined ? null : (
                            <span key={label} className="inline-flex shrink-0 items-center gap-1" aria-label={label} title={`${label}：${value.toLocaleString("zh-CN")} Token\n${detail}`}>
                                <Icon className="size-3.5" aria-hidden="true" />
                                <span>{tokenCountFormat.format(value)}</span>
                            </span>
                        ))}
                        {outputTokensPerSecond !== undefined ? (
                            <span className="inline-flex shrink-0 items-center gap-1" aria-label="输出速度" title="最近一轮每秒输出的 Token 数，包含思考；不计首个输出前的等待和画布操作耗时">
                                <Gauge className="size-3.5" aria-hidden="true" />
                                <span>{outputTokensPerSecond.toFixed(1)} TPS</span>
                            </span>
                        ) : null}
                        {thread?.contextTokens !== undefined ? (
                            <span className="inline-flex shrink-0 items-center gap-1" aria-label="上下文" title={`最近一轮上下文：${thread.contextTokens.toLocaleString("zh-CN")} Token${contextWindow ? ` / ${contextWindow.toLocaleString("zh-CN")} Token` : "（未设置上限）"}\n包含输入、输出、工具与思考，尚未计入新输入。`}>
                                <ChartPie className="size-3.5" aria-hidden="true" />
                                <span>{contextWindow ? `${(thread.contextTokens / contextWindow * 100).toFixed(1)}%` : tokenCountFormat.format(thread.contextTokens)}</span>
                            </span>
                        ) : null}
                    </div>
                ) : null}
                {imageError || adding ? <p role="status" className="mb-2 text-xs" style={{ color: theme.node.muted }}>{adding ? "正在添加图片…" : imageError}</p> : null}
                <div className="rounded-2xl border px-3 pb-2 pt-2" style={{ borderColor: theme.node.stroke }} onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); } }} onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); void addImages(Array.from(event.dataTransfer.files)); } }} onPaste={(event) => { const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/")); if (files.length) { event.preventDefault(); event.stopPropagation(); void addImages(files); } }}>
                    {images.length ? <AgentChatImages key={`${projectId}:${threadId}`} images={images} activePreview={activeImagePreview} onRemove={removeImage} removeDisabled={saving} /> : null}
                    <Textarea className="agent-chat-input" rows={3} readOnly={threadLocked || saving} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="告诉我你想做什么…" aria-label="聊天内容" onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
                    }} />
                    <div className="mt-2 flex items-center gap-2">
                        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(event) => { void addImages(Array.from(event.target.files!)); event.target.value = ""; }} />
                        <Button type="button" variant="ghost" size="icon-sm" className="agent-panel-action" aria-label="添加参考图" title="添加参考图，也可粘贴或拖入" disabled={busy || threadLocked || adding || !ready || storageError} onClick={() => fileRef.current?.click()}><ImagePlus className="size-4" /></Button>
                        <AgentChatSettings />
                        <div className="min-w-0 flex-1"><ModelPicker config={config} capability="text" value={config.textModel} onChange={(model) => updateConfig("textModel", model)} className="!min-w-0 !border-0 !px-1 !shadow-none" /></div>
                        <Button key={actionKey} type="button" variant="ghost" size="icon-sm" className="agent-panel-action" aria-label={saving ? "取消发送" : localRun ? "停止回复" : saveError && pending.current ? "重试发送" : "发送消息"} disabled={!localRun && (busy || (!prompt && !images.length) || adding || !ready || threadLocked)} onClick={localRun ? () => {
                            const history = useAgentChatStore.getState();
                            if (history.run === localRun && history.activeThreadIds[projectId] === threadId && useAgentStore.getState().canvasContext?.snapshot.projectId === projectId) localRun.controller.abort();
                        } : send}>{localRun ? <Square className="size-4" /> : <ArrowUp className="size-4" />}</Button>
                    </div>
                </div>
            </div>
        </>
    );
}
