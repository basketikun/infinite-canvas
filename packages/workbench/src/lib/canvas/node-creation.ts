import type { CanvasSnapshot, CommandContext, PluginCommand } from "@infinite-canvas/plugin-sdk";
import { commands, nodeCreate, nodeOpenPanel, nodes } from "@infinite-canvas/plugin-sdk/builtin";
import { CanvasNodeType, type Position } from "@infinite-canvas/shared/canvas/schema/canvas";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { nanoid } from "nanoid";
import { executeCommand } from "@workbench/lib/plugins/commands";
import { builtinPlugin, pluginRegistry } from "@workbench/lib/plugins/registry";
import { createCanvasNode } from "./canvas-node-factory";
import { normalizeConnection } from "./canvas-node-geometry";
import type { CanvasSession } from "./canvas-session";

type CreateNodeInput = { type: string; position: Position; connection?: { nodeId: string; handleType: "source" | "target" } };

export function registerCanvasNodeCreation(session: CanvasSession) {
    const prepare = (input: CreateNodeInput, context: CommandContext) => {
        context.signal.throwIfAborted();
        if (session.signal.aborted || context.canvas?.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
        const entry = pluginRegistry.query(nodes, context.scope).find((item) => item.value.type === input.type);
        const graph = session.getSnapshot();
        if (input.connection && !graph.nodes.some((node) => node.id === input.connection!.nodeId)) throw new PluginError("PLUGIN_NOT_FOUND");
        if (!entry) throw new PluginError("PLUGIN_NOT_FOUND");
        entry.assertActive();
        const node = createCanvasNode(input.type, input.position);
        const connection = input.connection && normalizeConnection(input.connection.nodeId, node.id, [...graph.nodes, node], input.connection.handleType);
        if (input.connection && !connection) throw new PluginError("PLUGIN_OPERATION_FAILED");
        return { entry, node, connection };
    };
    const value: PluginCommand<CreateNodeInput, CanvasSnapshot> = {
        command: nodeCreate,
        title: "创建节点",
        enabled: (input, context) => { prepare(input, context); return true; },
        run: async (input, context) => {
            const { entry, node, connection } = prepare(input, context);
            return pluginRegistry.track(entry, async () => {
                const signal = AbortSignal.any([context.signal, session.signal, entry.signal]);
                let committed = false;
                const checkTargets = () => {
                    signal.throwIfAborted();
                    const current = session.getSnapshot().nodes;
                    if (input.connection && !current.some((item) => item.id === input.connection!.nodeId) || committed && !current.some((item) => item.id === node.id)) throw new PluginError("PLUGIN_NOT_FOUND");
                };
                checkTargets();
                await context.canvas!.transact([
                    { type: "add_node", node },
                    ...(connection ? [{ type: "connect_nodes" as const, connection: { id: nanoid(), ...connection } }] : []),
                ], { selection: { nodeIds: [node.id], connectionId: null }, signal });
                committed = true;
                checkTargets();
                const definition = entry.value;
                const wantsPanel = !definition.hidePanel && (definition.Panel ? Boolean(definition.autoOpenPanel) : Boolean(definition.useBuiltinPanel)) && (!input.connection || input.type !== CanvasNodeType.Text && input.type !== CanvasNodeType.Audio);
                if (wantsPanel) await executeCommand(nodeOpenPanel, { nodeId: node.id }, { scope: context.scope, signal, session });
                checkTargets();
                return context.canvas!.getSnapshot();
            });
        },
    };
    return builtinPlugin.extensions.contribute(commands, { id: nodeCreate.id, value });
}
