import { useMemo, useState, type ComponentProps } from "react";
import { ListEmpty } from "@workbench/components/ui/list-empty";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { SidePanelSearch } from "./search";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronRight, Eye, FileText, LoaderCircle, Plus } from "lucide-react";
import type { PluginCanvasSideTab } from "@infinite-canvas/plugin-sdk";
import { canvasInsertAsset } from "@infinite-canvas/plugin-sdk/builtin";
import { getPluginErrorMessage } from "@infinite-canvas/shared/plugins";
import { cn } from "@infinite-canvas/plugin-sdk/ui/utils";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { runPluginCallback } from "@workbench/lib/plugins/runtime";
import { PromptDetailDialog } from "@workbench/components/prompts/prompt-detail-dialog";
import { fetchSourcePrompts, type Prompt } from "@workbench/services/api/prompts";
import { usePromptSourceStore } from "@workbench/stores/use-prompt-source-store";
import { useThemeStore } from "@workbench/stores/use-theme-store";

export function CanvasPromptsTab({ ctx, view }: ComponentProps<PluginCanvasSideTab["Content"]>) {
    const sources = usePromptSourceStore((state) => state.sources);
    const enabledSources = useMemo(() => sources.filter((source) => source.enabled), [sources]);
    const [keyword, setKeyword] = useState("");
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [detail, setDetail] = useState<Prompt | null>(null);
    const copyPrompt = async (prompt: string) => {
        if (ctx.signal.aborted) return;
        try {
            await runPluginCallback(ctx, "builtin:prompts", "copy", () => navigator.clipboard.writeText(prompt));
            if (!ctx.signal.aborted) toast.success("已复制提示词", workbenchMessageOptions.success);
        } catch {
            if (!ctx.signal.aborted) toast.error("复制失败", workbenchMessageOptions.error);
        }
    };
    const insertPrompt = async (item: Prompt) => {
        if (ctx.signal.aborted) return;
        try { await ctx.commands.execute(canvasInsertAsset, { asset: { kind: "text", content: item.prompt, title: item.title }, position: view.getCenter() }, { scope: ctx.scope }); }
        catch (error) { if (!ctx.signal.aborted) toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error); }
    };
    return <div className="flex h-full flex-col">
        <div className="px-3 pb-2.5 pt-1"><SidePanelSearch placeholder="搜索提示词" value={keyword} onChange={setKeyword} /></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"><div className="space-y-1">
            {enabledSources.length ? enabledSources.map((source) => <PromptSourceGroup key={source.id} sourceId={source.id} sourceName={source.name} keyword={keyword} open={!!expanded[source.id]} onToggle={() => setExpanded((previous) => ({ ...previous, [source.id]: !previous[source.id] }))} onInsert={insertPrompt} onView={(item) => { if (!ctx.signal.aborted) setDetail(item); }} />) : <ListEmpty text="暂无提示词" className="pt-12" />}
        </div></div>
        <PromptDetailDialog prompt={detail} onClose={() => setDetail(null)} onCopy={(prompt) => void copyPrompt(prompt)} />
    </div>;
}

function PromptSourceGroup({ sourceId, sourceName, keyword, open, onToggle, onInsert, onView }: { sourceId: string; sourceName: string; keyword: string; open: boolean; onToggle: () => void; onInsert: (prompt: Prompt) => Promise<void>; onView: (prompt: Prompt) => void }) {
    const showResults = open || !!keyword;
    const query = useQuery({ queryKey: ["side-panel-prompts", sourceId], queryFn: () => fetchSourcePrompts(sourceId), enabled: showResults, staleTime: 1000 * 60 * 60 });
    const filtered = useMemo(() => {
        const items = query.data || [];
        const value = keyword.toLowerCase();
        if (!value) return items;
        return items.filter((item) => [item.title, item.prompt, ...item.tags].join(" ").toLowerCase().includes(value));
    }, [query.data, keyword]);
    return <div>
        <button type="button" onClick={onToggle} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold opacity-75 transition hover:opacity-100">
            <ChevronRight className={cn("size-3.5 transition-transform", showResults && "rotate-90")} /><BookOpen className="size-3.5" /><span className="min-w-0 flex-1 truncate">{sourceName}</span>{showResults && query.isSuccess ? <span className="opacity-50">{filtered.length}</span> : null}
        </button>
        {showResults ? <div className="px-1 pb-2 pt-1">
            {query.isLoading ? <div className="flex justify-center py-6"><LoaderCircle role="status" aria-label="正在加载提示词" className="size-4 animate-spin" /></div> : query.isError ? <button type="button" onClick={() => void query.refetch()} className="block w-full py-4 text-center text-xs text-red-500 opacity-80 transition hover:opacity-100">加载失败，点击重试</button> : filtered.length ? <div className="space-y-1.5">
                {filtered.map((item) => <PromptRow key={item.id} item={item} onInsert={() => void onInsert(item)} onView={() => onView(item)} />)}
            </div> : <div className="py-4 text-center text-xs opacity-40">{keyword ? "无匹配提示词" : "该来源暂无提示词"}</div>}
        </div> : null}
    </div>;
}

function PromptRow({ item, onInsert, onView }: { item: Prompt; onInsert: () => void; onView: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return <div className="group relative flex items-center gap-2.5 rounded-lg px-2 py-2 transition hover:bg-black/5 dark:hover:bg-white/5">
        {item.coverUrl ? <img src={item.coverUrl} alt="" className="size-10 shrink-0 rounded-md object-cover" loading="lazy" /> : <span className="grid size-10 shrink-0 place-items-center rounded-md" style={{ background: theme.node.panel }}><FileText className="size-4 opacity-50" /></span>}
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left"><div className="truncate text-sm font-medium leading-snug">{item.title}</div><div className="mt-0.5 truncate text-xs leading-snug opacity-50">{item.prompt}</div></button>
        <div className="flex shrink-0 flex-col items-center gap-0.5">
            <button type="button" onClick={onView} className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10" aria-label="查看详情" title="查看详情"><Eye className="size-3.5" /></button>
            <button type="button" onClick={onInsert} className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10" style={{ color: theme.toolbar.activeText }} aria-label="插入画布" title="插入画布"><Plus className="size-3.5" /></button>
        </div>
    </div>;
}
