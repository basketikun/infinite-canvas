import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@infinite-canvas/plugin-sdk/ui/table";
import Pagination from "@rc-component/pagination";
import { ChevronLeft, ChevronRight, Copy, Ellipsis, FolderPlus, Inbox, LoaderCircle, RefreshCw, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { PromptDetailDialog } from "@workbench/components/prompts/prompt-detail-dialog";
import { useCopyText } from "@workbench/hooks/use-copy-text";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { fetchSourcePrompts, refreshSource, type Prompt } from "@workbench/services/api/prompts";
import { savePromptAssets } from "@workbench/services/prompt-assets";
import type { PromptSource } from "@workbench/services/api/prompt-source-presets";
import "./prompt-source-content-modal.css";

const pageSize = 10;

export function PromptSourceContentModal({ source, open, signal, trigger, onClose }: { source: PromptSource; open: boolean; signal: AbortSignal; trigger: HTMLButtonElement; onClose: () => void }) {
    const [items, setItems] = useState<Prompt[]>([]);
    const [page, setPage] = useState(1);
    const table = useRef<HTMLTableElement>(null);
    const [loading, setLoading] = useState(false);
    const [detail, setDetail] = useState<{ prompt: Prompt; container: HTMLElement | null } | null>(null);
    const copyText = useCopyText();
    const activeView = useRef<AbortSignal | null>(null);
    const reading = useRef<AbortSignal | null>(null);
    const [saving, setSaving] = useState<string[]>([]);
    const load = useCallback(async (force: boolean) => {
        const view = activeView.current;
        if (!view || view.aborted || reading.current === view) return;
        reading.current = view;
        setLoading(true);
        try {
            if (force) await refreshSource(source.id);
            if (view.aborted) return;
            const next = await fetchSourcePrompts(source.id);
            if (!view.aborted) {
                setItems(next);
                setPage((current) => Math.max(1, Math.min(current, Math.ceil(next.length / pageSize))));
            }
        } catch (error) {
            if (!view.aborted) {
                console.error("[prompts] read source content", error);
                toast.error("拉取提示词失败，请重试。", workbenchMessageOptions.error);
            }
        } finally {
            if (reading.current === view) reading.current = null;
            if (!view.aborted) setLoading(false);
        }
    }, [source]);
    useLayoutEffect(() => {
        setDetail(null);
        setSaving([]);
        setItems([]);
        setPage(1);
        if (!open) return;
        const controller = new AbortController();
        activeView.current = AbortSignal.any([signal, controller.signal]);
        void load(false);
        return () => controller.abort();
    }, [open, signal, load]);

    const copyPrompt = (text: string) => {
        const view = activeView.current;
        if (view) void copyText(text, "提示词已复制", view);
    };

    const saveAsset = async (item: Prompt) => {
        const view = activeView.current;
        if (!view || view.aborted || item.sourceId !== source.id) return;
        setSaving((current) => [...current, item.id]);
        try {
            const result = await savePromptAssets(item, view);
            if (view.aborted) return;
            if (result.imageFailed) toast.warning("文本已加入，封面图片暂时无法保存。", workbenchMessageOptions.warning);
            else toast.success("已加入我的资产", workbenchMessageOptions.success);
        } catch (error) {
            console.error("[prompts] save source asset", error);
            if (!view.aborted) toast.error("暂时无法保存素材，请重试。", workbenchMessageOptions.error);
        } finally {
            if (!view.aborted) setSaving((current) => current.filter((id) => id !== item.id));
        }
    };

    return (
        <>
            <Dialog.Root open={open} onOpenChange={(next) => {
                if (next) return;
                if (detail) setDetail(null);
                else onClose();
            }}>
                <Dialog.Portal container={trigger.closest<HTMLElement>('[role="dialog"]')}>
                    <Dialog.Overlay className="prompt-content-overlay fixed inset-0 z-[1100] overflow-y-auto bg-black/45 px-2">
                        <Dialog.Content className="prompt-content workbench-dialog settings-network generation-workspace-controls relative mx-auto mb-6 w-full max-w-[980px] rounded-lg bg-(--workbench-elevated-panel) px-6 py-5 shadow-lg outline-none"
                            onEscapeKeyDown={(event) => event.stopPropagation()} onCloseAutoFocus={(event) => {
                                event.preventDefault();
                                if (!signal.aborted && trigger.isConnected && (document.activeElement === document.body || event.currentTarget instanceof HTMLElement && event.currentTarget.contains(document.activeElement))) trigger.focus({ preventScroll: true });
                            }}>
                            <Dialog.Close aria-label="关闭" className="absolute top-3 right-3 grid size-8 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><X aria-hidden className="size-4" /></Dialog.Close>
                            <header className="mb-2 flex flex-wrap items-center justify-between gap-2 pr-6">
                                <div className="min-w-0">
                                    <Dialog.Title className="break-words text-base font-semibold">{source.name} · 提示词内容</Dialog.Title>
                                    <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">共 {items.length} 条</Dialog.Description>
                                </div>
                                <Button type="button" size="xs" variant="outline" aria-disabled={loading} aria-busy={loading} onClick={() => void load(true)}>
                                    {loading ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden className="size-3.5" />}立即更新
                                </Button>
                            </header>
                            <div className="relative" aria-busy={loading}>
                                <Table ref={table} className="prompt-content-table table-fixed">
                                    <colgroup><col className="w-[72px]" /><col /><col className="w-[200px]" /><col className="w-[210px]" /></colgroup>
                                    <TableHeader className="sticky top-0 z-1">
                                        <TableRow>{["封面", "标题", "标签", "操作"].map((heading) => <TableHead key={heading} scope="col">{heading}</TableHead>)}</TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {items.slice((page - 1) * pageSize, page * pageSize).map((item) => <TableRow key={item.id}>
                                            <TableCell>{item.coverUrl ? <img src={item.coverUrl} alt="" className="size-12 rounded object-cover" /> : <div className="size-12 rounded bg-muted" />}</TableCell>
                                            <TableCell>
                                                <div className="truncate font-medium">{item.title}</div>
                                                <p className="mt-0.5 line-clamp-2 whitespace-normal text-xs text-muted-foreground">{item.prompt}</p>
                                            </TableCell>
                                            <TableCell><div className="flex flex-wrap gap-1">{item.tags.slice(0, 4).map((tag) => <span key={tag} className="generation-wait-tag">{tag}</span>)}</div></TableCell>
                                            <TableCell><div className="flex flex-wrap gap-1">
                                                <Button type="button" size="xs" variant="ghost" aria-label="复制" onClick={() => copyPrompt(item.prompt)}><Copy aria-hidden className="size-3.5" />复制</Button>
                                                <Button type="button" size="xs" variant="ghost" aria-label="详情" onClick={(event) => setDetail({ prompt: item, container: event.currentTarget.closest<HTMLElement>('[role="dialog"]') })}>详情</Button>
                                                <Button type="button" size="xs" variant="ghost" aria-disabled={saving.includes(item.id)} aria-busy={saving.includes(item.id)} onClick={() => void saveAsset(item)}>
                                                    {saving.includes(item.id) ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : <FolderPlus aria-hidden className="size-3.5" />}加入我的资产
                                                </Button>
                                            </div></TableCell>
                                        </TableRow>)}
                                        {!items.length && <TableRow><TableCell colSpan={4}>
                                            <div className="grid min-h-24 place-content-center justify-items-center gap-2 text-muted-foreground">
                                                <Inbox aria-hidden className="size-9 opacity-60" />暂无提示词
                                            </div>
                                        </TableCell></TableRow>}
                                    </TableBody>
                                </Table>
                                {loading && <div className="absolute inset-0 grid place-items-center bg-background/60" role="status" aria-label="正在拉取提示词"><LoaderCircle aria-hidden className="size-5 animate-spin" /></div>}
                            </div>
                            {items.length > 0 && <nav aria-label="提示词内容分页" className="my-4">
                                <Pagination prefixCls="prompt-content-pages" current={page} pageSize={pageSize} total={items.length} showSizeChanger={false}
                                    onChange={(next) => { setPage(next); table.current?.parentElement?.scrollTo({ top: 0 }); }}
                                    prevIcon={<button type="button" tabIndex={-1} aria-label="上一页"><ChevronLeft /></button>}
                                    nextIcon={<button type="button" tabIndex={-1} aria-label="下一页"><ChevronRight /></button>}
                                    jumpPrevIcon={<Ellipsis />} jumpNextIcon={<Ellipsis />} />
                            </nav>}
                        </Dialog.Content>
                    </Dialog.Overlay>
                </Dialog.Portal>
            </Dialog.Root>
            <PromptDetailDialog container={detail?.container} prompt={detail?.prompt ?? null} onClose={() => setDetail(null)} onCopy={copyPrompt} onSaveAsset={saveAsset} />
        </>
    );
}
