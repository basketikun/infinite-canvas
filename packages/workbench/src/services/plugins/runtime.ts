import type { PluginAdapter } from "@infinite-canvas/shared/plugins";

export let plugins: PluginAdapter;

export function initializePlugins(adapter: PluginAdapter) {
    if (plugins) throw new Error("PLUGINS_ALREADY_INITIALIZED");
    plugins = adapter;
}
