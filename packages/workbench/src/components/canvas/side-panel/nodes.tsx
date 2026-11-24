import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@infinite-canvas/plugin-sdk/ui/select";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { SidePanelSearch } from "./search";
import { Check, ChevronRight, Download, Eye, FileText, Image as ImageIcon, LayoutGrid, ListChecks, Music2, Rows3, Square, Type, Video } from "lucide-react";
import type { PluginCanvasSideTab, ReadonlyCanvasNode } from "@infinite-canvas/plugin-sdk";
import { nodePreviewImage } from "@infinite-canvas/plugin-sdk/builtin";
import { getPluginErrorMessage, PluginError } from "@infinite-canvas/shared/plugins";
import { CanvasNodeType } from "@infinite-canvas/shared/canvas/schema/canvas";
import { cn } from "@infinite-canvas/plugin-sdk/ui/utils";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { getNodeDefinition, readNodeResource, useNodeRegistryVersion } from "@workbench/lib/canvas/node-registry";
import { loadImagePreview, previewUrlFor, subscribeImagePreviews, getImagePreviewRevision } from "@workbench/services/image-storage";
import { useCanvasSidePanelStore } from "@workbench/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import { hostActions } from "@workbench/lib/canvas/host-actions";

const NODE_TYPE_ICON: Record<string, typeof Square> = {
    [CanvasNodeType.Image]: ImageIcon,
    [CanvasNodeType.Video]: Video,
    [CanvasNodeType.Audio]: Music2,
    [CanvasNodeType.Text]: Type,
    [CanvasNodeType.Group]: Square,
};
const STATUS_COLOR: Record<string, string> = { success: "#22c55e", loading: "#f59e0b", error: "#ef4444", idle: "transparent" };
const nodeFilters = [["all", "全部"], [CanvasNodeType.Image, "图片"], [CanvasNodeType.Video, "视频"], [CanvasNodeType.Text, "文本"], [CanvasNodeType.Audio, "音频"], [CanvasNodeType.Group, "分组"]] as const;

function nodePreviewText(node: ReadonlyCanvasNode) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    return getNodeDefinition(node.type)?.title || node.type;
}

