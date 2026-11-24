import type { PluginLayout } from "@infinite-canvas/plugin-sdk";
import { layouts } from "@infinite-canvas/plugin-sdk/builtin";
import type { RegisteredContribution } from "@infinite-canvas/plugin-sdk/runtime";
import { PluginScope } from "@infinite-canvas/plugin-sdk/scope";
import { usePluginStore } from "@workbench/stores/use-plugin-store";
import { applicationBinding, pluginRegistry } from "./registry";

export function getSelectedLayout() {
    const id = usePluginStore.getState().layoutSelection;
    return pluginRegistry.query(layouts, applicationBinding).find((entry) => entry.id === id) ?? null;
}

export function createLayoutViewScope(entry: RegisteredContribution<PluginLayout>, parentSignal: AbortSignal) {
    const scope = new PluginScope();
    const close = () => {
        scope.cancel();
        void scope.close().catch((error) => console.error(`[plugins] ${entry.pluginId} ${entry.point}/${entry.id} layout cleanup failed`, error));
    };
    const check = () => { if (getSelectedLayout() !== entry) close(); };
    const unsubscribe = usePluginStore.subscribe(check);
    const release = () => {
        unsubscribe();
        entry.signal.removeEventListener("abort", close);
        parentSignal.removeEventListener("abort", close);
        scope.signal.removeEventListener("abort", release);
    };
    scope.signal.addEventListener("abort", release, { once: true });
    scope.add(release);
    entry.signal.addEventListener("abort", close, { once: true });
    parentSignal.addEventListener("abort", close, { once: true });
    if (entry.signal.aborted || parentSignal.aborted) close();
    else check();
    return scope;
}
