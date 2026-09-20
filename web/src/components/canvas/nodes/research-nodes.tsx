import { useState } from "react";
import { useTranslation } from "react-i18next";

import { CanvasNodeType, type ResearchFlowNodeType } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

export const RESEARCH_FLOW_META: Record<ResearchFlowNodeType, { color: string }> = {
    [CanvasNodeType.Seed]: { color: "#94a3b8" },
    [CanvasNodeType.Direction]: { color: "#38bdf8" },
    [CanvasNodeType.ResearchQuestion]: { color: "#3b82f6" },
    [CanvasNodeType.Problem]: { color: "#f97316" },
    [CanvasNodeType.Hypothesis]: { color: "#a855f7" },
    [CanvasNodeType.Approach]: { color: "#14b8a6" },
    [CanvasNodeType.Method]: { color: "#84cc16" },
    [CanvasNodeType.Evaluation]: { color: "#eab308" },
    [CanvasNodeType.Idea]: { color: "#ec4899" },
};

function TypeChip({ type }: { type: ResearchFlowNodeType }) {
    const { t } = useTranslation();
    const meta = RESEARCH_FLOW_META[type];
    return (
        <span
            className="inline-flex w-fit shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide"
            style={{ background: `${meta.color}22`, color: meta.color }}
        >
            {t(`canvas.nodeTypes.${type}`)}
        </span>
    );
}

// Click to edit, blur to go back to plain text — same pattern as the built-in Text node, so the card
// stays draggable everywhere except while a textarea is actually focused for editing.
function EditableTextArea({
    value,
    placeholder,
    color,
    placeholderColor,
    onChange,
}: {
    value: string;
    placeholder: string;
    color: string;
    placeholderColor: string;
    onChange: (value: string) => void;
}) {
    const [editing, setEditing] = useState(false);
    const textStyle = { flex: 1, minHeight: 0, fontSize: 13, lineHeight: 1.55, color } as React.CSSProperties;

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
    const summary = ctx.node.metadata?.summary || "";
    return (
        <div data-canvas-no-zoom style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", gap: 8, padding: 14, boxSizing: "border-box" }}>
            <TypeChip type={type} />
            <EditableTextArea
                value={summary}
                placeholder={t("canvas.researchNodes.summaryPlaceholder")}
                color={ctx.theme.node.text}
                placeholderColor={ctx.theme.node.placeholder}
                onChange={(value) => ctx.updateMetadata({ summary: value })}
            />
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

// Shared by pdf and web nodes: both are just a title + source link, no real fetch/render.
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
