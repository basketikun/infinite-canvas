import { ArrowUp, Bot, Check, Cpu, RotateCcw, Sparkles, UserRound, X } from "lucide-react";
import { App, Button, Drawer, Input } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { requestTextQuestion, type AiTextMessage } from "@/services/api/image";
import { modelOptionLabel, resolveModelForCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";

export type PromptAssistantMode = "image" | "video" | "audio" | "text";

type PromptAssistantDrawerProps = {
    open: boolean;
    prompt: string;
    mode: PromptAssistantMode;
    onClose: () => void;
    onApply: (prompt: string) => void;
};

type ChatMessage = {
    role: "user" | "assistant";
    content: string;
};

export function PromptAssistantDrawer({ open, prompt, mode, onClose, onApply }: PromptAssistantDrawerProps) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const assistantModel = resolveModelForCapability(effectiveConfig, undefined, "text");
    const assistantConfig = useMemo(() => ({ ...effectiveConfig, model: assistantModel }), [assistantModel, effectiveConfig]);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [draft, setDraft] = useState("");
    const [streamingText, setStreamingText] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const scrollRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const currentPrompt = prompt.trim();
    useEffect(() => {
        if (!open || !scrollRef.current) return;
        scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, [messages, open, streamingText]);

    const close = () => {
        abortRef.current?.abort();
        abortRef.current = null;
        setLoading(false);
        setStreamingText("");
        onClose();
    };

    const resetConversation = () => {
        abortRef.current?.abort();
        abortRef.current = null;
        setMessages([]);
        setDraft("");
        setStreamingText("");
        setError("");
        setLoading(false);
    };

    const send = async () => {
        const text = draft.trim();
        if (!text || loading) return;
        if (!assistantModel || !isAiConfigReady(assistantConfig, assistantModel)) {
            openConfigDialog(true);
            message.warning(t("promptAssistant.configRequired"));
            return;
        }

        const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
        setMessages(nextMessages);
        setDraft("");
        setError("");
        setStreamingText("");
        setLoading(true);
        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const inputMessages: AiTextMessage[] = [
                { role: "system", content: buildAssistantSystemPrompt(mode, currentPrompt) },
                ...nextMessages.map((item) => ({ role: item.role, content: item.content })),
            ];
            let streamed = "";
            const answer = await requestTextQuestion(
                assistantConfig,
                inputMessages,
                (textDelta) => {
                    streamed = textDelta;
                    setStreamingText(textDelta);
                },
                { signal: controller.signal },
            );
            setMessages((value) => [...value, { role: "assistant", content: String(answer || streamed).trim() }]);
            setStreamingText("");
        } catch (requestError) {
            if (!isAbortError(requestError)) setError(requestError instanceof Error ? requestError.message : t("promptAssistant.error"));
            setStreamingText("");
        } finally {
            setLoading(false);
            abortRef.current = null;
        }
    };

    const apply = (value: string) => {
        if (!value) return;
        onApply(value);
        message.success(t("promptAssistant.applied"));
        close();
    };

    return (
        <Drawer open={open} placement="right" width={420} closable={false} onClose={close} styles={{ body: { padding: 0 } }}>
            <div className="flex h-full min-h-0 flex-col bg-card">
                <div className="border-b border-stone-200 px-4 pb-3 pt-4 dark:border-stone-800">
                    <div className="flex items-start gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200">
                            <Sparkles className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <h2 className="text-sm font-semibold">{t("promptAssistant.title")}</h2>
                                <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-stone-400">AI</span>
                            </div>
                            <p className="mt-0.5 text-[11px] leading-4 text-stone-500 dark:text-stone-400">{t(`promptAssistant.modeDescription.${mode}`)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <Button type="text" size="small" icon={<RotateCcw className="size-4" />} onClick={resetConversation} aria-label={t("promptAssistant.newChat")} />
                            <Button type="text" size="small" icon={<X className="size-4" />} onClick={close} aria-label={t("promptAssistant.close")} />
                        </div>
                    </div>
                </div>

                <div ref={scrollRef} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
                    {!messages.length ? (
                        <div className="space-y-4">
                            <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/60">
                                <div className="flex items-start gap-2.5">
                                    <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-card text-stone-500 dark:border-stone-700 dark:text-stone-300">
                                        <Bot className="size-3.5" />
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="text-sm font-semibold">{t("promptAssistant.introTitle")}</h3>
                                        <p className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">{t(`promptAssistant.introDescription.${mode}`)}</p>
                                    </div>
                                </div>
                            </div>
                            {currentPrompt ? (
                                <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400">{t("promptAssistant.currentDraft")}</div>
                                    <div className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-stone-700 dark:text-stone-200">{currentPrompt}</div>
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {messages.map((item, index) => <PromptAssistantMessage key={`${item.role}-${index}`} item={item} onApply={apply} />)}
                            {streamingText ? <PromptAssistantMessage item={{ role: "assistant", content: streamingText }} pending /> : null}
                        </div>
                    )}
                </div>

                {error ? <div className="mx-4 mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</div> : null}
                <div className="px-4 pb-4 pt-3">
                    <div className="rounded-[20px] border border-stone-300 bg-card px-3 pb-2.5 pt-2.5 shadow-sm transition-colors focus-within:border-stone-500 focus-within:ring-2 focus-within:ring-stone-500/10 dark:border-stone-700 dark:bg-stone-900">
                        <Input.TextArea
                            value={draft}
                            autoSize={{ minRows: 2, maxRows: 6 }}
                            variant="borderless"
                            disabled={loading}
                            placeholder={t("promptAssistant.placeholder")}
                            className="!resize-none !border-0 !bg-transparent !px-0 !py-0 !outline-none !ring-0 !shadow-none focus:!border-0 focus:!outline-none focus:!ring-0 focus:!shadow-none"
                            onChange={(event) => setDraft(event.target.value)}
                            onPressEnter={(event) => {
                                if (event.shiftKey) return;
                                event.preventDefault();
                                void send();
                            }}
                        />
                        <div className="mt-2 flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400" title={modelOptionLabel(effectiveConfig, assistantModel)}>
                                <Cpu className="size-3.5 shrink-0" />
                                <span className="truncate">{modelOptionLabel(effectiveConfig, assistantModel)}</span>
                            </div>
                            <Button type="primary" shape="circle" className="!size-9 !min-w-9" icon={<ArrowUp className="size-4" />} loading={loading} disabled={!draft.trim()} onClick={() => void send()} aria-label={t("promptAssistant.send")} />
                        </div>
                    </div>
                </div>
            </div>
        </Drawer>
    );
}

function PromptAssistantMessage({ item, pending = false, onApply }: { item: ChatMessage; pending?: boolean; onApply?: (prompt: string) => void }) {
    const { t } = useTranslation();
    const isUser = item.role === "user";
    const finalPrompt = !isUser && !pending ? extractFinalPrompt(item.content) : "";
    return (
        <div className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
            {!isUser ? <div className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-stone-50 text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"><Bot className="size-3" /></div> : null}
            <div className={`max-w-[88%] overflow-hidden rounded-lg border text-xs leading-5 ${isUser ? "border-stone-800 bg-stone-800 px-3 py-2.5 text-white dark:border-stone-200 dark:bg-stone-200 dark:text-stone-900" : "border-stone-200 bg-card text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200"}`}>
                <div className={isUser ? "" : "px-3 pb-2.5 pt-2.5"}>
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-stone-400">
                        {isUser ? <UserRound className="size-3" /> : <Sparkles className="size-3" />}
                        {isUser ? t("promptAssistant.user") : t("promptAssistant.assistant")}
                        {pending ? <span className="ml-1 animate-pulse">···</span> : null}
                    </div>
                    <div className="whitespace-pre-wrap break-words">{item.content}</div>
                </div>
                {!isUser ? (
                    <div className="border-t border-stone-200 px-2 py-1.5 dark:border-stone-800">
                        <Button type="text" size="small" block disabled={!finalPrompt} icon={<Check className="size-3.5" />} onClick={() => finalPrompt && onApply?.(finalPrompt)} className="!h-7 !justify-start !px-1 text-xs">
                            {finalPrompt ? t("promptAssistant.apply") : t("promptAssistant.applyHint")}
                        </Button>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function buildAssistantSystemPrompt(mode: PromptAssistantMode, currentPrompt: string) {
    const modeLabel: Record<PromptAssistantMode, string> = { image: "图片提示词", video: "视频提示词", audio: "音频提示词", text: "画布文本内容" };
    return `你是一个专门帮助用户整理${modeLabel[mode]}的中文助手。你不直接生成媒体或写入内容，只负责通过简短对话澄清想法并整理最终结果。

当前场景输入框里的草稿（可能为空，仅作为上下文）：
${currentPrompt || "（暂无草稿）"}

工作规则：
1. 保留用户原本想表达的主体和意图，不要擅自添加品牌、人物身份或用户没有要求的关键元素。
2. 只追问真正影响当前结果的信息；图片关注主体、动作、场景、风格、构图、光线、色彩和氛围，视频关注镜头、运镜、动作和节奏，音频关注内容、声音、语气和节奏，文本关注内容、结构、语气和长度；一次最多问两个问题。
3. 用户信息已经足够，或用户说“确定”“就这样”“应用”时，在回复末尾输出唯一一段 <prompt>最终提示词</prompt>。标签内只放可以直接交给当前场景模型的内容，不要放标题、解释、引号或标签。
4. 尚未确定时不要输出 <prompt> 标签；可以先给出简短建议，但不要替用户生成媒体或擅自写入内容。
5. 使用自然、简洁的中文交流。`;
}

function extractFinalPrompt(text: string) {
    const tagged = text.match(/<prompt>\s*([\s\S]*?)\s*<\/prompt>/i)?.[1]?.trim();
    if (tagged) return tagged;
    const labeled = text.match(/(?:最终提示词|最终提示|final prompt)\s*[:：]\s*([\s\S]+)/i)?.[1]?.trim();
    return labeled ? labeled.replace(/\n\s*(?:说明|备注|解释|notes?)\s*[:：][\s\S]*$/i, "").trim() : "";
}

function isAbortError(error: unknown) {
    return error instanceof Error && (error.name === "AbortError" || error.message === "请求已取消");
}
