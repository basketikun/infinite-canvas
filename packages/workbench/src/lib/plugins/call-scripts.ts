import { callScripts } from "@infinite-canvas/plugin-sdk/builtin";
import { setPluginCallScripts } from "@workbench/stores/use-call-script-store";
import { pluginRegistry, workspaceBinding } from "./registry";

export function initializeCallScripts() {
    const sync = () => {
        const scripts = pluginRegistry.query(callScripts, workspaceBinding).map((entry) => ({ id: entry.id, ...entry.value }));
        setPluginCallScripts(scripts).catch((error) => console.error("同步插件调用脚本失败", error));
    };
    pluginRegistry.subscribe(callScripts, workspaceBinding, sync);
    sync();
}
