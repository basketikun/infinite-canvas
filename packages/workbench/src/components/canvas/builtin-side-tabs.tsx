import { canvasSideTabs } from "@infinite-canvas/plugin-sdk/builtin";
import { builtinPlugin } from "@workbench/lib/plugins/registry";
import { CanvasNodesTab } from "./side-panel/nodes";
import { CanvasAssetsTab } from "./side-panel/assets";
import { CanvasPromptsTab } from "./side-panel/prompts";

let registered = false;

export function registerBuiltinSideTabs() {
    if (registered) return;
    registered = true;
    builtinPlugin.extensions.contribute(canvasSideTabs, { id: "builtin:canvas", value: { title: "画布", Content: CanvasNodesTab } });
    builtinPlugin.extensions.contribute(canvasSideTabs, { id: "builtin:assets", value: { title: "资产", Content: CanvasAssetsTab } });
    builtinPlugin.extensions.contribute(canvasSideTabs, { id: "builtin:prompts", value: { title: "提示词库", Content: CanvasPromptsTab } });
}
