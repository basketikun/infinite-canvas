import { Check, ChevronRight, Eye, FileText, Image as ImageIcon, Music2, Settings2, Square, Type, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeRow } from "@/lib/canvas/canvas-node-list";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { cn } from "@/lib/utils";
import { previewUrlFor } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { CanvasNodesState } from "./use-canvas-nodes-tab";

const NODE_TYPE_ICON: Record<string, typeof Square> = {
    [CanvasNodeType.Image]: ImageIcon,
    [CanvasNodeType.Video]: Video,
    [CanvasNodeType.Audio]: Music2,
    [CanvasNodeType.Text]: Type,
    [CanvasNodeType.Config]: Settings2,
    [CanvasNodeType.Group]: Square,
};

const STATUS_COLOR: Record<string, string> = {
    success: "#22c55e",
    loading: "#f59e0b",
    error: "#ef4444",
    idle: "transparent",
};

function nodePreviewText(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    return getNodeDefinition(node.type)?.title || node.type;
}

type Props = { row: CanvasNodeRow; state: CanvasNodesState; theme: CanvasTheme };

export function CanvasNodeGridItem({ row, state, theme }: Props) {
    const { t } = useTranslation();
    const { node } = row;
    const { checked, selectMode, selectedNodeIds, toggleChecked, activateNode, onHoverNode } = state;
    const Icon = NODE_TYPE_ICON[node.type] || FileText;
    const isImage = node.type === CanvasNodeType.Image && node.metadata?.content;
    const isChecked = checked.has(node.id);
    const active = selectMode ? isChecked : selectedNodeIds.has(node.id);
    return (
        <button
            key={node.id}
            type="button"
            data-node-item={node.id}
            onClick={() => (selectMode ? toggleChecked(node.id) : activateNode(node))}
            onMouseEnter={() => onHoverNode(node.id)}
            onMouseLeave={(event) => {
                const to = event.relatedTarget as Element | null;
                if (!to || !to.closest("[data-node-item]")) onHoverNode(null);
            }}
            className="group relative flex min-w-0 flex-col rounded-lg p-1 text-left transition hover:bg-black/5 dark:hover:bg-white/5"
            style={active ? { background: theme.toolbar.activeBg } : undefined}
            title={selectMode ? undefined : t("canvas.sidePanel.focusNode")}
        >
            <span className="relative grid aspect-square w-full place-items-center overflow-hidden rounded-md">
                {isImage ? <img src={previewUrlFor(node.metadata?.storageKey) || node.metadata?.content} alt={node.title} className="size-full object-cover" /> : <Icon className="size-6 opacity-60" />}
                {selectMode ? (
                    <span className="absolute left-1 top-1">
                        <CheckMark checked={isChecked} theme={theme} />
                    </span>
                ) : null}
                {node.metadata?.status && node.metadata.status !== "idle" ? <span className="absolute right-1 top-1 size-1.5 rounded-full" style={{ background: STATUS_COLOR[node.metadata.status] || "transparent" }} /> : null}
            </span>
            <span className="mt-1 block truncate text-xs font-medium leading-snug">{node.title || getNodeDefinition(node.type)?.title || t("canvas.node.untitled")}</span>
        </button>
    );
}

export function CanvasNodeListItem({ row, state, theme }: Props) {
    const { t } = useTranslation();
    const { node, depth, hasChildren } = row;
    const { checked, selectMode, selectedNodeIds, toggleChecked, activateNode, onHoverNode, onPreviewNode, collapsedGroups, setCollapsedGroups } = state;
    const Icon = NODE_TYPE_ICON[node.type] || FileText;
    const isImage = node.type === CanvasNodeType.Image && node.metadata?.content;
    const isChecked = checked.has(node.id);
    const active = selectMode ? isChecked : selectedNodeIds.has(node.id);
    return (
        <div key={node.id} data-node-item={node.id}
            className={cn("group relative flex items-center rounded-lg transition", depth && "ml-5", active ? "" : "hover:bg-black/5 dark:hover:bg-white/5")}
            style={active ? { background: theme.toolbar.activeBg } : undefined}
            onMouseEnter={() => onHoverNode(node.id)}
            onMouseLeave={(event) => {
                const to = event.relatedTarget as Element | null;
                if (!to || !to.closest("[data-node-item]")) onHoverNode(null);
            }}
        >
            {depth ? <span className="pointer-events-none absolute -left-3 top-[calc(-50%-0.4rem)] h-[calc(100%+0.4rem)] w-3 rounded-bl-md border-b border-l opacity-45" style={{ borderColor: theme.node.stroke }} /> : null}
            {node.type === CanvasNodeType.Group && hasChildren ? (
                <button type="button" onClick={() => setCollapsedGroups((prev) => (prev.has(node.id) ? new Set([...prev].filter((id) => id !== node.id)) : new Set(prev).add(node.id)))} className="ml-1 grid size-6 shrink-0 place-items-center opacity-55 transition hover:opacity-100" aria-label={node.title}>
                    <ChevronRight className={cn("size-3.5 transition-transform", !collapsedGroups.has(node.id) && "rotate-90")} />
                </button>
            ) : null}
            <button type="button" onClick={() => (selectMode ? toggleChecked(node.id) : activateNode(node))} className={cn("flex min-w-0 flex-1 items-center gap-3 py-2 pr-2 text-left", node.type === CanvasNodeType.Group && hasChildren ? "pl-0" : "pl-2")} title={selectMode ? undefined : t("canvas.sidePanel.focusNode")}>
                {selectMode ? <CheckMark checked={isChecked} theme={theme} /> : null}
                <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md">
                    {isImage ? <img src={previewUrlFor(node.metadata?.storageKey) || node.metadata?.content} alt={node.title} className="size-full object-cover" /> : <Icon className="size-5 opacity-60" />}
                </span>
                <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="block truncate text-sm font-medium leading-snug">{node.title || getNodeDefinition(node.type)?.title || t("canvas.node.untitled")}</span>
                    <span className="block truncate text-xs leading-snug opacity-50">{nodePreviewText(node)}</span>
                </span>
                {node.metadata?.status && node.metadata.status !== "idle" ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[node.metadata.status] || "transparent" }} /> : null}
            </button>
            {selectMode || !isImage ? null : (
                <div className="flex shrink-0 flex-col items-center gap-0.5 pr-1.5">
                    <button type="button" onClick={() => onPreviewNode(node.id)} className="grid size-7 place-items-center rounded-md opacity-55 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10" aria-label={t("canvas.sidePanel.preview")} title={t("canvas.sidePanel.preview")}>
                        <Eye className="size-3.5" />
                    </button>
                </div>
            )}
        </div>);
}

function CheckMark({ checked, theme }: { checked: boolean; theme: CanvasTheme }) {
    return (
        <span className="grid size-4 shrink-0 place-items-center rounded border transition" style={{ borderColor: checked ? theme.toolbar.activeText : theme.node.stroke, background: checked ? theme.toolbar.activeText : "transparent" }}>
            {checked ? <Check className="size-3 text-white" /> : null}
        </span>
    );
}
