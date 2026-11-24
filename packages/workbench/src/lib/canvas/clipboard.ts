import { commitHostTransaction } from "@workbench/lib/canvas/host-transaction";
import { nanoid } from "nanoid";
import type { CanvasClipboardFragment, CommandContext } from "@infinite-canvas/plugin-sdk";
import { nodeOpenPanel } from "@infinite-canvas/plugin-sdk/builtin";
import { CanvasNodeType, type Position } from "@infinite-canvas/shared/canvas/schema/canvas";
import { formatConfigReference, parseComposerTokens } from "@infinite-canvas/shared/canvas/config-references";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { executeCommand } from "@workbench/lib/plugins/commands";
import { bindHostActions } from "./host-actions";
import type { CanvasSession } from "./canvas-session";
import { cloneNodeForCopy } from "./node-copy";

export function registerCanvasClipboard(session: CanvasSession, onAvailable?: (available: boolean) => void) {
    let current: CanvasClipboardFragment | undefined;
    let closed = false;
    const getCanvas = (context: CommandContext) => {
        context.signal.throwIfAborted();
        if (closed || session.signal.aborted || context.canvas?.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
        context.canvas.getSnapshot(); // 同 ID 重新打开也不能接管旧会话。
        return context.canvas;
    };
    function copyFragment(nodeIds: string[], context: CommandContext): CanvasClipboardFragment {
        const snapshot = getCanvas(context).getSnapshot();
        const selected = new Set(nodeIds);
        const nodes = snapshot.nodes.filter((node) => selected.has(node.id));
        if (!selected.size || nodes.length !== selected.size) throw new PluginError("PLUGIN_NOT_FOUND");
        return structuredClone({
            projectId: session.projectId,
            nodes: nodes.map(cloneNodeForCopy),
            connections: snapshot.connections.filter((connection) => selected.has(connection.toNodeId)),
        }) as CanvasClipboardFragment;
    }
    const copyToClipboard = async ({ nodeIds }: { nodeIds: string[] }, context: CommandContext) => {
        const fragment = copyFragment(nodeIds, context);
        getCanvas(context);
        current = fragment;
        onAvailable?.(true);
    };
    async function paste(fragment: CanvasClipboardFragment, position: Position, context: CommandContext, fromPage: boolean) {
        getCanvas(context);
        if (fragment.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
        const bounds = fragment.nodes.reduce((rect, node) => ({
            left: Math.min(rect.left, node.position.x),
            top: Math.min(rect.top, node.position.y),
            right: Math.max(rect.right, node.position.x + node.width),
            bottom: Math.max(rect.bottom, node.position.y + node.height),
        }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
        const dx = position.x - (bounds.left + bounds.right) / 2;
        const dy = position.y - (bounds.top + bounds.bottom) / 2;
        const ids = new Map(fragment.nodes.map((node) => [node.id, nanoid()]));
        const nodes = fragment.nodes.map((source) => {
            const node = cloneNodeForCopy(source);
            let metadata = node.metadata;
            if (metadata?.groupId !== undefined) metadata = { ...metadata, groupId: ids.get(metadata.groupId) };
            if (metadata && ["text", "image", "video", "audio"].includes(node.type)) {
                for (const field of ["composerContent", "prompt"] as const) {
                    const value = metadata[field];
                    if (value === undefined) continue;
                    const content = parseComposerTokens(value).map((token) => {
                        const id = token.type === "reference" ? ids.get(token.nodeId) : undefined;
                        return id === undefined ? token.value : formatConfigReference(id);
                    }).join("");
                    if (content !== value) metadata = { ...metadata, [field]: content };
                }
            }
            return {
                ...node,
                id: ids.get(node.id)!,
                title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
                position: { x: node.position.x + dx, y: node.position.y + dy },
                metadata,
            };
        });
        const connections = fragment.connections.map((connection) => ({
            ...connection,
            id: nanoid(),
            fromNodeId: ids.get(connection.fromNodeId) ?? connection.fromNodeId,
            toNodeId: ids.get(connection.toNodeId)!,
        }));
        const result = await commitHostTransaction(getCanvas(context), [
            ...nodes.map((node) => ({ type: "add_node" as const, node })),
            ...connections.map((connection) => ({ type: "connect_nodes" as const, connection })),
        ], { selection: { nodeIds: nodes.map((node) => node.id), connectionId: null } });
        await session.flush();
        const latest = getCanvas(context).getSnapshot();
        if (nodes[0].type !== CanvasNodeType.Group && latest.nodes.some((node) => node.id === nodes[0].id) &&
            (!fromPage || latest.selection.nodeIds.includes(nodes[0].id))) {
            await executeCommand(nodeOpenPanel, { nodeId: nodes[0].id }, { scope: context.scope, signal: context.signal, session });
        }
        getCanvas(context);
        return result;
    }
    const disposeActions = bindHostActions(session, {
        canvasCopyNodes: ({ nodeIds }, context) => copyFragment(nodeIds, context),
        canvasPasteNodes: ({ fragment, position }, context) => paste(fragment, position, context, false),
        canvasCopyToClipboard: copyToClipboard,
        canvasPasteFromClipboard: async ({ position }, context) => {
            getCanvas(context);
            if (!current) throw new PluginError("PLUGIN_NOT_FOUND");
            return paste(current, position, context, true);
        },
    });
    const close = () => {
        if (closed) return;
        closed = true;
        current = undefined;
        onAvailable?.(false);
    };
    session.signal.addEventListener("abort", close, { once: true });
    return () => {
        session.signal.removeEventListener("abort", close);
        close();
        disposeActions();
    };
}
