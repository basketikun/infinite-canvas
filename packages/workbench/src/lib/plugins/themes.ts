import { themes } from "@infinite-canvas/plugin-sdk/builtin";
import { readonlySnapshot } from "@infinite-canvas/plugin-sdk/readonly-snapshot";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import { applicationBinding, pluginRegistry } from "./registry";

export function initializeThemes() {
    const sync = () => {
        const state = useThemeStore.getState();
        const appearance = readonlySnapshot(pluginRegistry.query(themes, applicationBinding).find((entry) => entry.id === state.selection)?.value ?? null);
        const theme = appearance?.mode ?? state.baseTheme;
        if (state.appearance !== appearance || state.theme !== theme) useThemeStore.setState({ appearance, theme });
    };
    pluginRegistry.subscribe(themes, applicationBinding, sync);
    useThemeStore.subscribe((state, previous) => {
        if (state.selection !== previous.selection || state.baseTheme !== previous.baseTheme) sync();
    });
    sync();
}
