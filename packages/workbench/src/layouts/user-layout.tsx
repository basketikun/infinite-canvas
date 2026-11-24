import { useCallback, useContext, useEffect, useId, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useMatch } from "react-router-dom";
import { Puzzle } from "lucide-react";
import type { PluginLayout, PluginLayoutProps } from "@infinite-canvas/plugin-sdk";
import { layouts, pages } from "@infinite-canvas/plugin-sdk/builtin";
import type { RegisteredContribution, ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import type { PluginScope } from "@infinite-canvas/plugin-sdk/scope";
import { CanvasMcpBridge } from "@workbench/components/agent/canvas-mcp-bridge";
import { AgentPanel } from "@workbench/components/agent/agent-panel";
import { AppConfigModal } from "@workbench/components/layout/app-config-modal";
import { AppSidebar } from "@workbench/components/layout/app-sidebar";
import { AppTopBar } from "@workbench/components/layout/app-top-bar";
import { AppTopNav } from "@workbench/components/layout/app-top-nav";
import { StorageNotice } from "@workbench/components/layout/storage-notice";
import { UserStatusActions } from "@workbench/components/layout/user-status-actions";
import { PluginBoundary } from "@workbench/components/plugins/plugin-contributions";
import { NavigationCatalogContext, NavigationContext } from "@workbench/constant/navigation-tools";
import { getPluginContributions } from "@workbench/lib/plugins/runtime";
import { createLayoutViewScope, getSelectedLayout } from "@workbench/lib/plugins/layout";
import { resolveNavigation } from "@workbench/lib/plugins/navigation";
import { workspaceBinding } from "@workbench/lib/plugins/registry";
import { usePluginStore } from "@workbench/stores/use-plugin-store";
import { usePluginViewScope } from "@workbench/hooks/use-plugin-view-scope";

const brand = <Link to="/" className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-base font-medium tracking-tight">
    <span className="size-5 bg-current" style={{ mask: "url(/logo.svg) center / contain no-repeat" }} />无限画布
</Link>;

type NavigationEntry = Omit<PluginLayoutProps["items"][number], "label"> & {
    hidden?: boolean;
    icon: ReactNode;
};

function LayoutFrame({ entry, parentSignal, fallback, ...props }: Pick<PluginLayoutProps, "items" | "actions" | "navigation" | "children"> & { entry: RegisteredContribution<PluginLayout>; parentSignal: AbortSignal; fallback: ReactNode }) {
    const viewId = useId();
    const [view, setView] = useState<{ entry: RegisteredContribution<PluginLayout>; scope: PluginScope; binding: ScopeBinding }>();
    useLayoutEffect(() => {
        const scope = createLayoutViewScope(entry, parentSignal);
        const binding: ScopeBinding = { ...workspaceBinding, kind: "view", viewId: `layout:${viewId}`, signal: scope.signal };
        setView({ entry, scope, binding });
        return () => {
            scope.cancel();
            void scope.close().catch((error) => console.error("[plugins] layout view cleanup failed", error));
        };
    }, [entry, parentSignal, viewId]);
    const current = view?.entry === entry && getSelectedLayout() === entry && !view.scope.signal.aborted ? view : undefined;
    const contribution = current ? getPluginContributions(layouts, current.binding, current.scope).find((item) => item.entry.id === entry.id) : undefined;
    if (!contribution) return fallback;
    const Frame = contribution.item.Frame;
    return <Frame {...props} ctx={contribution.ctx} Link={Link} brand={brand} />;
}

export default function UserLayout({ children }: { children: ReactNode }) {
    const tools = useContext(NavigationContext);
    const { pathname } = useLocation();
    const canvas = useMatch("/canvas/:id");
    const extension = useMatch("/extensions/:pageId");
    usePluginStore((state) => state.revision);
    usePluginStore((state) => state.layoutSelection);
    const viewId = useId();
    const binding = usePluginViewScope(`navigation:${viewId}`);
    const layout = getSelectedLayout();
    const catalog: NavigationEntry[] = tools.map(({ slug, label, icon: Icon }) => ({
        id: slug, title: label, to: `/${slug}`, active: pathname.split("/")[1] === slug,
        icon: <Icon className="size-4" />,
    }));
    for (const { item, entry } of binding ? getPluginContributions(pages, binding) : []) {
        if (!item.navigation) continue;
        const to = `/extensions/${encodeURIComponent(entry.id)}`;
        const active = extension?.params.pageId === entry.id;
        catalog.push({ id: entry.id, title: item.title, to, active, icon: item.icon ?? <Puzzle className="size-4" /> });
    }
    const entries = (binding ? resolveNavigation(catalog, binding) : catalog).map(({ icon, ...item }) => ({ ...item, label: <>{icon}<span>{item.title}</span></> }));
    const items = entries.filter((item) => !item.hidden);
    const actions = <UserStatusActions />;
    const navigation = <AppTopNav items={items} brand={brand} actions={actions} />;
    const sidebar = !canvas;
    const [isDesktop, setIsDesktop] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(min-width: 64rem)").matches);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => typeof window !== "undefined" && localStorage.getItem("workbench-sidebar-collapsed") === "1");
    const toggleSidebar = () => setSidebarCollapsed((value) => {
        const next = !value;
        try { localStorage.setItem("workbench-sidebar-collapsed", next ? "1" : "0"); } catch { /* 本地偏好不可写时只影响下次打开 */ }
        return next;
    });
    useEffect(() => {
        const query = window.matchMedia("(min-width: 64rem)");
        const update = () => setIsDesktop(query.matches);
        update();
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);

    // 布局切换只移动挂载位置，保留当前页面的草稿、筛选与进行中的操作。
    const [pageRoot] = useState(() => {
        const element = document.createElement("div");
        element.className = "h-full min-h-0 min-w-0";
        return element;
    });
    const mount = useCallback((slot: HTMLDivElement | null) => { if (slot) slot.appendChild(pageRoot); }, [pageRoot]);
    const page = <div ref={mount} className="h-full min-h-0 min-w-0 flex-1 overflow-hidden" />;
    const standard = <div className="flex h-full min-h-0 min-w-0">
        {sidebar && isDesktop ? <AppSidebar items={items} brand={brand} collapsed={sidebarCollapsed} onToggle={toggleSidebar} /> : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {sidebar && isDesktop ? <AppTopBar actions={actions} /> : sidebar && !isDesktop ? <div>{navigation}</div> : null}
            {page}
        </div>
    </div>;
    return <NavigationCatalogContext.Provider value={entries}>
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="h-full min-w-0 flex-1 overflow-hidden">
                {!canvas && layout && binding ? <PluginBoundary resetKey={layout} pluginId={layout.pluginId} contributionId={`${layout.point}/${layout.id}`} callbackName="Frame" fallback={standard}>
                    <LayoutFrame entry={layout} parentSignal={binding.signal} fallback={standard} items={items} actions={actions} navigation={navigation}>{page}</LayoutFrame>
                </PluginBoundary> : standard}
            </div>
            {createPortal(children, pageRoot)}
            <StorageNotice>{(noticeOpen) => <AppConfigModal noticeOpen={noticeOpen} />}</StorageNotice>
            <CanvasMcpBridge />
            <AgentPanel />
        </div>
    </NavigationCatalogContext.Provider>;
}
