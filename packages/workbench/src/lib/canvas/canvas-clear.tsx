import { Eraser } from "lucide-react";
import type { CanvasSnapshot, PluginCommand } from "@infinite-canvas/plugin-sdk";
import { canvasClear, commands, menus } from "@infinite-canvas/plugin-sdk/builtin";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { builtinPlugin } from "@workbench/lib/plugins/registry";
import { hostActions } from "./host-actions";
import type { CanvasSession } from "./canvas-session";

export function registerCanvasClear(session: CanvasSession, onCleared: () => void) {
    const value: PluginCommand<void, CanvasSnapshot> = {
        command: canvasClear,
        title: "清空画布",
        run: async (_, context) => {
            context.signal.throwIfAborted();
            if (session.signal.aborted || context.canvas?.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
            const canvas = context.canvas;
            const result = await canvas.transact([{ type: "delete_node", ids: canvas.getSnapshot().nodes.map((node) => node.id) }], { selection: { nodeIds: [], connectionId: null } });
            await canvas.flush();
            context.signal.throwIfAborted();
            if (session.signal.aborted) throw new PluginError("PLUGIN_PROJECT_CHANGED");
            onCleared();
            return result;
        },
    };
    const releaseCommand = builtinPlugin.extensions.contribute(commands, { id: canvasClear.id, value });
    const releaseMenu = builtinPlugin.extensions.contribute(menus, {
        id: "builtin:canvas-clear-menu",
        value: {
            id: "builtin:canvas-clear-menu",
            locations: ["canvas.toolbar"],
            transform: ({ canvas, target, items }) => {
                if (target.location !== "canvas.toolbar" || session.signal.aborted || canvas.projectId !== session.projectId) return items;
                return [...items, { id: "builtin:clear:separator", type: "separator" }, {
                    id: "builtin:clear", type: "action", title: "清空画布", icon: <Eraser />, danger: true,
                    run: () => hostActions.canvasOpenClearConfirmation(undefined, canvas.signal),
                }];
            },
        },
    });
    return () => { releaseMenu(); releaseCommand(); };
}
