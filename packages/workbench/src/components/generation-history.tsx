import { type ReactNode, type RefObject, useRef } from "react";
import { Dialog } from "radix-ui";
import { CheckSquare, Plus, Trash2, X } from "lucide-react";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@workbench/components/ui/sheet";
import "./generation-history.css";

type HistoryProps<T> = {
    logs: T[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: (trigger: HTMLButtonElement) => void;
    onPreviewLog: (log: T) => void;
    renderLog: (log: T) => ReactNode;
};

export function GenerationHistory<T extends { id: string; title: string; status: string }>({ logs, selectedLogIds, activeLogId, onSelectedLogIdsChange, onCreateSession, onDeleteSelected, onPreviewLog, renderLog }: HistoryProps<T>) {
    const deletable = logs.filter((log) => log.status !== "pending");
    const allSelected = deletable.length > 0 && selectedLogIds.length === deletable.length;
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : deletable.map((log) => log.id));

    return (
        <div className="generation-workspace-controls">
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">生成记录</h2>
                <span className="generation-history-tag">{logs.length}</span>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="xs" onClick={onCreateSession}><Plus className="size-3.5" />新建</Button>
                <Button type="button" variant="outline" size="xs" disabled={!deletable.length} onClick={toggleAll}><CheckSquare className="size-3.5" />{allSelected ? "取消" : "全选"}</Button>
                <Button type="button" variant="outline" size="xs" className="generation-history-delete" disabled={!selectedLogIds.length} onClick={(event) => onDeleteSelected(event.currentTarget)}><Trash2 className="size-3.5" />删除</Button>
            </div>
            <div className="space-y-3">
                {logs.map((log) => (
                    <div key={log.id} className="relative">
                        <button type="button" aria-current={activeLogId === log.id || undefined} onClick={() => onPreviewLog(log)}
                            className={`block w-full rounded-lg border p-2 text-left transition focus-visible:outline-2 focus-visible:outline-ring ${activeLogId === log.id ? "border-stone-900 bg-blue-50 dark:border-stone-100 dark:bg-blue-950/20" : "border-stone-200 bg-background hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"}`}>
                            {renderLog(log)}
                        </button>
                        <input type="checkbox" className="workbench-checkbox absolute top-3 left-[9px] size-4" aria-label={`选择记录：${log.title}`} checked={selectedLogIds.includes(log.id)} disabled={log.status === "pending"} onChange={(event) => onSelectedLogIdsChange(event.target.checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))} />
                    </div>
                ))}
                {!logs.length ? <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-sm text-stone-500 dark:border-stone-700">暂无生成记录</div> : null}
            </div>
        </div>
    );
}

export function GenerationWorkspaceSheet({ title, open, height, onOpenChange, onClosed, children }: { title: string; open: boolean; height: string; onOpenChange: (open: boolean) => void; onClosed?: () => void; children: ReactNode }) {
    const trigger = useRef<HTMLElement | null>(null);
    const panel = useRef<HTMLDivElement>(null);
    return <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" ref={panel} tabIndex={-1} style={{ height }} showCloseButton={false} aria-describedby={undefined}
            overlayClassName="bg-black/45 supports-backdrop-filter:backdrop-blur-none"
            className="generation-history-sheet gap-0 bg-(--workbench-elevated-panel) text-(--workbench-elevated-text) outline-none data-[side=bottom]:border-0"
            onOpenAutoFocus={(event) => {
                event.preventDefault();
                trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                panel.current?.focus({ preventScroll: true });
            }}
            onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (trigger.current?.isConnected && (document.activeElement === document.body || event.currentTarget instanceof HTMLElement && event.currentTarget.contains(document.activeElement))) {
                    trigger.current.focus({ preventScroll: true });
                }
                onClosed?.();
            }}>
            <SheetHeader className="h-[57px] shrink-0 flex-row items-center gap-2 border-b px-6 py-4">
                <SheetClose aria-label="关闭" className="grid size-6 place-items-center rounded text-current/50 hover:bg-muted hover:text-current"><X className="size-4" /></SheetClose>
                <SheetTitle className="text-base font-semibold text-inherit">{title}</SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
        </SheetContent>
    </Sheet>;
}

export function DeleteGenerationDialog({ open, count, busy, trigger, onClose, onConfirm }: { open: boolean; count: number; busy: boolean; trigger: RefObject<HTMLButtonElement | null>; onClose: () => void; onConfirm: () => void }) {
    return (
        <Dialog.Root open={open} onOpenChange={(open) => { if (!open) onClose(); }}>
            <Dialog.Portal>
                <Dialog.Overlay className="generation-history-overlay fixed inset-0 z-[1100] overflow-y-auto bg-black/45">
                    <Dialog.Content className="generation-workspace-controls workbench-dialog generation-history-confirm relative mx-auto w-[calc(100%_-_16px)] max-w-[520px] rounded-[8px] bg-(--workbench-elevated-panel) px-6 py-5 text-(--workbench-elevated-text) outline-none"
                        onCloseAutoFocus={(event) => {
                            event.preventDefault();
                            const opener = trigger.current;
                            if (opener?.isConnected && (document.activeElement === document.body || event.currentTarget instanceof HTMLElement && event.currentTarget.contains(document.activeElement))) {
                                (opener.disabled ? opener.parentElement?.querySelector("button") : opener)?.focus({ preventScroll: true });
                            }
                        }}>
                        <Dialog.Close aria-label="关闭" className="absolute top-3 right-3 grid size-8 place-items-center rounded text-current/50 hover:bg-muted hover:text-current"><X className="size-5" strokeWidth={1.7} /></Dialog.Close>
                        <Dialog.Title className="mb-2 text-base font-semibold leading-6">删除生成记录</Dialog.Title>
                        <Dialog.Description className="text-sm leading-[22px]">{`确定删除选中的 ${count} 条生成记录吗？`}</Dialog.Description>
                        <footer className="mt-3 flex justify-end gap-2">
                            <Dialog.Close asChild><Button type="button" variant="outline" aria-label="取消">取 消</Button></Dialog.Close>
                            <Button type="button" variant="destructive" aria-label="删除" disabled={busy} onClick={onConfirm}>删 除</Button>
                        </footer>
                    </Dialog.Content>
                </Dialog.Overlay>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
