import { AlertTriangle, ArrowUp, Compass, FilePenLine, GitBranch, HelpCircle, Lightbulb, Maximize2, MessageSquare, Plus, Scale, Sparkles, Sprout, Wrench, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { useAgentStore } from "@/stores/use-agent-store";
import { CanvasNodeType, type ResearchFlowNodeType } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

export const RESEARCH_FLOW_META: Record<ResearchFlowNodeType, { color: string; Icon: LucideIcon }> = {
    // Desaturated accents so cards sit in the canvas instead of glowing against it.
    [CanvasNodeType.Seed]: { color: "#6f9b7c", Icon: Sprout },
    [CanvasNodeType.Direction]: { color: "#6d91ad", Icon: Compass },
    [CanvasNodeType.ResearchQuestion]: { color: "#7a7eb8", Icon: HelpCircle },
    [CanvasNodeType.Problem]: { color: "#c4895c", Icon: AlertTriangle },
    [CanvasNodeType.Hypothesis]: { color: "#9a7db8", Icon: Lightbulb },
    [CanvasNodeType.Approach]: { color: "#5f9a90", Icon: GitBranch },
    [CanvasNodeType.Method]: { color: "#8a9a5e", Icon: Wrench },
    [CanvasNodeType.Evaluation]: { color: "#b8974a", Icon: Scale },
    [CanvasNodeType.Idea]: { color: "#b67a94", Icon: Sparkles },
};

export function researchFlowIcon(type: ResearchFlowNodeType, className = "size-5"): ReactNode {
    const Icon = RESEARCH_FLOW_META[type].Icon;
    return <Icon className={className} />;
}

function EditableTextArea({
    value,
    placeholder,
    color,
    placeholderColor,
    onChange,
    autoEdit = false,
}: {
    value: string;
    placeholder: string;
    color: string;
    placeholderColor: string;
    onChange: (value: string) => void;
    autoEdit?: boolean;
}) {
    const [editing, setEditing] = useState(autoEdit);
    const textStyle = { flex: 1, minHeight: 0, fontSize: 14, lineHeight: 1.55, color } as React.CSSProperties;

    if (editing) {
        return (
            <textarea
                autoFocus
                value={value}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
                onBlur={() => setEditing(false)}
                onMouseDown={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
                style={{ ...textStyle, width: "100%", resize: "none", border: "none", outline: "none", background: "transparent" }}
            />
        );
    }
    return (
        <div onClick={() => setEditing(true)} style={{ ...textStyle, overflow: "auto", whiteSpace: "pre-wrap", cursor: "text" }}>
            {value || <span style={{ color: placeholderColor }}>{placeholder}</span>}
        </div>
    );
}

export function ResearchCardContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { t } = useTranslation();
    const type = ctx.node.type as ResearchFlowNodeType;
    const meta = RESEARCH_FLOW_META[type];
    const Icon = meta.Icon;
    const summary = ctx.node.metadata?.summary || "";
    const [drafting, setDrafting] = useState(false);

    // Keep empty research cards tall enough for the icon + try actions.
    const width = ctx.node.width;
    const height = ctx.node.height;
    useEffect(() => {
        if (summary || drafting) return;
        if (height >= 280 && width >= 240) return;
        ctx.updateNode({
            width: Math.max(width, 280),
            height: Math.max(height, 320),
        });
    }, [ctx, drafting, height, summary, width]);

    if (!summary && !drafting) {
        return (
            <div data-canvas-no-zoom className="flex h-full min-h-0 w-full flex-col items-stretch justify-between box-border px-4 pb-5 pt-6">
                <div className="grid min-h-0 flex-1 place-items-center overflow-hidden">
                    <Icon className="size-16 max-h-full max-w-full opacity-[0.18]" strokeWidth={1.1} style={{ color: ctx.theme.node.text }} />
                </div>
                <div className="mt-3 flex shrink-0 flex-col gap-2">
                    <div className="text-[11px]" style={{ color: ctx.theme.node.faint }}>{t("canvas.researchNodes.tryLabel")}</div>
                    <button
                        type="button"
                        className="flex h-10 shrink-0 items-center gap-2.5 rounded-lg px-3 text-left text-[13px] transition hover:bg-black/5 dark:hover:bg-white/10"
                        style={{ background: ctx.theme.toolbar.activeBg, color: ctx.theme.node.text }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => setDrafting(true)}
                    >
                        <FilePenLine className="size-3.5 shrink-0 opacity-60" />
                        <span className="truncate">{t("canvas.researchNodes.tryWrite")}</span>
                    </button>
                    <button
                        type="button"
                        className="flex h-10 shrink-0 items-center gap-2.5 rounded-lg px-3 text-left text-[13px] transition hover:bg-black/5 dark:hover:bg-white/10"
                        style={{ background: ctx.theme.toolbar.activeBg, color: ctx.theme.node.text }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => ctx.openPanel()}
                    >
                        <MessageSquare className="size-3.5 shrink-0 opacity-60" />
                        <span className="truncate">{t("canvas.researchNodes.tryAskAgent")}</span>
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div data-canvas-no-zoom className="flex h-full w-full flex-col box-border p-4">
            <EditableTextArea
                value={summary}
                placeholder={t("canvas.researchNodes.summaryPlaceholder")}
                color={ctx.theme.node.text}
                placeholderColor={ctx.theme.node.placeholder}
                autoEdit={drafting && !summary}
                onChange={(value) => ctx.updateMetadata({ summary: value })}
            />
        </div>
    );
}

// Sends the prompt text to the local Agent chat, with this node attached as a canvas reference so
// Codex can pull its content via canvas_get_state and act on it.
function sendResearchNodePrompt(ctx: CanvasNodeContext, promptText: string) {
    const trimmed = promptText.trim();
    if (!trimmed) return;
    const node = ctx.node;
    const store = useAgentStore.getState();
    const reference: CanvasResourceReference = {
        id: node.id,
        nodeId: node.id,
        kind: "text",
        label: node.title,
        title: node.title,
        text: node.metadata?.summary,
        active: true,
    };
    store.openPanel();
    store.setAgentState({
        activeTab: "chat",
        prompt: trimmed,
        canvasReferences: [...store.canvasReferences.filter((item) => item.nodeId !== node.id), reference],
        pendingSend: store.pendingSend + 1,
    });
}

export function ResearchPromptPanel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const { t } = useTranslation();
    const [value, setValue] = useState("");
    const [expanded, setExpanded] = useState(false);

    const submit = () => {
        if (!value.trim()) return;
        sendResearchNodePrompt(ctx, value);
        setValue("");
        onClose();
    };

    return (
        <div
            data-canvas-no-zoom
            className={`rounded-2xl border p-3 shadow-2xl backdrop-blur ${expanded ? "w-[560px]" : "w-[480px]"}`}
            style={{ background: ctx.theme.node.panel, borderColor: ctx.theme.node.stroke, color: ctx.theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between">
                <button
                    type="button"
                    className="grid size-8 place-items-center rounded-lg border border-dashed opacity-70 transition hover:opacity-100"
                    style={{ borderColor: ctx.theme.node.stroke, color: ctx.theme.node.muted }}
                    title={t("canvas.researchNodes.attachHint")}
                    onClick={() => useAgentStore.getState().openPanel()}
                >
                    <Plus className="size-3.5" />
                </button>
                <button
                    type="button"
                    className="grid size-8 place-items-center rounded-lg opacity-60 transition hover:opacity-100"
                    style={{ color: ctx.theme.node.muted }}
                    aria-label={t("canvas.researchNodes.expandPrompt")}
                    onClick={() => setExpanded((v) => !v)}
                >
                    <Maximize2 className="size-3.5" />
                </button>
            </div>
            <textarea
                autoFocus
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        submit();
                    }
                    if (event.key === "Escape") onClose();
                }}
                placeholder={t("canvas.researchNodes.promptPlaceholder")}
                rows={expanded ? 5 : 3}
                className="w-full resize-none bg-transparent text-sm leading-6 outline-none"
                style={{ color: ctx.theme.node.text }}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px]" style={{ color: ctx.theme.node.faint }}>{t("canvas.researchNodes.promptHint")}</span>
                <button
                    type="button"
                    onClick={submit}
                    disabled={!value.trim()}
                    aria-label={t("canvas.researchNodes.sendPrompt")}
                    className="grid size-9 shrink-0 place-items-center rounded-full transition disabled:opacity-40"
                    style={{ background: ctx.theme.toolbar.activeBg, color: ctx.theme.toolbar.activeText }}
                >
                    <ArrowUp className="size-4" />
                </button>
            </div>
        </div>
    );
}

