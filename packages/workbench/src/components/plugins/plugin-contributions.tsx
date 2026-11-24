import { Link, useParams } from "react-router-dom";
import { Component, Fragment, useContext, useId, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@workbench/components/ui/sheet";
import { NavigationCatalogContext } from "@workbench/constant/navigation-tools";
import { PluginScope } from "@infinite-canvas/plugin-sdk/scope";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { getPluginContributions, pluginProjectBinding } from "@workbench/lib/plugins/runtime";
import { panels, settings, pages, syncTransports } from "@infinite-canvas/plugin-sdk/builtin";
import { SyncConnectionSettings } from "./sync-connection-settings";
import { pluginRegistry, workspaceBinding } from "@workbench/lib/plugins/registry";
import { usePluginViewScope } from "@workbench/hooks/use-plugin-view-scope";
import { usePluginStore } from "@workbench/stores/use-plugin-store";

type BoundaryProps = { children: ReactNode; resetKey: unknown; remountOnReset?: boolean; pluginId: string; contributionId: string; callbackName: string; fallback?: ReactNode };
type BoundaryState = { failed: boolean; resetKey: unknown; generation: number };

export class PluginBoundary extends Component<BoundaryProps, BoundaryState> {
    state: BoundaryState = { failed: false, resetKey: this.props.resetKey, generation: 0 };
    static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState) {
        if (Object.is(props.resetKey, state.resetKey)) return null;
        return { failed: false, resetKey: props.resetKey, generation: state.generation + (props.remountOnReset ? 1 : 0) };
    }
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch(error: Error, info: ErrorInfo) {
        const { pluginId, contributionId, callbackName } = this.props;
        console.error(`[plugins] ${pluginId} ${contributionId} ${callbackName}`, error, info.componentStack);
    }
    render() {
        if (this.state.failed) return this.props.fallback ?? <p className="p-4 text-sm">插件暂时无法显示，请关闭后重试。</p>;
        return this.props.remountOnReset ? <Fragment key={this.state.generation}>{this.props.children}</Fragment> : this.props.children;
    }
}

export function PluginPanels() {
    usePluginStore((state) => state.revision);
    usePluginStore((state) => state.canvasRevision);
    const panel = usePluginStore((state) => state.panel);
    const returnFocus = useRef<{ panel: NonNullable<typeof panel>; target: HTMLElement | null } | null>(null);
    if (!panel || panel.signal.aborted || panel.project !== pluginProjectBinding || !pluginRegistry.getSnapshot(panels).includes(panel.entry)) return null;
    const entry = getPluginContributions(panels, panel.binding, panel.scope).find(({ entry }) => entry.id === panel.id);
    if (!entry) return null;
    const Content = entry.item.Content;
    let canvas;
    try { canvas = entry.ctx.canvas(); } catch { return null; }
    const workspace = entry.item.presentation === "workspace";
    return <Sheet key={panel.binding.viewId} open onOpenChange={(open) => { if (!open) panel.close(); }}>
        <SheetContent
            data-canvas-no-zoom
            aria-describedby={undefined}
            className={`gap-0 data-[side=right]:max-w-full ${workspace ? "data-[side=right]:w-full data-[side=right]:sm:max-w-none" : "data-[side=right]:w-[380px] data-[side=right]:sm:max-w-[380px]"}`}
            onOpenAutoFocus={(event) => {
                if (usePluginStore.getState().panel !== panel || panel.signal.aborted) { event.preventDefault(); return; }
                returnFocus.current = { panel, target: document.activeElement as HTMLElement | null };
            }}
            onCloseAutoFocus={(event) => {
                event.preventDefault();
                const focus = returnFocus.current;
                if (focus?.panel === panel && panel.project === pluginProjectBinding && panel.canRestoreFocus() && focus.target?.isConnected) focus.target.focus();
            }}
            onKeyDown={(event) => event.stopPropagation()}
            onKeyUp={(event) => event.stopPropagation()}
        >
            <SheetHeader className="shrink-0 border-b py-4 pr-14 pl-6"><SheetTitle>{entry.item.title}</SheetTitle></SheetHeader>
            <div className={workspace ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-y-auto p-6"}>
                <PluginBoundary resetKey={entry.entry} remountOnReset pluginId={entry.ctx.id} contributionId={`${entry.entry.point}/${entry.entry.id}`} callbackName="Content"><Content ctx={entry.ctx} canvas={canvas} onClose={() => { if (!entry.ctx.signal.aborted && !entry.entry.signal.aborted) panel.close(); }} /></PluginBoundary>
            </div>
        </SheetContent>
    </Sheet>;
}

export function PluginSettingsView({ pluginId, entryId, signal }: { pluginId: string; entryId: string; signal: AbortSignal }) {
    usePluginStore((state) => state.revision);
    const viewId = useId();
    const [scope, setScope] = useState<PluginScope>();
    useLayoutEffect(() => {
        const view = new PluginScope();
        const close = () => {
            view.cancel();
            void view.close().catch((error) => console.error("[plugins] settings cleanup failed", error));
        };
        signal.addEventListener("abort", close, { once: true });
        setScope(view);
        return () => { signal.removeEventListener("abort", close); close(); };
    }, [pluginId, entryId, signal]);
    const binding = useMemo<ScopeBinding | null>(() => scope ? { ...workspaceBinding, kind: "view", viewId: `settings:${pluginId}:${viewId}`, signal: scope.signal } : null, [scope, pluginId, viewId]);
    if (!scope || !binding || scope.signal.aborted) return null;
    const section = getPluginContributions(settings, binding, scope).find(({ ctx, entry }) => ctx.id === pluginId && entry.id === entryId);
    if (section) {
        const Content = section.item.Content;
        return <PluginBoundary resetKey={section.ctx} pluginId={pluginId} contributionId={`${section.entry.point}/${section.entry.id}`} callbackName="Content"><Content ctx={section.ctx} /></PluginBoundary>;
    }
    const transport = pluginRegistry.query(syncTransports, binding).find((entry) => entry.pluginId === pluginId && entry.id === entryId);
    return transport ? <SyncConnectionSettings entry={transport} scope={scope} /> : null;
}

export function PluginPageView() {
    const { pageId } = useParams();
    const navigation = useContext(NavigationCatalogContext);
    usePluginStore((state) => state.revision);
    const binding = usePluginViewScope(`page:${pageId}`);
    const plugin = usePluginStore((state) => state.plugins.find((record) => record.package.infiniteCanvas.id === pageId?.split(":")[0]));
    const status = usePluginStore((state) => state.states[plugin?.package.infiniteCanvas.id ?? ""]?.status);
    const entry = binding ? getPluginContributions(pages, binding).find(({ entry }) => entry.id === pageId) : undefined;
    if (!entry && plugin?.enabled && !plugin.startupSkipped && (status === undefined || status === "starting")) return <p className="p-8">正在打开插件页面…</p>;
    if (!entry) return <div className="p-8"><h1 className="text-xl font-medium">此页面暂不可用</h1><p className="mt-3 opacity-60">请在设置中启用对应插件。</p><Link to="/canvas" className="mt-6 inline-block underline">返回画布</Link></div>;
    const Content = entry.item.Content;
    return <div className="h-full min-h-0 overflow-y-auto"><PluginBoundary resetKey={entry.ctx} pluginId={entry.ctx.id} contributionId={`${entry.entry.point}/${entry.entry.id}`} callbackName="Content"><Content ctx={entry.ctx} navigation={navigation} /></PluginBoundary></div>;
}
