import { useLayoutEffect, useMemo } from "react";
import { toast } from "sonner";
import type { PluginMenuItem, PluginMenuTarget } from "@infinite-canvas/plugin-sdk";
import { readonlySnapshot } from "@infinite-canvas/plugin-sdk/readonly-snapshot";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { getPluginErrorMessage, PluginError } from "@infinite-canvas/shared/plugins";
import { PluginBoundary } from "@workbench/components/plugins/plugin-contributions";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { MenuItemContentView } from "@workbench/components/plugins/menu-content-view";
import { resolvePluginMenu } from "@workbench/lib/plugins/menus";
import { pluginProjectBinding } from "@workbench/lib/plugins/runtime";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { usePluginStore } from "@workbench/stores/use-plugin-store";
import { useThemeStore } from "@workbench/stores/use-theme-store";

export function usePluginMenu(target: PluginMenuTarget, defaults: PluginMenuItem[], onClose?: () => void) {
    usePluginStore((state) => state.revision);
    usePluginStore((state) => state.canvasRevision);
    usePluginStore((state) => state.panel);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { items, contentOwners, assertTargetActive } = resolvePluginMenu(target, defaults);
    const binding = pluginProjectBinding;
    const targetKey = JSON.stringify(target);
    const interaction = useMemo(() => ({ active: true }), [binding, targetKey]);
    useLayoutEffect(() => {
        interaction.active = true;
        return () => { interaction.active = false; };
    }, [interaction]);
    const reportFailure = (error: unknown, id: string) => {
        if (binding !== pluginProjectBinding || binding?.signal.aborted || error instanceof PluginError && ["PLUGIN_INACTIVE", "PLUGIN_SCOPE_CLOSED", "PLUGIN_PROJECT_CHANGED"].includes(error.code)) return;
        console.error(`[plugins] menu action ${id} failed`, error);
        toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error);
    };
    const execute = (item: PluginMenuItem) => {
        if (item.type !== "action" || item.hidden || item.disabled || !interaction.active || binding !== pluginProjectBinding) return;
        try {
            binding?.signal.throwIfAborted();
            assertTargetActive();
            onClose?.();
            void Promise.resolve(item.run()).catch((error) => reportFailure(error, item.id));
        } catch (error) {
            reportFailure(error, item.id);
        }
    };
    const renderBoundItemContent = (item: PluginMenuItem, parentBinding: ScopeBinding | null) => {
        if (item.type !== "content" || item.hidden || !parentBinding || parentBinding.signal.aborted) return null;
        const owner = contentOwners.get(item);
        if (!owner) return null;
        return <PluginBoundary key={`${targetKey}:${item.id}`} resetKey={owner} pluginId={owner.entry.pluginId} contributionId={`${owner.entry.point}/${owner.entry.id}/${item.id}`} callbackName="Content" fallback={<></>}>
            <MenuItemContentView item={item} owner={owner} parentBinding={parentBinding} target={readonlySnapshot(target)} theme={readonlySnapshot(theme)} />
        </PluginBoundary>;
    };
    const renderItemContent = (item: PluginMenuItem) => renderBoundItemContent(item, binding);
    return { items, theme, execute, renderItemContent };
}
