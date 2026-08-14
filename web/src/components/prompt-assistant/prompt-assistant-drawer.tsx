import { ArrowUp, Bot, Check, Cpu, RotateCcw, Sparkles, UserRound, X } from "lucide-react";
import { App, Button, Input } from "antd";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import { requestTextQuestion, type AiTextMessage } from "@/services/api/image";
import { modelOptionLabel, resolveModelForCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";

export type PromptAssistantMode = "image" | "video" | "audio" | "text";

type PromptAssistantDrawerProps = {
    open: boolean;
    prompt: string;
    mode: PromptAssistantMode;
    anchorRef?: RefObject<HTMLElement | null>;
    onClose: () => void;
    onApply: (prompt: string) => void;
};

type ChatMessage = {
    role: "user" | "assistant";
    content: string;
};

type PanelRect = { left: number; top: number; width: number; height: number };
type ResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type ResizeState = { direction: ResizeDirection; startX: number; startY: number; rect: PanelRect };
type DragState = { startX: number; startY: number; rect: PanelRect };

const DEFAULT_PANEL_WIDTH = 460;
const DEFAULT_PANEL_HEIGHT = 520;
const MIN_PANEL_WIDTH = 320;
const MIN_PANEL_HEIGHT = 360;
const PANEL_MARGIN = 12;

const resizeHandles: Array<{ direction: ResizeDirection; className: string }> = [
    { direction: "n", className: "-top-1 left-5 right-5 h-2 cursor-n-resize" },
    { direction: "ne", className: "-right-1 -top-1 size-3 cursor-ne-resize" },
    { direction: "e", className: "-bottom-5 -right-1 -top-5 w-2 cursor-e-resize" },
    { direction: "se", className: "-bottom-1 -right-1 size-3 cursor-se-resize" },
    { direction: "s", className: "-bottom-1 left-5 right-5 h-2 cursor-s-resize" },
    { direction: "sw", className: "-bottom-1 -left-1 size-3 cursor-sw-resize" },
    { direction: "w", className: "-bottom-5 -left-1 -top-5 w-2 cursor-w-resize" },
    { direction: "nw", className: "-left-1 -top-1 size-3 cursor-nw-resize" },
];

function clampPanelRect(rect: PanelRect): PanelRect {
    if (typeof window === "undefined") return rect;
    const availableWidth = Math.max(0, window.innerWidth - PANEL_MARGIN * 2);
    const availableHeight = Math.max(0, window.innerHeight - PANEL_MARGIN * 2);
    const maxWidth = Math.max(MIN_PANEL_WIDTH, availableWidth);
    const maxHeight = Math.max(MIN_PANEL_HEIGHT, availableHeight);
    const width = Math.min(Math.max(rect.width, Math.min(MIN_PANEL_WIDTH, maxWidth)), maxWidth);
    const height = Math.min(Math.max(rect.height, Math.min(MIN_PANEL_HEIGHT, maxHeight)), maxHeight);
    const maxLeft = Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN);
    const maxTop = Math.max(PANEL_MARGIN, window.innerHeight - height - PANEL_MARGIN);
    return { left: Math.min(Math.max(rect.left, PANEL_MARGIN), maxLeft), top: Math.min(Math.max(rect.top, PANEL_MARGIN), maxTop), width, height };
}

function resizePanelRect(rect: PanelRect, direction: ResizeDirection, deltaX: number, deltaY: number): PanelRect {
    let next = { ...rect };
    if (direction.includes("e")) next.width = rect.width + deltaX;
    if (direction.includes("s")) next.height = rect.height + deltaY;
    if (direction.includes("w")) {
        next.width = rect.width - deltaX;
        next.left = rect.left + deltaX;
    }
    if (direction.includes("n")) {
        next.height = rect.height - deltaY;
        next.top = rect.top + deltaY;
    }
    if (direction.includes("w") && next.width < MIN_PANEL_WIDTH) next.left = rect.left + rect.width - MIN_PANEL_WIDTH;
    if (direction.includes("n") && next.height < MIN_PANEL_HEIGHT) next.top = rect.top + rect.height - MIN_PANEL_HEIGHT;
    return clampPanelRect(next);
}

