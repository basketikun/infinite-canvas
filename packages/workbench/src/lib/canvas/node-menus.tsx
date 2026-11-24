import { Group, Plus, Trash2, Ungroup } from "lucide-react";
import type { PluginMenuItem } from "@infinite-canvas/plugin-sdk";
import { canvasApply, canvasDeleteNodes, canvasGroupNodes, canvasUngroupNodes, menus, nodeDuplicate } from "@infinite-canvas/plugin-sdk/builtin";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { builtinPlugin } from "@workbench/lib/plugins/registry";
import type { CanvasSession } from "./canvas-session";

export function registerCanvasNodeMenus(session: CanvasSession) {
    return builtinPlugin.extensions.contribute(menus, {
        id: "builtin:canvas-node-actions",
        value: {
            id: "builtin:canvas-node-actions",
            locations: ["canvas.nodeContext", "canvas.connectionContext", "canvas.selectionToolbar"],
            transform: ({ ctx, canvas, target, items }) => {
                if (session.signal.aborted || canvas.projectId !== session.projectId) return items;
                const options = { scope: canvas.scope };
                if (target.location === "canvas.connectionContext") return [...items, {
                    id: "builtin:delete", type: "action", icon: <Trash2 />, title: "删除", danger: true,
                    run: () => ctx.commands.execute(canvasApply, { ops: [{ type: "delete_connections", ids: [target.connectionId] }] }, options),
                }];
                if (target.location !== "canvas.nodeContext" && target.location !== "canvas.selectionToolbar") return items;
                const nodeIds = target.location === "canvas.selectionToolbar" ? [...target.nodeIds] : [...canvas.getSelectedIds()];
                const selected = new Set(nodeIds);
                const actions: PluginMenuItem[] = [];
                for (const [command, title, tooltip, Icon] of [[canvasGroupNodes, "打组", "用组节点包住选中节点", Group], [canvasUngroupNodes, "解散组", "取消节点分组", Ungroup]] as const) {
                    if (!ctx.commands.canExecute(command, { nodeIds }, options)) continue;
                    actions.push({
                        id: command === canvasGroupNodes ? "builtin:group" : "builtin:ungroup",
                        type: "action", icon: <Icon className="size-4" />, title, tooltip,
                        run: () => {
                            if (target.location === "canvas.nodeContext") {
                                const current = canvas.getSelectedIds();
                                if (current.length !== selected.size || current.some((id) => !selected.has(id))) throw new PluginError("PLUGIN_INACTIVE");
                            }
                            return ctx.commands.execute(command, { nodeIds }, options);
                        },
                    });
                }
                if (target.location === "canvas.selectionToolbar") return [...actions, ...items];
                return [...actions, {
                    id: "builtin:duplicate", type: "action", icon: <Plus />, title: "复制",
                    disabled: !ctx.commands.canExecute(nodeDuplicate, { nodeId: target.nodeId }, options),
                    run: () => ctx.commands.execute(nodeDuplicate, { nodeId: target.nodeId }, options),
                }, ...items, {
                    id: "builtin:delete", type: "action", icon: <Trash2 />, title: "删除", danger: true,
                    disabled: !ctx.commands.canExecute(canvasDeleteNodes, { nodeIds: [target.nodeId] }, options),
                    run: () => ctx.commands.execute(canvasDeleteNodes, { nodeIds: [target.nodeId] }, options),
                }];
            },
        },
    });
}
