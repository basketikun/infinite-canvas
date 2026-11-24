import { commitHostTransaction } from "@workbench/lib/canvas/host-transaction";
import type { CanvasSnapshot, CommandContext, PluginCommand } from "@infinite-canvas/plugin-sdk";
import { canvasDeleteNodes, canvasGroupNodes, canvasUngroupNodes, commands, nodeDuplicate, nodeOpenPanel } from "@infinite-canvas/plugin-sdk/builtin";
import { canGroupSelectedNodes } from "@infinite-canvas/shared/canvas/ops/groups";
import { canvasNodeMedia } from "@infinite-canvas/shared/canvas/ops/archive-resources";
import { CanvasNodeType } from "@infinite-canvas/shared/canvas/schema/canvas";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { nanoid } from "nanoid";
import { executeCommand } from "@workbench/lib/plugins/commands";
import { builtinPlugin } from "@workbench/lib/plugins/registry";
import type { CanvasSession } from "./canvas-session";
import { cloneNodeForCopy } from "./node-copy";

export function registerCanvasNodeActions(session: CanvasSession, onGroupedSelection: (nodeIds: readonly string[]) => void) {
    const getTargets = (nodeIds: string[], context: CommandContext) => {
        context.signal.throwIfAborted();
        if (session.signal.aborted || context.canvas?.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
        const { nodes } = context.canvas.getSnapshot();
        const selected = new Set(nodeIds);
        if (!selected.size || nodeIds.some((id) => !nodes.some((node) => node.id === id))) throw new PluginError("PLUGIN_NOT_FOUND");
        return { nodes, selected };
    };
    const contributions: PluginCommand<{ nodeIds: string[] }, CanvasSnapshot>[] = [
        {
            command: canvasDeleteNodes,
            title: "删除节点",
            enabled: ({ nodeIds }, context) => Boolean(getTargets(nodeIds, context)),
            run: async ({ nodeIds }, context) => {
                getTargets(nodeIds, context);
                return context.canvas!.transact([{ type: "delete_node", ids: nodeIds }], { selection: { nodeIds: [], connectionId: null } });
            },
        },
        {
            command: canvasUngroupNodes,
            title: "解散分组",
            enabled: ({ nodeIds }, context) => {
                const { nodes, selected } = getTargets(nodeIds, context);
                return nodes.some((node) => selected.has(node.id) && (node.type === CanvasNodeType.Group || Boolean(node.metadata?.groupId)));
            },
            run: async ({ nodeIds }, context) => {
                const { nodes, selected } = getTargets(nodeIds, context);
                const members = nodes.filter((node) => node.type !== CanvasNodeType.Group && (selected.has(node.id) || node.metadata?.groupId && selected.has(node.metadata.groupId))).map((node) => node.id);
                const result = await context.canvas!.transact([{ type: "ungroup_nodes", ids: nodeIds }], { selection: { nodeIds: members, connectionId: null } });
                context.signal.throwIfAborted();
                if (session.signal.aborted) throw new PluginError("PLUGIN_PROJECT_CHANGED");
                onGroupedSelection(members);
                return result;
            },
        },
        {
            command: canvasGroupNodes,
            title: "打组",
            enabled: ({ nodeIds }, context) => canGroupSelectedNodes(getTargets(nodeIds, context).selected, session.getSnapshot().nodes),
            run: async ({ nodeIds }, context) => {
                getTargets(nodeIds, context);
                const id = nanoid();
                const result = await context.canvas!.transact([{ type: "group_nodes", ids: nodeIds, id, title: "组" }], { selection: { nodeIds: [id], connectionId: null } });
                context.signal.throwIfAborted();
                if (session.signal.aborted) throw new PluginError("PLUGIN_PROJECT_CHANGED");
                onGroupedSelection([id]);
                return result;
            },
        },
    ];
    const duplicate: PluginCommand<{ nodeId: string }, CanvasSnapshot> = {
        command: nodeDuplicate,
        title: "复制节点",
        enabled: ({ nodeId }, context) => Boolean(getTargets([nodeId], context)),
        run: async ({ nodeId }, context) => {
            const { nodes } = getTargets([nodeId], context);
            const source = nodes.find((node) => node.id === nodeId)!;
            const id = nanoid();
            const node = { ...cloneNodeForCopy(source), id, title: `${source.title} Copy`, position: { x: source.position.x + 36, y: source.position.y + 36 } };
            const commit = () => {
                const canvas = context.canvas!;
                const connections = canvas.getConnections().filter((edge) => edge.toNodeId === nodeId).map((edge) => ({ ...edge, id: nanoid(), toNodeId: id }));
                return commitHostTransaction(canvas, [
                    { type: "add_node", node },
                    ...connections.map((connection) => ({ type: "connect_nodes" as const, connection })),
                ], { selection: { nodeIds: [id], connectionId: null } });
            };
            if (canvasNodeMedia([node]).length) {
                node.metadata = structuredClone(node.metadata);
                const controller = new AbortController();
                const signal = AbortSignal.any([context.signal, session.signal, controller.signal]);
                const off = session.on("document.committed", (event) => {
                    if (event.removedNodeIds?.includes(nodeId) || session.getSnapshot().nodes.find((item) => item.id === nodeId)?.type !== source.type) controller.abort(new PluginError("PLUGIN_NOT_FOUND"));
                });
                try {
                    signal.throwIfAborted();
                    commit();
                }
                finally { off(); }
            } else commit();
            context.signal.throwIfAborted();
            if (session.signal.aborted) throw new PluginError("PLUGIN_PROJECT_CHANGED");
            if (node.type !== CanvasNodeType.Group) await executeCommand(nodeOpenPanel, { nodeId: id }, { scope: context.scope, signal: context.signal, session });
            context.signal.throwIfAborted();
            return context.canvas!.getSnapshot();
        },
    };
    const disposers = [...contributions, duplicate].map((value) => builtinPlugin.extensions.contribute(commands, { id: value.command.id, value }));
    return () => { for (const dispose of disposers) dispose(); };
}
