import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Select, SelectItem, SelectTrigger, SelectValue } from "@infinite-canvas/plugin-sdk/ui/select";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Eye, LoaderCircle, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { AlertDialog, Select as SelectPrimitive } from "radix-ui";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { PromptSourceEditorDrawer } from "./prompt-source-editor-drawer";
import { PromptSourceContentModal } from "./prompt-source-content-modal";
import { SettingsNetworkSwitch } from "./settings-network-controls";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { fetchPromptSourceStatuses, refreshAllSources, refreshSource } from "@workbench/services/api/prompts";
import { PROMPT_SOURCE_INTERVALS, usePromptSourceStore } from "@workbench/stores/use-prompt-source-store";
import type { PromptSource } from "@workbench/services/api/prompt-source-presets";
import "./config-network.css";

const STATUS_QUERY_KEY = ["prompt-source-statuses"];
const intervalLabels: Record<number, string> = { 0: "关闭定时", 30: "每 30 分钟", 60: "每 1 小时", 360: "每 6 小时", 1440: "每 24 小时" };

export function ConfigPromptSources({ signal }: { signal: AbortSignal }) {
    const queryClient = useQueryClient();
    const sources = usePromptSourceStore((state) => state.sources);
    const schedule = usePromptSourceStore((state) => state.schedule);
    const addSource = usePromptSourceStore((state) => state.addSource);
    const saveSource = usePromptSourceStore((state) => state.saveSource);
    const removeSource = usePromptSourceStore((state) => state.removeSource);
    const toggleSource = usePromptSourceStore((state) => state.toggleSource);
    const updateSchedule = usePromptSourceStore((state) => state.updateSchedule);
    const statusQuery = useQuery({ queryKey: STATUS_QUERY_KEY, queryFn: fetchPromptSourceStatuses });

    const [editor, setEditor] = useState<{ source: PromptSource; trigger: HTMLButtonElement; open: boolean } | null>(null);
    const [viewing, setViewing] = useState<{ source: PromptSource; trigger: HTMLButtonElement; open: boolean } | null>(null);
    useLayoutEffect(() => {
        const closeSourceViews = () => { setEditor(null); setViewing(null); };
        signal.addEventListener("abort", closeSourceViews, { once: true });
        return () => signal.removeEventListener("abort", closeSourceViews);
    }, [signal]);
    const [refreshingSources, setRefreshingSources] = useState<PromptSource[]>([]);
    const [refreshingAll, setRefreshingAll] = useState(false);
    const [deleting, setDeleting] = useState<{ source: PromptSource; trigger: HTMLButtonElement } | null>(null);
    const addButton = useRef<HTMLButtonElement>(null);

    const invalidatePrompts = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["prompts"] }),
            queryClient.invalidateQueries({ queryKey: ["side-panel-prompts"] }),
            queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
        ]);
    };

    const saveChange = (write: () => void, failure: string) => {
        if (signal.aborted) return false;
        try {
            write();
            return true;
        } catch {
            toast.error(failure, workbenchMessageOptions.error);
            return false;
        }
    };
    const handleSave = (source: PromptSource) => {
        const saved = saveChange(() => saveSource(source), "来源未保存，请重试。");
        if (saved) void invalidatePrompts();
        return saved;
    };

    const handleRefreshOne = async (source: PromptSource) => {
        if (signal.aborted || refreshingSources.includes(source)) return;
        setRefreshingSources((current) => [...current, source]);
        try {
            const result = await refreshSource(source.id);
            await invalidatePrompts();
            if (!signal.aborted && usePromptSourceStore.getState().sources.includes(source)) toast.success(`「${source.name}」已更新 ${result.count} 条`, workbenchMessageOptions.success);
        } catch {
            await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
            if (!signal.aborted && usePromptSourceStore.getState().sources.includes(source)) toast.error("更新失败，已保留旧缓存", workbenchMessageOptions.error);
        } finally {
            if (!signal.aborted) setRefreshingSources((current) => current.filter((item) => item !== source));
        }
    };

    const handleRefreshAll = async () => {
        if (signal.aborted) return;
        setRefreshingAll(true);
        try {
            const result = await refreshAllSources();
            let timeSaved = true;
            try { updateSchedule("lastFetchedAt", new Date().toISOString()); }
            catch { timeSaved = false; }
            await invalidatePrompts();
            if (signal.aborted) return;
            if (result.failureCount) toast.warning(`更新完成：${result.successCount} 个成功，${result.failureCount} 个失败，失败来源已保留旧缓存`, workbenchMessageOptions.warning);
            else toast.success(`已更新 ${result.successCount} 个来源，共 ${result.total} 条`, workbenchMessageOptions.success);
            if (!timeSaved) toast.error("上次拉取时间未保存，请重试。", workbenchMessageOptions.error);
        } catch {
            if (!signal.aborted) toast.error("更新失败", workbenchMessageOptions.error);
        } finally {
            if (!signal.aborted) setRefreshingAll(false);
        }
    };

    return (
        <div className="prompt-source-list settings-network generation-workspace-controls">
            <div className="mb-2 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                    <label htmlFor="prompt-source-interval" className="whitespace-nowrap text-sm">定时拉取</label>
                    <Select value={String(schedule.intervalMinutes)} onValueChange={(value) => saveChange(() => updateSchedule("intervalMinutes", Number(value)), "拉取周期未保存，请重试。")}>
                        <SelectTrigger id="prompt-source-interval" aria-label="拉取周期" className="settings-network-field w-36"><SelectValue /></SelectTrigger>
                        <SelectPrimitive.Content position="popper" align="start" sideOffset={4} className="workbench-dialog z-[1100] w-(--radix-select-trigger-width) rounded-lg bg-(--workbench-elevated-panel) p-1 shadow-lg" onEscapeKeyDown={(event) => event.stopPropagation()}>
                            <SelectPrimitive.Viewport>
                                {PROMPT_SOURCE_INTERVALS.map((value) => <SelectItem key={value} value={String(value)} className="min-h-8 px-3 data-[state=checked]:bg-accent data-[state=checked]:font-semibold">{intervalLabels[value]}</SelectItem>)}
                            </SelectPrimitive.Viewport>
                        </SelectPrimitive.Content>
                    </Select>
                </div>
                <Button type="button" variant="ghost" aria-busy={refreshingAll} aria-disabled={refreshingAll} onClick={() => { if (!refreshingAll) void handleRefreshAll(); }}>
                    {refreshingAll ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <RefreshCw aria-hidden className="size-4" />}
                    全部立即拉取
                </Button>
                <span className="whitespace-nowrap text-xs text-muted-foreground">{schedule.lastFetchedAt ? `上次拉取 ${formatTime(schedule.lastFetchedAt)}` : "尚未定时拉取"}</span>
                <Button type="button" ref={addButton} className="ml-auto" onClick={(event) => setEditor({ source: addSource(), trigger: event.currentTarget, open: true })}>
                    <Plus aria-hidden className="size-4" />
                    新增来源
                </Button>
            </div>
            <div className="mb-4 text-xs text-muted-foreground">开启周期后，页面打开期间会按周期自动拉取所有启用的来源。</div>

            <div className="space-y-2">
                {sources.map((source) => {
                    const status = statusQuery.data?.[source.id];
                    const busy = refreshingSources.includes(source);
                    return (
                        <div key={source.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3">
                            <SettingsNetworkSwitch size="sm" aria-label={`启用${source.name}`} checked={source.enabled} onCheckedChange={(checked) => {
                                if (saveChange(() => toggleSource(source.id, checked), "来源开关未保存，请重试。")) void invalidatePrompts();
                            }} />
                            <div className="min-w-0 flex-[1_1_220px]">
                                <div className="flex min-w-0 items-center gap-2">
                                    <span className="truncate text-sm font-semibold">{source.name}</span>
                                    {source.builtIn && <span className="generation-wait-tag shrink-0">内置</span>}
                                </div>
                                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                    <a className="max-w-full truncate hover:text-foreground hover:underline" href={source.homepage || source.url} target="_blank" rel="noreferrer">
                                        {source.homepage || source.url}
                                    </a>
                                    <span className="tabular-nums">{`${status?.count ?? 0} 条`}</span>
                                    <span className="generation-wait-tag" data-status={status?.lastError ? "error" : status?.lastSuccessAt ? "success" : undefined} title={status?.lastError || undefined}>
                                        {status?.lastError ? "失败" : status?.lastSuccessAt ? "正常" : "未同步"}
                                    </span>
                                    <span>{status?.lastSuccessAt ? `上次成功 ${formatTime(status.lastSuccessAt)}` : "尚未拉取"}</span>
                                </div>
                            </div>
                            <div className="ml-auto flex max-w-full flex-wrap justify-end gap-2">
                                <Button type="button" variant="outline" size="xs" onClick={(event) => setViewing({ source, trigger: event.currentTarget, open: true })}>
                                    <Eye aria-hidden className="size-3.5" />查看内容
                                </Button>
                                <Button type="button" variant="outline" size="xs" aria-busy={busy} aria-disabled={busy} onClick={() => void handleRefreshOne(source)}>
                                    {busy ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden className="size-3.5" />}
                                    立即拉取
                                </Button>
                                {!source.builtIn && <Button type="button" variant="outline" size="xs" onClick={(event) => setEditor({ source, trigger: event.currentTarget, open: true })}><Pencil aria-hidden className="size-3.5" />编辑来源</Button>}
                                {!source.builtIn && <Button type="button" variant="outline" size="xs" className="prompt-source-delete" onClick={(event) => setDeleting({ source, trigger: event.currentTarget })}><Trash2 aria-hidden className="size-3.5" />删除</Button>}
                            </div>
                        </div>
                    );
                })}
            </div>

            {deleting && <AlertDialog.Root open onOpenChange={(open) => { if (!open) setDeleting(null); }}>
                <AlertDialog.Portal container={deleting.trigger.closest<HTMLElement>('[role="dialog"]')}>
                    <AlertDialog.Overlay className="fixed inset-0 z-[1100] bg-black/45" />
                    <AlertDialog.Content className="workbench-dialog prompt-source-confirm generation-workspace-controls fixed top-[100px] left-1/2 z-[1100] w-[calc(100%_-_16px)] max-w-[416px] -translate-x-1/2 rounded-lg bg-(--workbench-elevated-panel) px-6 py-5 text-(--workbench-elevated-text) shadow-lg outline-none"
                        onEscapeKeyDown={(event) => event.stopPropagation()} onCloseAutoFocus={(event) => {
                            event.preventDefault();
                            if (!signal.aborted) (deleting.trigger.isConnected ? deleting.trigger : addButton.current)?.focus({ preventScroll: true });
                        }}>
                        <div className="grid grid-cols-[22px_1fr] gap-x-3 gap-y-2">
                            <CircleAlert aria-hidden className="mt-0.5 size-[22px] text-[light-dark(#faad14,#d89614)]" />
                            <AlertDialog.Title className="text-base font-semibold">删除「{deleting.source.name}」？</AlertDialog.Title>
                            <AlertDialog.Description className="col-start-2 text-sm">来源配置会被移除，已经加入我的资产的内容不受影响。</AlertDialog.Description>
                        </div>
                        <div className="mt-3 flex justify-end gap-2">
                            <AlertDialog.Cancel asChild><Button type="button" variant="outline" aria-label="取消">取 消</Button></AlertDialog.Cancel>
                            <Button type="button" variant="destructive" aria-label="删除" onClick={async () => {
                                if (!signal.aborted && usePromptSourceStore.getState().sources.includes(deleting.source)) {
                                    if (!saveChange(() => removeSource(deleting.source.id), "来源未删除，请重试。")) return;
                                    await invalidatePrompts();
                                }
                                if (!signal.aborted) setDeleting((current) => current === deleting ? null : current);
                            }}>删 除</Button>
                        </div>
                    </AlertDialog.Content>
                </AlertDialog.Portal>
            </AlertDialog.Root>}
            {editor && !signal.aborted && <PromptSourceEditorDrawer {...editor} signal={signal} onSave={handleSave} onClose={() => setEditor((current) => current === editor ? { ...editor, open: false } : current)} />}
            {viewing && !signal.aborted && sources.includes(viewing.source) && <PromptSourceContentModal {...viewing} signal={signal}
                onClose={() => setViewing((current) => current === viewing ? { ...viewing, open: false } : current)} />}
        </div>
    );
}

function formatTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
