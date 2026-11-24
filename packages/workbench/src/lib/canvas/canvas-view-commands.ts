import type { CommandContext, PluginCommand } from "@infinite-canvas/plugin-sdk";
import { canvasFocusNode, commands } from "@infinite-canvas/plugin-sdk/builtin";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { builtinPlugin } from "@workbench/lib/plugins/registry";
import { useCanvasStore } from "@workbench/stores/canvas/use-canvas-store";
import type { CanvasSession } from "./canvas-session";
import type { CanvasViewController } from "./canvas-view";
import { hostContext } from "./host-actions";

export async function setCanvasPreferences(session: CanvasSession, patch: { backgroundMode?: "dots" | "lines" | "blank"; showImageInfo?: boolean }) {
    const store = useCanvasStore.getState();
    if (!store.openProject(session.projectId)) throw new PluginError("PLUGIN_PROJECT_CHANGED");
    store.updateProject(session.projectId, patch);
    await hostContext(session).canvas!.flush();
}

export function registerCanvasViewCommands(session: CanvasSession, view: CanvasViewController) {
    const getCanvas = (context: CommandContext) => {
        context.signal.throwIfAborted();
        if (context.canvas?.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
        session.getSnapshot();
        return context.canvas;
    };
    const value: PluginCommand<{ nodeId: string }, void> = {
        command: canvasFocusNode,
        title: "聚焦节点",
        enabled: ({ nodeId }, context) => getCanvas(context).getNodes().some((node) => node.id === nodeId),
        run: ({ nodeId }, context) => view.focusNode(nodeId, context.signal, getCanvas(context)),
    };
    return builtinPlugin.extensions.contribute(commands, { id: canvasFocusNode.id, value });
}