export function CanvasNodesTab({ ctx, view }: ComponentProps<PluginCanvasSideTab["Content"]>) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const canvas = useMemo(() => ctx.canvas(), [ctx]);
    const snapshot = useSyncExternalStore(canvas.subscribe, canvas.getSnapshot);
    const nodes = snapshot.nodes;
    const registryVersion = useNodeRegistryVersion((state) => state.version);
    const resources = useMemo(() => new Map(nodes.map((node) => [node.id, readNodeResource(node, "render", ctx.scope)])), [nodes, ctx.scope, registryVersion]);
    const [failedPreviews, setFailedPreviews] = useState<Record<string, string>>({});
    useEffect(() => { for (const resource of resources.values()) if (resource?.kind === "image") void loadImagePreview(resource.storageKey); }, [resources]);
    const selectedNodeIds = new Set(snapshot.selection.nodeIds);
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const [keyword, setKeyword] = useState("");
    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [selectMode, setSelectMode] = useState(false);
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    const [exporting, setExporting] = useState(false);
    const nodeViewMode = useCanvasSidePanelStore((state) => state.nodeViewMode);
    const setNodeViewMode = useCanvasSidePanelStore((state) => state.setNodeViewMode);
    const filtered = useMemo(() => {
        const query = keyword.toLowerCase();
        return nodes.filter((node) => (typeFilter === "all" || node.type === typeFilter) && (!query || [node.title, node.metadata?.content, node.metadata?.prompt].filter(Boolean).join(" ").toLowerCase().includes(query)));
    }, [nodes, keyword, typeFilter]);
    const treeRows = useMemo(() => {
        const filteredIds = new Set(filtered.map((node) => node.id));
        const groups = new Set(nodes.filter((node) => node.type === CanvasNodeType.Group).map((node) => node.id));
        const children = new Map<string, ReadonlyCanvasNode[]>();
        filtered.forEach((node) => {
            const groupId = node.metadata?.groupId;
            if (groupId && groups.has(groupId)) children.set(groupId, [...(children.get(groupId) || []), node]);
        });
        return nodes.flatMap((node) => {
            if (node.metadata?.groupId && groups.has(node.metadata.groupId)) return [];
            if (node.type !== CanvasNodeType.Group) return filteredIds.has(node.id) ? [{ node, depth: 0, hasChildren: false }] : [];
            const groupChildren = children.get(node.id) || [];
            if (!filteredIds.has(node.id) && !groupChildren.length) return [];
            return [{ node, depth: 0, hasChildren: groupChildren.length > 0 }, ...(collapsedGroups.has(node.id) ? [] : groupChildren.map((child) => ({ node: child, depth: 1, hasChildren: false })))];
        });
    }, [collapsedGroups, filtered, nodes]);
    const exitSelect = () => { setSelectMode(false); setChecked(new Set()); };
    const toggleChecked = (id: string) => setChecked((previous) => {
        const next = new Set(previous);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });
    const allChecked = filtered.length > 0 && filtered.every((node) => checked.has(node.id));
    const focusTimerRef = useRef<number | null>(null);
    useEffect(() => {
        const cancel = () => { if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current); focusTimerRef.current = null; };
        ctx.signal.addEventListener("abort", cancel, { once: true });
        return () => { ctx.signal.removeEventListener("abort", cancel); cancel(); };
    }, [ctx]);
    const hoverNode = (nodeId: string | null) => {
        if (ctx.signal.aborted) return;
        try { view.setHoverNode(nodeId); }
        catch (error) { if (!ctx.signal.aborted) toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error); }
    };
    const activateNode = (node: ReadonlyCanvasNode) => {
        if (ctx.signal.aborted) return;
        if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
        const focus = () => { void view.focusNode(node.id).catch((error) => { if (!ctx.signal.aborted && !(error instanceof PluginError && (error.code === "PLUGIN_INACTIVE" || error.code === "PLUGIN_SCOPE_CLOSED"))) toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error); }); };
        const kind = resources.get(node.id)?.kind;
        const hasPreview = kind === "image" || kind === "video";
        if (!hasPreview) { focus(); return; }
        hoverNode(null);
        focusTimerRef.current = window.setTimeout(() => {
            focusTimerRef.current = null;
            if (!ctx.signal.aborted) focus();
        }, 180);
    };
    const handleExport = async () => {
        if (ctx.signal.aborted) return;
        const nodeIds = [...checked];
        if (!nodeIds.length) return;
        setExporting(true);
        const notice = toast.loading("正在导出选中元素…", { className: "workbench-message", duration: Infinity });
        try {
            await hostActions.canvasExportNodes({ nodeIds }, ctx.signal);
            if (ctx.signal.aborted) return;
            toast.success(`已导出 ${nodeIds.length} 个元素`, workbenchMessageOptions.success);
            exitSelect();
        } catch (error) {
            if (!ctx.signal.aborted) {
                console.error("[canvas] export selected nodes", error);
                toast.error("所选元素未能完整导出，请确认元素和原文件仍可用后重试。", workbenchMessageOptions.error);
            }
        } finally {
            toast.dismiss(notice);
            if (!ctx.signal.aborted) setExporting(false);
        }
    };

    return <div className="flex h-full flex-col" onMouseLeave={() => hoverNode(null)}>
        <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
            <span className="min-w-0 truncate text-xs font-medium opacity-60">画布元素</span>
            {filtered.length ? <span className="shrink-0 text-xs opacity-35">{filtered.length}</span> : null}
            <button type="button" onClick={() => (selectMode ? exitSelect() : setSelectMode(true))} className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10" style={selectMode ? { color: theme.toolbar.activeText, opacity: 1 } : undefined}>
                <ListChecks className="size-3.5" />{selectMode ? "取消" : "选择"}
            </button>
            {selectMode ? null : <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger size="sm" aria-label="节点类型" className="h-6! w-20 border-0 bg-transparent px-1 shadow-none dark:bg-transparent"><SelectValue /></SelectTrigger>
                <SelectContent position="popper" className="z-[1000]" style={{ background: theme.toolbar.panel, color: theme.node.text, borderColor: theme.toolbar.border }}>
                    {nodeFilters.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
            </Select>}
            <button type="button" onClick={() => setNodeViewMode(nodeViewMode === "grid" ? "list" : "grid")} className="flex shrink-0 items-center rounded-md px-1.5 py-1 opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10" title={nodeViewMode === "grid" ? "切换为列表" : "切换为缩略图"} aria-label={nodeViewMode === "grid" ? "切换为列表" : "切换为缩略图"}>
                {nodeViewMode === "grid" ? <Rows3 className="size-3.5" /> : <LayoutGrid className="size-3.5" />}
            </button>
        </div>
        <div className="px-3 pb-2.5"><SidePanelSearch placeholder="搜索节点" value={keyword} onChange={setKeyword} /></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {nodeViewMode === "grid" ? filtered.length ? <div className="grid gap-2 px-1 [grid-template-columns:repeat(auto-fill,minmax(88px,1fr))]">
                {filtered.map((node) => {
                    const Icon = NODE_TYPE_ICON[node.type] || FileText;
                    const resource = resources.get(node.id);
                    const preview = resource?.kind === "image" ? previewUrlFor(resource.storageKey) : undefined;
                    const isChecked = checked.has(node.id);
                    const active = selectMode ? isChecked : selectedNodeIds.has(node.id);
                    return <button key={node.id} type="button" data-node-item onClick={() => (selectMode ? toggleChecked(node.id) : activateNode(node))} onMouseEnter={() => hoverNode(node.id)} onMouseLeave={(event) => {
                        const to = event.relatedTarget as Element | null;
                        if (!to || !to.closest("[data-node-item]")) hoverNode(null);
                    }} className="group relative flex min-w-0 flex-col rounded-lg p-1 text-left transition hover:bg-black/5 dark:hover:bg-white/5" style={active ? { background: theme.toolbar.activeBg } : undefined} title={selectMode ? undefined : "定位到节点"}>
                        <span className="relative grid aspect-square w-full place-items-center overflow-hidden rounded-md">
                            {preview && failedPreviews[node.id] !== preview ? <img src={preview} alt={node.title} onError={() => setFailedPreviews((value) => ({ ...value, [node.id]: preview }))} className="size-full object-cover" /> : <Icon className="size-6 opacity-60" />}
                            {selectMode ? <span className="absolute left-1 top-1"><CheckMark checked={isChecked} /></span> : null}
                            {node.metadata?.status && node.metadata.status !== "idle" ? <span className="absolute right-1 top-1 size-1.5 rounded-full" style={{ background: STATUS_COLOR[node.metadata.status] || "transparent" }} /> : null}
                        </span>
                        <span className="mt-1 block truncate text-xs font-medium leading-snug">{node.title || getNodeDefinition(node.type)?.title || "未命名节点"}</span>
                    </button>;
                })}
            </div> : <div className="pt-16 text-center text-sm opacity-40">画布暂无节点</div> : treeRows.length ? <div className="space-y-1.5">
                {treeRows.map(({ node, depth, hasChildren }) => {
                    const Icon = NODE_TYPE_ICON[node.type] || FileText;
                    const resource = resources.get(node.id);
                    const isImage = resource?.kind === "image";
                    const preview = isImage ? previewUrlFor(resource.storageKey) : undefined;
                    const isChecked = checked.has(node.id);
                    const active = selectMode ? isChecked : selectedNodeIds.has(node.id);
                    return <div key={node.id} data-node-item className={cn("group relative flex items-center rounded-lg transition", depth && "ml-5", active ? "" : "hover:bg-black/5 dark:hover:bg-white/5")} style={active ? { background: theme.toolbar.activeBg } : undefined} onMouseEnter={() => hoverNode(node.id)} onMouseLeave={(event) => {
                        const to = event.relatedTarget as Element | null;
                        if (!to || !to.closest("[data-node-item]")) hoverNode(null);
                    }}>
                        {depth ? <span className="pointer-events-none absolute -left-3 top-[calc(-50%-0.4rem)] h-[calc(100%+0.4rem)] w-3 rounded-bl-md border-b border-l opacity-45" style={{ borderColor: theme.node.stroke }} /> : null}
                        {node.type === CanvasNodeType.Group && hasChildren ? <button type="button" onClick={() => setCollapsedGroups((previous) => previous.has(node.id) ? new Set([...previous].filter((id) => id !== node.id)) : new Set(previous).add(node.id))} className="ml-1 grid size-6 shrink-0 place-items-center opacity-55 transition hover:opacity-100" aria-label={node.title}>
                            <ChevronRight className={cn("size-3.5 transition-transform", !collapsedGroups.has(node.id) && "rotate-90")} />
                        </button> : null}
                        <button type="button" onClick={() => (selectMode ? toggleChecked(node.id) : activateNode(node))} className={cn("flex min-w-0 flex-1 items-center gap-3 py-2 pr-2 text-left", node.type === CanvasNodeType.Group && hasChildren ? "pl-0" : "pl-2")} title={selectMode ? undefined : "定位到节点"}>
                            {selectMode ? <CheckMark checked={isChecked} /> : null}
                            <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md">{preview && failedPreviews[node.id] !== preview ? <img src={preview} alt={node.title} onError={() => setFailedPreviews((value) => ({ ...value, [node.id]: preview }))} className="size-full object-cover" /> : <Icon className="size-5 opacity-60" />}</span>
                            <span className="min-w-0 flex-1 space-y-0.5"><span className="block truncate text-sm font-medium leading-snug">{node.title || getNodeDefinition(node.type)?.title || "未命名节点"}</span><span className="block truncate text-xs leading-snug opacity-50">{nodePreviewText(node)}</span></span>
                            {node.metadata?.status && node.metadata.status !== "idle" ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[node.metadata.status] || "transparent" }} /> : null}
                        </button>
                        {selectMode || !isImage ? null : <div className="flex shrink-0 flex-col items-center gap-0.5 pr-1.5"><button type="button" onClick={() => { void ctx.commands.execute(nodePreviewImage, { nodeId: node.id }, { scope: ctx.scope }).catch((error) => { if (!ctx.signal.aborted && !(error instanceof PluginError && ["PLUGIN_INACTIVE", "PLUGIN_SCOPE_CLOSED", "PLUGIN_PROJECT_CHANGED"].includes(error.code))) toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error); }); }} className="grid size-7 place-items-center rounded-md opacity-55 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10" aria-label="放大预览" title="放大预览"><Eye className="size-3.5" /></button></div>}
                    </div>;
                })}
            </div> : <div className="pt-16 text-center text-sm opacity-40">画布暂无节点</div>}
        </div>
        {selectMode ? <div className="flex items-center gap-2 border-t px-3 py-2.5" style={{ borderColor: theme.toolbar.border }}>
            <button type="button" onClick={() => setChecked(allChecked ? new Set() : new Set(filtered.map((node) => node.id)))} className="rounded-md px-2 py-1 text-xs font-medium opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10">{allChecked ? "取消全选" : "全选"}</button>
            <span className="text-xs opacity-45">{`已选 ${checked.size}`}</span>
            <button type="button" onClick={() => void handleExport()} disabled={!checked.size || exporting} className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10" style={{ color: theme.node.text }}><Download className="size-3.5" />导出选中</button>
        </div> : null}
    </div>;
}

function CheckMark({ checked }: { checked: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return <span className="grid size-4 shrink-0 place-items-center rounded border transition" style={{ borderColor: checked ? theme.toolbar.activeText : theme.node.stroke, background: checked ? theme.toolbar.activeText : "transparent" }}>{checked ? <Check className="size-3 text-white" /> : null}</span>;
}