export function NoteContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { t } = useTranslation();
    const content = ctx.node.metadata?.content || "";
    return (
        <div data-canvas-no-zoom style={{ height: "100%", width: "100%", display: "flex", padding: 14, boxSizing: "border-box" }}>
            <EditableTextArea
                value={content}
                placeholder={t("canvas.researchNodes.notePlaceholder")}
                color={ctx.theme.node.text}
                placeholderColor={ctx.theme.node.placeholder}
                onChange={(value) => ctx.updateMetadata({ content: value })}
            />
        </div>
    );
}

export function QuestionContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { t } = useTranslation();
    const summary = ctx.node.metadata?.summary || "";
    return (
        <div data-canvas-no-zoom style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", gap: 8, padding: 14, boxSizing: "border-box" }}>
            <EditableTextArea
                value={summary}
                placeholder={t("canvas.researchNodes.questionPlaceholder")}
                color={ctx.theme.node.text}
                placeholderColor={ctx.theme.node.placeholder}
                onChange={(value) => ctx.updateMetadata({ summary: value })}
            />
            <span style={{ fontSize: 11, color: ctx.theme.node.placeholder }}>{t("canvas.researchNodes.questionHint")}</span>
        </div>
    );
}

export function SourceLinkContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { t } = useTranslation();
    const sourceUrl = ctx.node.metadata?.sourceUrl || "";
    const isPdf = ctx.node.type === CanvasNodeType.Pdf;
    return (
        <div data-canvas-no-zoom style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", gap: 8, padding: 14, boxSizing: "border-box", color: ctx.theme.node.text }}>
            <input
                value={sourceUrl}
                placeholder={isPdf ? t("canvas.researchNodes.pdfPlaceholder") : t("canvas.researchNodes.webPlaceholder")}
                onChange={(e) => ctx.updateMetadata({ sourceUrl: e.target.value })}
                onMouseDown={(e) => e.stopPropagation()}
                style={{ border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 8, background: "transparent", color: ctx.theme.node.text, fontSize: 12, padding: "6px 8px", outline: "none" }}
            />
            {sourceUrl ? (
                <a href={sourceUrl} target="_blank" rel="noreferrer" onMouseDown={(e) => e.stopPropagation()} style={{ fontSize: 11, color: ctx.theme.toolbar.activeText, wordBreak: "break-all" }}>
                    {sourceUrl}
                </a>
            ) : (
                <span style={{ fontSize: 11, color: ctx.theme.node.placeholder }}>{t("canvas.researchNodes.sourceEmpty")}</span>
            )}
        </div>
    );
}

export function FrameContent({ ctx }: { ctx: CanvasNodeContext }) {
    return (
        <div className="pointer-events-none flex h-full w-full items-start p-3" style={{ color: ctx.theme.node.muted }}>
            <span className="truncate text-xs font-semibold uppercase tracking-wide">{ctx.node.title}</span>
        </div>
    );
}
