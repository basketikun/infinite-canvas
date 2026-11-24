import { canvasSideTabs } from "@infinite-canvas/plugin-sdk/builtin";
import { PluginScope } from "@infinite-canvas/plugin-sdk/scope";
import { useCanvasSidePanelStore } from "@workbench/stores/use-canvas-side-panel-store";
import { getPluginContributions } from "./runtime";

export function resolveCanvasSideTabs(selectedId: string) {
    const tabs = getPluginContributions(canvasSideTabs).filter(({ item }) => !item.hidden);
    const activeId = tabs.find(({ entry }) => entry.id === selectedId)?.entry.id ?? tabs.find(({ ctx }) => ctx.id === "builtin")?.entry.id;
    return { tabs, activeId };
}

export function createCanvasSideTabScope(tabId: string, parentSignal: AbortSignal, entrySignal: AbortSignal) {
    const scope = new PluginScope();
    const signal = AbortSignal.any([parentSignal, entrySignal]);
    const close = () => {
        scope.cancel();
        void scope.close().catch((error) => console.error("[plugins] canvas side tab cleanup failed", error));
    };
    const check = () => {
        const state = useCanvasSidePanelStore.getState();
        if (!state.panelOpen || state.selectedTab !== tabId) close();
    };
    const unsubscribe = useCanvasSidePanelStore.subscribe(check);
    const release = () => {
        unsubscribe();
        signal.removeEventListener("abort", close);
        scope.signal.removeEventListener("abort", release);
    };
    scope.signal.addEventListener("abort", release, { once: true });
    scope.add(release);
    signal.addEventListener("abort", close, { once: true });
    if (signal.aborted) close();
    else check();
    return scope;
}
