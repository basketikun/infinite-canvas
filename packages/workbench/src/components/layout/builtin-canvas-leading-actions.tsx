import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@infinite-canvas/plugin-sdk/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@infinite-canvas/plugin-sdk/ui/tooltip";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { PluginContext } from "@infinite-canvas/plugin-sdk";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { applicationActions } from "@infinite-canvas/plugin-sdk/builtin";
import { CanvasMenuContent } from "@workbench/components/canvas/canvas-menu-content";
import { useCanvasProjectActions } from "@workbench/hooks/use-canvas-project-actions";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { builtinPlugin } from "@workbench/lib/plugins/registry";
import { useCanvasStore } from "@workbench/stores/canvas/use-canvas-store";
import { useCanvasSidePanelStore } from "@workbench/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@workbench/stores/use-theme-store";

type CanvasActionProps = { ctx: PluginContext; canvasScope: ScopeBinding };

let registered = false;
export function registerBuiltinCanvasLeadingActions() {
    if (registered) return;
    registered = true;
    builtinPlugin.extensions.contribute(applicationActions, {
        id: "builtin:canvas-leading-actions",
        value: {
            transform: ({ ctx, target, items }) => {
                if (target.region !== "canvas-leading") return [...items];
                const canvasScope = target.canvasScope!;
                return [
                    { id: "builtin:side-panel", type: "content", title: "画布面板", content: <CanvasSidePanelAction ctx={ctx} canvasScope={canvasScope} /> },
                    { id: "builtin:project-menu", type: "content", title: "画布菜单", content: <CanvasProjectMenu ctx={ctx} canvasScope={canvasScope} /> },
                    { id: "builtin:project-title", type: "content", title: "画布名称与保存状态", content: <CanvasProjectTitle ctx={ctx} canvasScope={canvasScope} /> },
                    ...items,
                ];
            },
        },
    });
}

function CanvasSidePanelAction({ ctx, canvasScope }: CanvasActionProps) {
    const open = useCanvasSidePanelStore((state) => state.panelOpen);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return <TooltipProvider delayDuration={200} skipDelayDuration={0}><Tooltip><TooltipTrigger asChild>
        <button
            type="button"
            onClick={() => {
                const panel = useCanvasSidePanelStore.getState();
                if (panel.panelOpen) panel.closePanel();
                else panel.openPanel();
            }}
            aria-label={open ? "收起面板" : "展开面板"}
            className="grid size-7 shrink-0 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10"
            style={{ color: theme.node.text }}
        >
            {open ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
        </button>
    </TooltipTrigger><TooltipContent side="bottom">{open ? "收起面板" : "展开面板"}</TooltipContent></Tooltip></TooltipProvider>;
}

function CanvasProjectMenu({ ctx, canvasScope }: CanvasActionProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    useLayoutEffect(() => {
        const close = () => setMenuOpen(false);
        ctx.signal.addEventListener("abort", close, { once: true });
        return () => ctx.signal.removeEventListener("abort", close);
    }, [ctx.signal]);
    return <Popover
        open={menuOpen}
        onOpenChange={(open) => { if (!open || !ctx.signal.aborted && !canvasScope.signal.aborted) setMenuOpen(open); }}>
        <PopoverTrigger asChild>
            <button type="button" className="grid size-7 shrink-0 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label="打开画布菜单">
                <Menu className="size-4" />
            </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={4} aria-label="画布菜单" data-canvas-shortcuts-ignore className="z-[1000] w-auto max-w-[calc(100vw_-_16px)] rounded-xl border p-1.5 shadow-lg" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
            <CanvasMenuContent target={{ location: "canvas.projectMenu" }} items={[]} onClose={() => setMenuOpen(false)} />
        </PopoverContent>
    </Popover>;
}

function CanvasProjectTitle({ ctx, canvasScope }: CanvasActionProps) {
    const projectId = canvasScope.projectId!;
    const project = useCanvasStore((state) => state.projects.find((item) => item.id === projectId));
    const saveStatus = useCanvasStore((state) => state.saveStatus[projectId]);
    const { scope, renameProject } = useCanvasProjectActions(`canvas-title:${projectId}`, ctx.signal);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const titleRef = useRef<HTMLDivElement>(null);
    const edit = useRef<{ title: string; pending: boolean } | null>(null);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const finishEditing = useCallback(async () => {
        const record = edit.current;
        if (!record || record.pending || ctx.signal.aborted) return;
        record.pending = true;
        const saved = await renameProject(projectId, record.title);
        if (edit.current !== record || ctx.signal.aborted || scope?.signal.aborted) return;
        record.pending = false;
        if (saved) {
            edit.current = null;
            setEditing(false);
        }
    }, [ctx.signal, projectId, renameProject, scope]);
    useEffect(() => {
        if (!editing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) void finishEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [editing, finishEditing]);
    if (!project) return null;
    return <div ref={titleRef} className="flex min-w-0 items-center gap-2">
        {editing ? <input
            autoFocus
            value={draft}
            onChange={(event) => {
                if (ctx.signal.aborted) return;
                edit.current = { title: event.target.value, pending: false };
                setDraft(event.target.value);
            }}
            onBlur={() => { void finishEditing(); }}
            onKeyDown={(event) => {
                if (ctx.signal.aborted) return;
                if (event.key === "Enter") void finishEditing();
                if (event.key === "Escape") { edit.current = null; setEditing(false); }
            }}
            className="min-w-0 max-w-[280px] bg-transparent p-0 text-left text-lg font-semibold tracking-normal outline-none"
            style={{ color: theme.node.text }}
        /> : <button
            type="button"
            className="max-w-[280px] truncate border-b border-dashed border-transparent text-left text-lg font-semibold tracking-normal transition hover:border-current"
            onDoubleClick={() => {
                if (ctx.signal.aborted) return;
                edit.current = { title: project.title, pending: false };
                setDraft(project.title);
                setEditing(true);
            }}
            title="双击修改画布名称"
        >
            {project.title || "未命名画布"}
        </button>}
        {saveStatus ? <span role="status" className="shrink-0 text-xs opacity-60">{{ saved: "已保存", pending: "待保存", saving: "保存中", error: "未保存" }[saveStatus]}</span> : null}
    </div>;
}
