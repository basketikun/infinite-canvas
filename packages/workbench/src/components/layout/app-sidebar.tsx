import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { Ellipsis, LayoutGrid, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import type { PluginLayoutProps } from "@infinite-canvas/plugin-sdk";
import { Dialog, DropdownMenu } from "radix-ui";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import type { CreateSession } from "@workbench/services/create/logs";
import { cn } from "@infinite-canvas/plugin-sdk/ui/utils";
import { useCanvasStore } from "@workbench/stores/canvas/use-canvas-store";
import { useCreateSessionStore } from "@workbench/stores/use-create-session-store";

const RECENT_LIMIT = 5;
const SIDEBAR_MOTION_MS = 260;
const SIDEBAR_MOTION_SECONDS = SIDEBAR_MOTION_MS / 1000;
const SIDEBAR_EASE = [0.22, 1, 0.36, 1] as const;

export function AppSidebar({ items, brand, collapsed = false, onToggle }: Pick<PluginLayoutProps, "items" | "brand"> & { collapsed?: boolean; onToggle: () => void }) {
    const { search } = useLocation();
    const sessions = useCreateSessionStore((state) => state.sessions);
    const hydrated = useCreateSessionStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const projectsHydrated = useCanvasStore((state) => state.hydrated);
    const activeSession = new URLSearchParams(search).get("session");
    const navigate = useNavigate();
    const renameSession = useCreateSessionStore((state) => state.renameSession);
    const removeSession = useCreateSessionStore((state) => state.removeSession);
    const [renameTarget, setRenameTarget] = useState<CreateSession | null>(null);
    const [renameTitle, setRenameTitle] = useState("");
    const [deleteTarget, setDeleteTarget] = useState<CreateSession | null>(null);
    const [busy, setBusy] = useState(false);
    // 收起时先让宽度动画走完再切换成图标布局，避免文字和图标提前跳位。
    const [folded, setFolded] = useState(collapsed);

    useEffect(() => { void useCreateSessionStore.getState().load(); }, []);
    useEffect(() => {
        if (!collapsed) {
            setFolded(false);
            return;
        }
        const timer = window.setTimeout(() => setFolded(true), SIDEBAR_MOTION_MS);
        return () => window.clearTimeout(timer);
    }, [collapsed]);

    const saveRename = async () => {
        if (!renameTarget || busy || !renameTitle.trim()) return;
        setBusy(true);
        try {
            await renameSession(renameTarget.id, renameTitle);
            toast.success("对话已重命名", workbenchMessageOptions.success);
            setRenameTarget(null);
        } catch (error) {
            console.error("[sidebar] rename session", error);
            toast.error("对话未能重命名，请重试。", workbenchMessageOptions.error);
        } finally {
            setBusy(false);
        }
    };
    const confirmRemove = async () => {
        if (!deleteTarget || busy) return;
        setBusy(true);
        try {
            await removeSession(deleteTarget.id);
            toast.success("对话已删除", workbenchMessageOptions.success);
            if (activeSession === deleteTarget.id) navigate("/");
            setDeleteTarget(null);
        } catch (error) {
            console.error("[sidebar] remove session", error);
            toast.error("对话未能删除，请重试。", workbenchMessageOptions.error);
        } finally {
            setBusy(false);
        }
    };

    return <>
    <motion.aside
        initial={false}
        animate={{ width: collapsed ? 64 : 220 }}
        transition={{ duration: SIDEBAR_MOTION_SECONDS, ease: SIDEBAR_EASE }}
        className="flex shrink-0 flex-col overflow-hidden border-r border-border bg-foreground/[0.025]"
    >
        <div className={cn("flex h-14 shrink-0 items-center gap-2 pt-1", folded ? "justify-center" : "justify-between px-4")}>
            <div
                className={cn("min-w-0", collapsed && "[&_a]:gap-0 [&_a]:text-[0px]", folded && "grid size-8 cursor-pointer place-items-center rounded-md transition hover:bg-foreground/[0.06] [&_a]:justify-center")}
                onClickCapture={folded ? (event) => { event.preventDefault(); event.stopPropagation(); onToggle(); } : undefined}
                title={folded ? "展开侧栏" : undefined}
            >{brand}</div>
            {folded ? null : <button type="button" onClick={onToggle} aria-label="收起侧栏" title="收起侧栏" className={cn("grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground cursor-pointer transition hover:text-foreground", collapsed && "pointer-events-none opacity-0")}><PanelLeftClose className="size-4" /></button>}
        </div>
        <nav aria-label="主导航" className="shrink-0 space-y-1 px-2">
            {items.map((item) => <Link key={item.id} to={item.to} aria-current={item.active ? "page" : undefined} aria-label={folded ? item.title : undefined} title={folded ? item.title : undefined}
                className={cn("flex h-10 min-w-0 items-center overflow-hidden rounded-lg text-sm text-muted-foreground transition-colors duration-200 hover:bg-foreground/[0.045] hover:text-foreground [&>span]:min-w-0 [&>span]:truncate [&>span]:transition-opacity [&>span]:duration-150 [&_svg]:size-4",
                    folded ? "justify-center px-0" : "gap-2.5 px-3",
                    collapsed ? "[&>span]:w-0 [&>span]:opacity-0" : "[&>span]:opacity-100 [&>span]:delay-100",
                    item.active && "bg-foreground/[0.07] font-medium text-foreground")}>
                {item.label}
            </Link>)}
        </nav>
        <div className={cn("thin-scrollbar mt-1 min-h-0 w-[220px] flex-1 overflow-y-auto px-2 pb-3 transition-opacity", collapsed ? "invisible pointer-events-none opacity-0" : "visible opacity-100 duration-150 delay-100")}
            inert={collapsed} aria-hidden={collapsed || undefined}>
            <Section title="创作对话" allTo="/create/history" createTo="/create" createLabel="进入创作">
                {!hydrated ? <Empty>加载中…</Empty> : sessions.length ? sessions.slice(0, RECENT_LIMIT).map((session) => <div key={session.id} className="group relative">
                    <Link to={`/create?session=${encodeURIComponent(session.id)}`}
                        className={cn("flex h-8 items-center gap-2 rounded-md px-2 pr-7 text-sm text-muted-foreground transition hover:bg-foreground/[0.045] hover:text-foreground",
                            session.id === activeSession && "bg-foreground/[0.07] font-medium text-foreground")}>
                        <MessageSquare className="size-3.5 shrink-0 opacity-55" />
                        <span className="min-w-0 flex-1 truncate">{session.title || "新对话"}</span>
                        <span className="shrink-0 text-[11px] tabular-nums opacity-45">{session.count}</span>
                    </Link>
                    <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild>
                            <button type="button" aria-label={`更多操作：${session.title || "新对话"}`}
                                className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground opacity-55 transition hover:bg-foreground/[0.08] hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100">
                                <Ellipsis className="size-4" />
                            </button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                            <DropdownMenu.Content align="end" sideOffset={4} className="workbench-dialog z-[1000] min-w-32 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg">
                                <DropdownMenu.Item className="cursor-pointer rounded px-2.5 py-1.5 text-sm outline-none data-highlighted:bg-accent" onSelect={() => { setRenameTarget(session); setRenameTitle(session.title || "新对话"); }}>重命名</DropdownMenu.Item>
                                <DropdownMenu.Item className="cursor-pointer rounded px-2.5 py-1.5 text-sm text-destructive outline-none data-highlighted:bg-accent" onSelect={() => setDeleteTarget(session)}>删除</DropdownMenu.Item>
                            </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                </div>) : <Empty>暂无对话</Empty>}
            </Section>
            <Section title="画布历史" allTo="/canvas" createTo="/canvas?mode=new" createLabel="新建画布">
                {!projectsHydrated ? <Empty>加载中…</Empty> : projects.length ? projects.slice(0, RECENT_LIMIT).map((project) => <Link key={project.id} to={`/canvas/${encodeURIComponent(project.id)}`}
                    className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition hover:bg-foreground/[0.045] hover:text-foreground">
                    <LayoutGrid className="size-3.5 shrink-0 opacity-55" />
                    <span className="min-w-0 flex-1 truncate">{project.title || "未命名画布"}</span>
                </Link>) : <Empty>暂无画布</Empty>}
            </Section>
        </div>
        {folded ? <div className="flex shrink-0 justify-center pb-3"><button type="button" onClick={onToggle} aria-label="展开侧栏" title="展开侧栏" className="grid size-8 place-items-center rounded-md text-muted-foreground cursor-pointer transition hover:text-foreground"><PanelLeftOpen className="size-4" /></button></div> : null}
    </motion.aside>
    <Dialog.Root open={Boolean(renameTarget)} onOpenChange={(open) => { if (!open && !busy) setRenameTarget(null); }}>
        <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-[1100] bg-black/45" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-[1100] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-popover p-5 text-popover-foreground shadow-xl outline-none">
                <Dialog.Title className="text-base font-semibold">重命名对话</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-muted-foreground">修改后的名称会显示在侧栏和对话历史中。</Dialog.Description>
                <Input className="mt-4" aria-label="对话名称" value={renameTitle} autoFocus onChange={(event) => setRenameTitle(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) void saveRename(); if (event.key === "Escape" && !busy) setRenameTarget(null); }} />
                <footer className="mt-5 flex justify-end gap-2">
                    <Button type="button" variant="outline" disabled={busy} onClick={() => setRenameTarget(null)}>取消</Button>
                    <Button type="button" disabled={busy || !renameTitle.trim()} onClick={() => void saveRename()}>{busy ? "保存中…" : "保存"}</Button>
                </footer>
            </Dialog.Content>
        </Dialog.Portal>
    </Dialog.Root>
    <Dialog.Root open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open && !busy) setDeleteTarget(null); }}>
        <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-[1100] bg-black/45" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-[1100] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-popover p-5 text-popover-foreground shadow-xl outline-none">
                <Dialog.Title className="text-base font-semibold">删除对话？</Dialog.Title>
                <Dialog.Description className="mt-2 text-sm text-muted-foreground">{`“${deleteTarget?.title || "新对话"}”及其中的全部记录将被永久删除，此操作无法撤销。`}</Dialog.Description>
                <footer className="mt-5 flex justify-end gap-2">
                    <Button type="button" variant="outline" disabled={busy} onClick={() => setDeleteTarget(null)}>取消</Button>
                    <Button type="button" variant="destructive" disabled={busy} onClick={() => void confirmRemove()}>{busy ? "删除中…" : "确认删除"}</Button>
                </footer>
            </Dialog.Content>
        </Dialog.Portal>
    </Dialog.Root>
    </>;
}

function Section({ title, allTo, createTo, createLabel, children }: { title: string; allTo: string; createTo?: string; createLabel?: string; children: ReactNode }) {
    return <section className="mt-4">
        <div className="flex h-8 items-center justify-between px-2">
            <h2 className="text-[11px] font-medium tracking-wide text-muted-foreground">{title}</h2>
            <div className="flex items-center gap-1">
                <Link to={allTo} aria-label={`查看全部${title}`} className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition hover:bg-foreground/[0.06] hover:text-foreground">全部</Link>
                {createTo ? <Link to={createTo} aria-label={createLabel} title={createLabel} className="grid size-6 place-items-center rounded text-muted-foreground transition hover:bg-foreground/[0.06] hover:text-foreground"><Plus className="size-3.5" /></Link> : null}
            </div>
        </div>
        <div className="space-y-0.5">{children}</div>
    </section>;
}

function Empty({ children }: { children: ReactNode }) {
    return <p className="px-2 py-1.5 text-xs text-muted-foreground/60">{children}</p>;
}
