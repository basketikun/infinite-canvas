import { useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { motion } from "motion/react";
import { canvasSideTabs } from "@infinite-canvas/plugin-sdk/builtin";
import type { PluginCanvasSideTab } from "@infinite-canvas/plugin-sdk";
import type { RegisteredContribution, ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import type { PluginScope } from "@infinite-canvas/plugin-sdk/scope";
import { PluginBoundary } from "@workbench/components/plugins/plugin-contributions";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import type { CanvasViewController } from "@workbench/lib/canvas/canvas-view";
import { createCanvasSideTabScope, resolveCanvasSideTabs } from "@workbench/lib/plugins/canvas-side-tabs";
import { getPluginContributions } from "@workbench/lib/plugins/runtime";
import { CANVAS_SIDE_PANEL_MAX_WIDTH, CANVAS_SIDE_PANEL_MIN_WIDTH, CANVAS_SIDE_PANEL_MOTION_MS, useCanvasSidePanelStore } from "@workbench/stores/use-canvas-side-panel-store";
import { usePluginStore } from "@workbench/stores/use-plugin-store";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import { registerBuiltinSideTabs } from "./builtin-side-tabs";

registerBuiltinSideTabs();

const PANEL_MOTION_SECONDS = CANVAS_SIDE_PANEL_MOTION_MS / 1000;
const PANEL_EASE = [0.22, 1, 0.36, 1] as const;

export function CanvasSidePanel({ view }: { view: CanvasViewController }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const selectedTab = useCanvasSidePanelStore((state) => state.selectedTab);
    const width = useCanvasSidePanelStore((state) => state.width);
    const panelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const panelMounted = useCanvasSidePanelStore((state) => state.panelMounted);
    const panelClosing = useCanvasSidePanelStore((state) => state.panelClosing);
    const setWidth = useCanvasSidePanelStore((state) => state.setWidth);
    const [resizing, setResizing] = useState(false);
    const resizeCleanup = useRef<(() => void) | null>(null);
    const viewId = useId();
    usePluginStore((state) => state.revision);
    const { tabs, activeId } = resolveCanvasSideTabs(selectedTab);
    const selectedEntry = tabs.find(({ entry }) => entry.id === activeId)?.entry;
    const [active, setActive] = useState<{ owner: CanvasViewController; entry: RegisteredContribution<PluginCanvasSideTab>; scope: PluginScope; binding: ScopeBinding } | null>(null);
    useLayoutEffect(() => {
        if (!activeId) return;
        if (useCanvasSidePanelStore.getState().selectedTab !== activeId) useCanvasSidePanelStore.setState({ selectedTab: activeId });
        let scope: PluginScope | undefined;
        const sync = () => {
            const state = useCanvasSidePanelStore.getState();
            if (!state.panelOpen || state.selectedTab !== activeId || view.scope.signal.aborted || selectedEntry!.signal.aborted || (scope && !scope.signal.aborted)) return;
            scope = createCanvasSideTabScope(activeId, view.scope.signal, selectedEntry!.signal);
            const binding: ScopeBinding = { ...view.scope, kind: "view", viewId, signal: scope.signal };
            setActive({ owner: view, entry: selectedEntry!, scope, binding });
        };
        const unsubscribe = useCanvasSidePanelStore.subscribe(sync);
        sync();
        return () => {
            unsubscribe();
            scope?.cancel();
            void scope?.close().catch((error) => console.error("[plugins] canvas side tab cleanup failed", error));
        };
    }, [activeId, selectedEntry, selectedTab, view, viewId]);
    useLayoutEffect(() => {
        const cancel = () => {
            resizeCleanup.current?.();
            useCanvasSidePanelStore.setState({ selectedTab: "builtin:canvas" });
        };
        view.scope.signal.addEventListener("abort", cancel, { once: true });
        return () => { view.scope.signal.removeEventListener("abort", cancel); cancel(); };
    }, [view]);
    const current = panelOpen && active?.owner === view && active.entry === selectedEntry && !active.scope.signal.aborted ? getPluginContributions(canvasSideTabs, active.binding, active.scope).find(({ entry }) => entry.id === activeId) : undefined;
    const contentView = useMemo(() => current ? view.bind(current.ctx, current.entry.id) : null, [current?.ctx, current?.entry, view]);
    const Content = current?.item.Content;
    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        resizeCleanup.current?.();
        const startX = event.clientX;
        const startWidth = width;
        const onMove = (moveEvent: PointerEvent) => {
            setWidth(Math.min(CANVAS_SIDE_PANEL_MAX_WIDTH, Math.max(CANVAS_SIDE_PANEL_MIN_WIDTH, startWidth + moveEvent.clientX - startX)));
        };
        const release = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", release);
            resizeCleanup.current = null;
            setResizing(false);
        };
        resizeCleanup.current = release;
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", release);
    };

    if (!panelMounted) return null;
    return <motion.div className="relative z-[60] flex h-full shrink-0" initial={{ width: 0, opacity: 0 }} animate={{ width: panelOpen ? width + 1 : 0, opacity: panelOpen ? 1 : 0 }} transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }} style={{ overflow: "clip", pointerEvents: panelClosing ? "none" : undefined }}>
        <motion.aside className="relative flex h-full shrink-0 flex-col overflow-hidden border-r" initial={{ x: -48 }} animate={{ x: panelClosing ? -28 : 0 }} transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }} style={{ width, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} data-canvas-no-zoom>
            <div className="flex items-center gap-5 px-4 pt-3.5">
                {tabs.map(({ item, entry }) => <button key={entry.id} type="button" onClick={() => useCanvasSidePanelStore.setState({ selectedTab: entry.id })} className="relative flex items-center gap-1.5 pb-1.5 text-sm font-semibold transition-opacity" style={{ color: theme.node.text, opacity: activeId === entry.id ? 1 : 0.45 }}>
                    {item.icon}{item.title}
                    {activeId === entry.id ? <motion.span layoutId="sidePanelTabIndicator" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full" style={{ background: theme.toolbar.activeText }} transition={{ type: "spring", stiffness: 500, damping: 34 }} /> : null}
                </button>)}
            </div>
            <div className="mt-2 min-h-0 flex-1 overflow-hidden">
                {Content && current && contentView ? <PluginBoundary key={`${current.entry.id}:${current.entry.instanceId}`} pluginId={current.ctx.id} contributionId={`${current.entry.point}/${current.entry.id}`} callbackName="Content" resetKey={current.ctx}><Content ctx={current.ctx} view={contentView} /></PluginBoundary> : null}
            </div>
            <button type="button" className="absolute inset-y-0 right-0 z-40 w-4 translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label="调整左侧面板宽度" />
        </motion.aside>
    </motion.div>;
}
