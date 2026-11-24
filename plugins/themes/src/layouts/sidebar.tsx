import { useSyncExternalStore } from "react";
import type { PluginLayout, PluginLayoutProps } from "@infinite-canvas/plugin-sdk";

const narrow = window.matchMedia("(max-width: 767px)");
const subscribeWidth = (listener: () => void) => {
    narrow.addEventListener("change", listener);
    return () => narrow.removeEventListener("change", listener);
};

function SidebarLayout({ items, Link, brand, actions, navigation, children }: PluginLayoutProps) {
    const mobile = useSyncExternalStore(subscribeWidth, () => narrow.matches);
    return <div className="theme-workspace">
        {mobile ? <div className="theme-workspace-mobile">{navigation}</div> : <aside className="theme-workspace-rail">
            <div className="theme-workspace-brand">{brand}</div>
            <nav aria-label="主导航">{items.map((item) => <Link key={item.id} to={item.to} aria-current={item.active ? "page" : undefined}>{item.label}</Link>)}</nav>
            <div className="theme-workspace-actions">{actions}</div>
        </aside>}
        <div className="theme-workspace-page">{children}</div>
    </div>;
}

export const sidebar: PluginLayout = { id: "themes:sidebar", name: "侧栏导航", description: "导航固定在左侧，窄屏自动改用顶部菜单", Frame: SidebarLayout };
