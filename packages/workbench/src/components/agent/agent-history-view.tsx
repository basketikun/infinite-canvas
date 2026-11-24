import { useRef, useState } from "react";
import { useMatch } from "react-router-dom";
import { Popover as PopoverPrimitive } from "radix-ui";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@infinite-canvas/plugin-sdk/ui/popover";
import { CircleAlert, Trash2 } from "lucide-react";
import dayjs from "dayjs";

import { useAgentChatStore } from "@workbench/stores/use-agent-chat-store";
import { useAgentStore } from "@workbench/stores/use-agent-store";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import "./agent-history.css";

export function AgentHistoryView() {
    const projectId = useMatch("/canvas/:id")!.params.id!;
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const threads = useAgentChatStore((state) => state.threads);
    const activeThreadId = useAgentChatStore((state) => state.activeThreadIds[projectId]);
    const storageError = useAgentChatStore((state) => state.storageError);
    const receiving = useAgentChatStore((state) => state.receiving);
    const deletions = useAgentChatStore((state) => state.deletions);
    const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
    const [confirmation, setConfirmation] = useState<{ id: string } | null>(null);
    const list = useRef<HTMLDivElement>(null);
    const busy = useAgentStore((state) => Boolean(state.runningThreadId));
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const items = threads.filter((thread) => thread.projectId === projectId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (confirmation && (!panelOpen || !items.some((thread) => thread.id === confirmation.id))) setConfirmation(null);
    return (
        <div ref={list} className="min-h-0 flex-1 overflow-y-auto p-3">
            {items.length ? items.map((thread) => {
                const deletion = deletions.get(thread.id);
                const disabled = busy || storageError || receiving.has(thread.id);
                const close = () => setConfirmation((current) => current?.id === thread.id && current === confirmation ? null : current);
                return <div key={thread.id} className="group flex items-center gap-1 rounded-lg px-2 hover:bg-black/5 dark:hover:bg-white/10" style={{ background: thread.id === activeThreadId ? theme.toolbar.activeBg : undefined }}>
                    <button type="button" disabled={disabled || Boolean(deletion)} aria-current={thread.id === activeThreadId} className="min-w-0 flex-1 py-3 text-left disabled:opacity-50" onClick={() => { useAgentChatStore.getState().selectThread(projectId, thread.id); useAgentStore.getState().setAgentState({ activeTab: "chat" }); }}>
                        <div className="truncate text-sm">{thread.title}</div>
                        <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>{dayjs(thread.updatedAt).format("YYYY-MM-DD HH:mm:ss")}</div>
                        {deletion || notice?.id === thread.id ? <div role="status" className="mt-1 text-xs">{deletion === "pending" ? "正在删除对话…" : deletion ? "删除未完成，请重试。" : notice?.text}</div> : null}
                    </button>
                    <Popover open={panelOpen && confirmation?.id === thread.id} onOpenChange={(open) => open ? setConfirmation({ id: thread.id }) : close()}>
                        <PopoverTrigger asChild>
                            <Button type="button" size="icon-sm" variant="ghost" className="agent-panel-action" disabled={disabled || deletion === "pending"} aria-label={`${deletion === "error" ? "重试删除对话" : "删除对话"}：${thread.title}`}><Trash2 className="size-3.5" /></Button>
                        </PopoverTrigger>
                        <PopoverContent side="top" sideOffset={5} role="alertdialog" aria-label="删除这段对话？" aria-describedby={`history-confirm-${thread.id}`} data-canvas-shortcuts-ignore className="agent-history-confirm generation-workspace-controls workbench-dialog" onCloseAutoFocus={(event) => {
                            const ui = useAgentStore.getState();
                            if (!list.current || !ui.panelOpen || ui.canvasContext?.snapshot.projectId !== projectId) { event.preventDefault(); return; }
                            if (!useAgentChatStore.getState().threads.some((item) => item.id === thread.id) && document.activeElement === document.body) {
                                event.preventDefault();
                                const target = list.current.querySelector<HTMLButtonElement>("button[aria-current]:enabled") ?? list.current.closest("aside")?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
                                target?.focus();
                            }
                        }}>
                            <div className="grid grid-cols-[14px_1fr] gap-x-2 gap-y-1">
                                <CircleAlert aria-hidden className="agent-history-warning mt-1 size-3.5" />
                                <strong className="font-semibold">删除这段对话？</strong>
                                <p id={`history-confirm-${thread.id}`} className="col-start-2">画布上的内容会保留。</p>
                            </div>
                            <div className="mt-2 flex justify-end gap-2">
                                <Button type="button" variant="outline" size="xs" aria-label="取消" onClick={close}>取 消</Button>
                                <Button type="button" size="xs" aria-label="删除" disabled={disabled || deletion === "pending"} onClick={async () => {
                                    if (useAgentStore.getState().canvasContext?.snapshot.projectId !== projectId) return;
                                    setNotice(null);
                                    try { await useAgentChatStore.getState().deleteThread(thread.id); }
                                    catch { setNotice({ id: thread.id, text: "请确认当前对话后重新删除。" }); }
                                    close();
                                }}>删 除</Button>
                            </div>
                            <PopoverPrimitive.Arrow width={14} height={7} className="fill-[var(--workbench-elevated-panel)]" />
                        </PopoverContent>
                    </Popover>
                </div>;
            }) : <div className="py-10 text-center text-sm" style={{ color: theme.node.muted }}>还没有聊天记录</div>}
        </div>
    );
}
