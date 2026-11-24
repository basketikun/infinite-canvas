import { Plus, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@infinite-canvas/plugin-sdk/ui/tooltip";
import { cn } from "@infinite-canvas/plugin-sdk/ui/utils";
import type { CreateSession } from "@workbench/services/create/logs";

export function CreateHistory({ sessions, activeId, onSelect, onCreate, onDelete, className }: {
    sessions: CreateSession[];
    activeId: string;
    onSelect: (id: string) => void;
    onCreate: () => void;
    onDelete: (id: string) => void;
    className?: string;
}) {
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const trigger = useRef<HTMLButtonElement | null>(null);
    const target = sessions.find((session) => session.id === deleteId);

    return (
        <TooltipProvider>
            <aside className={cn("flex h-full min-h-0 flex-col bg-foreground/[0.025] px-3 py-4", className)}>
                <div className="flex h-10 items-center justify-between px-2">
                    <h1 className="text-[15px] font-semibold tracking-tight">创作记录</h1>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="新建对话" onClick={onCreate}><Plus /></Button>
                        </TooltipTrigger>
                        <TooltipContent>新建对话</TooltipContent>
                    </Tooltip>
                </div>
                <div className="thin-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pt-3">
                    {sessions.map((session) => (
                        <div key={session.id} className="group relative">
                            <button
                                type="button"
                                className={cn(
                                    "flex h-11 w-full items-center gap-2 rounded-lg px-3 pr-9 text-left text-muted-foreground transition hover:bg-foreground/[0.045] hover:text-foreground",
                                    session.id === activeId && "bg-foreground/[0.07] text-foreground",
                                )}
                                onClick={() => onSelect(session.id)}
                            >
                                {session.id === activeId ? <span className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-foreground" /> : null}
                                <span className="min-w-0 flex-1 truncate text-sm font-medium">{session.title || "新对话"}</span>
                                <span className="text-[11px] tabular-nums text-muted-foreground group-hover:invisible group-focus-within:invisible">{session.count}</span>
                            </button>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                                aria-label={`删除${session.title || "新对话"}`}
                                onClick={(event) => {
                                    trigger.current = event.currentTarget;
                                    setDeleteId(session.id);
                                }}
                            >
                                <Trash2 />
                            </Button>
                        </div>
                    ))}
                </div>
            </aside>
            <Dialog.Root open={Boolean(deleteId)} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-[1100] bg-black/45" />
                    <Dialog.Content
                        className="fixed left-1/2 top-1/2 z-[1100] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-popover p-5 text-popover-foreground shadow-xl outline-none"
                        onCloseAutoFocus={(event) => {
                            event.preventDefault();
                            if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
                        }}
                    >
                        <Dialog.Close aria-label="关闭" className="absolute right-3 top-3 grid size-8 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"><X className="size-4" /></Dialog.Close>
                        <Dialog.Title className="text-base font-semibold">删除创作记录？</Dialog.Title>
                        <Dialog.Description className="mt-2 text-sm text-muted-foreground">{`“${target?.title || "新对话"}”及其中的全部生成记录将被永久删除，此操作无法撤销。`}</Dialog.Description>
                        <footer className="mt-5 flex justify-end gap-2">
                            <Dialog.Close asChild><Button type="button" variant="outline">取消</Button></Dialog.Close>
                            <Button type="button" variant="destructive" onClick={() => {
                                if (deleteId) onDelete(deleteId);
                                setDeleteId(null);
                            }}>确认删除</Button>
                        </footer>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </TooltipProvider>
    );
}