export function PromptAssistantDrawer({ open, prompt, mode, anchorRef, onClose, onApply }: PromptAssistantDrawerProps) {
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
    const dragRef = useRef<DragState | null>(null);
    const resizeRef = useRef<ResizeState | null>(null);
    const manualPositionRef = useRef(false);
    const [panelRect, setPanelRect] = useState<PanelRect>({ left: PANEL_MARGIN, top: PANEL_MARGIN, width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT });
    const [dragging, setDragging] = useState(false);
    const [resizing, setResizing] = useState(false);
    const currentPrompt = prompt.trim();

    const placePanel = useCallback(() => {
        if (typeof window === "undefined") return;
        const width = Math.min(DEFAULT_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, window.innerWidth - PANEL_MARGIN * 2));
        const height = Math.min(DEFAULT_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, window.innerHeight - PANEL_MARGIN * 2));
        const anchor = anchorRef?.current?.getBoundingClientRect();
        let left = (window.innerWidth - width) / 2;
        let top = (window.innerHeight - height) / 2;
        if (anchor) {
            left = anchor.left + (anchor.width - width) / 2;
            const below = anchor.bottom + 16;
            const above = anchor.top - height - 16;
            top = below + height <= window.innerHeight - PANEL_MARGIN ? below : above >= PANEL_MARGIN ? above : anchor.top + (anchor.height - height) / 2;
        }
        setPanelRect(clampPanelRect({ left, top, width, height }));
    }, [anchorRef]);

    useEffect(() => {
        if (!open) return;
        manualPositionRef.current = false;
        setDragging(false);
        setResizing(false);
        placePanel();
        const handleViewportChange = () => {
            if (manualPositionRef.current) setPanelRect((value) => clampPanelRect(value));
            else placePanel();
        };
        window.addEventListener("resize", handleViewportChange);
        window.addEventListener("scroll", handleViewportChange, true);
        return () => {
            window.removeEventListener("resize", handleViewportChange);
            window.removeEventListener("scroll", handleViewportChange, true);
        };
    }, [open, placePanel]);

    const close = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setLoading(false);
        setStreamingText("");
        onClose();
    }, [onClose]);

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            close();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [close, open]);

    const handleHeaderPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
        dragRef.current = { startX: event.clientX, startY: event.clientY, rect: panelRect };
        manualPositionRef.current = true;
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handleHeaderPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        setPanelRect(clampPanelRect({ ...drag.rect, left: drag.rect.left + event.clientX - drag.startX, top: drag.rect.top + event.clientY - drag.startY }));
    };

    const endHeaderDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        dragRef.current = null;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const handleResizePointerDown = (direction: ResizeDirection, event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        resizeRef.current = { direction, startX: event.clientX, startY: event.clientY, rect: panelRect };
        manualPositionRef.current = true;
        setResizing(true);
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const resize = resizeRef.current;
        if (!resize) return;
        setPanelRect(resizePanelRect(resize.rect, resize.direction, event.clientX - resize.startX, event.clientY - resize.startY));
    };

    const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
        resizeRef.current = null;
        setResizing(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };

    useEffect(() => {
        if (!open || !scrollRef.current) return;
        scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, [messages, open, streamingText]);

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

    if (!open || typeof document === "undefined") return null;

    const panel = (
        <div
            className="fixed inset-0 z-[1000] bg-black/[0.035]"
            onPointerDown={(event) => {
                if (event.target === event.currentTarget) close();
            }}
        >
            <section
                role="dialog"
                aria-modal="false"
                aria-labelledby={`prompt-assistant-title-${mode}`}
                data-prompt-assistant-panel
                className={`fixed flex min-h-0 flex-col overflow-visible rounded-2xl border border-stone-200 bg-card shadow-[0_24px_80px_-28px_rgba(15,23,42,0.45)] dark:border-stone-700 dark:bg-stone-950 dark:shadow-[0_24px_80px_-28px_rgba(0,0,0,0.75)] ${dragging ? "cursor-grabbing" : resizing ? "cursor-default" : ""}`}
                style={{ left: panelRect.left, top: panelRect.top, width: panelRect.width, height: panelRect.height }}
                onPointerDown={(event) => event.stopPropagation()}
            >
                {resizeHandles.map((handle) => (
                    <div
                        key={handle.direction}
                        aria-hidden="true"
                        data-prompt-assistant-resize={handle.direction}
                        className={`absolute z-20 touch-none ${handle.className}`}
                        onPointerDown={(event) => handleResizePointerDown(handle.direction, event)}
                        onPointerMove={handleResizePointerMove}
                        onPointerUp={endResize}
                        onPointerCancel={endResize}
                    />
                ))}

                <div
                    className={`shrink-0 select-none border-b border-stone-200 px-4 pb-3 pt-4 dark:border-stone-800 ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
                    onPointerDown={handleHeaderPointerDown}
                    onPointerMove={handleHeaderPointerMove}
                    onPointerUp={endHeaderDrag}
                    onPointerCancel={endHeaderDrag}
                >
                    <div className="flex items-start gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200">
                            <Sparkles className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <h2 id={`prompt-assistant-title-${mode}`} className="text-sm font-semibold">{t("promptAssistant.title")}</h2>
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
            </section>
        </div>
    );

    return createPortal(panel, document.body);
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
