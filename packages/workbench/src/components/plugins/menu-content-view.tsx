import { useId, useLayoutEffect, useState } from "react";
import type { PluginMenuItem, PluginMenuItemContentProps, PluginMenuTarget } from "@infinite-canvas/plugin-sdk";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { createMenuView, type MenuViewOwner } from "@workbench/lib/plugins/menu-view";

function useMenuView(owner: MenuViewOwner, parentBinding: ScopeBinding, target: PluginMenuTarget) {
    const id = useId();
    const targetKey = JSON.stringify(target);
    const [view, setView] = useState<{ owner: MenuViewOwner; parentBinding: ScopeBinding; targetKey: string; value: ReturnType<typeof createMenuView> }>();
    useLayoutEffect(() => {
        const value = createMenuView(owner, parentBinding, `menu:${id}:${targetKey}`);
        setView({ owner, parentBinding, targetKey, value });
        return () => {
            value.scope.cancel();
            void value.scope.close().catch((error) => console.error(`[plugins] ${owner.entry.pluginId} ${owner.entry.point}/${owner.entry.id} menu view cleanup failed`, error));
        };
    }, [id, owner, parentBinding, targetKey]);
    return view?.owner === owner && view.parentBinding === parentBinding && view.targetKey === targetKey && !view.value.scope.signal.aborted ? view.value : null;
}

export function MenuItemContentView({ item, owner, parentBinding, target, theme }: Omit<PluginMenuItemContentProps, "ctx" | "canvas"> & { item: Extract<PluginMenuItem, { type: "content" }>; owner: MenuViewOwner; parentBinding: ScopeBinding }) {
    const view = useMenuView(owner, parentBinding, target);
    if (!view) return null;
    const Content = item.Content;
    return <Content ctx={view.ctx} canvas={view.canvas} target={target} theme={theme} />;
}
