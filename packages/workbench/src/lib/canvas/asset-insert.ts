import { commitHostTransaction } from "@workbench/lib/canvas/host-transaction";
import { nanoid } from "nanoid";
import type { CanvasAssetInput, CanvasSnapshot, PluginCommand } from "@infinite-canvas/plugin-sdk";
import { canvasInsertAsset, commands, nodeOpenPanel } from "@infinite-canvas/plugin-sdk/builtin";
import { CanvasNodeType, type CanvasNodeData, type Position } from "@infinite-canvas/shared/canvas/schema/canvas";
import { NODE_DEFAULT_SIZE } from "@infinite-canvas/shared/canvas/schema/node-specs";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { executeCommand } from "@workbench/lib/plugins/commands";
import { builtinPlugin } from "@workbench/lib/plugins/registry";
import { createCanvasNode } from "./canvas-node-factory";
import { fitNodeSize } from "./canvas-node-size";
import type { CanvasSession } from "./canvas-session";

export function registerCanvasAssetInsert(session: CanvasSession) {
    const contribution: PluginCommand<{ asset: CanvasAssetInput; position: Position }, CanvasSnapshot> = {
        command: canvasInsertAsset,
        title: "插入素材",
        run: async ({ asset, position }, context) => {
            context.signal.throwIfAborted();
            if (session.signal.aborted || context.canvas?.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
            const canvas = context.canvas;
            const signal = AbortSignal.any([context.signal, session.signal]);
            let node: CanvasNodeData;
            if (asset.kind === "text") {
                node = {
                    ...createCanvasNode(CanvasNodeType.Text, position, { content: asset.content, status: "success" }),
                    title: asset.title || asset.content.slice(0, 32) || "Assistant Text",
                };
            } else {
                const size = asset.kind === "image" ? fitNodeSize(asset.width, asset.height)
                    : asset.kind === "audio" ? { width: NODE_DEFAULT_SIZE[CanvasNodeType.Audio].width, height: NODE_DEFAULT_SIZE[CanvasNodeType.Audio].height }
                        : fitNodeSize(asset.width || NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, asset.height || NODE_DEFAULT_SIZE[CanvasNodeType.Video].height, 420, 420);
                node = {
                    id: nanoid(),
                    type: asset.kind === "image" ? CanvasNodeType.Image : asset.kind === "audio" ? CanvasNodeType.Audio : CanvasNodeType.Video,
                    title: asset.kind === "image" ? asset.title.slice(0, 32) || "Generated Image" : asset.title,
                    position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
                    ...size,
                    metadata: { content: asset.url, storageKey: asset.storageKey, status: "success", naturalWidth: asset.width, naturalHeight: asset.height, bytes: asset.bytes, mimeType: asset.mimeType, ...(asset.kind === "image" ? { prompt: asset.title } : {}) },
                };
            }
            const commit = () => commitHostTransaction(canvas, [{ type: "add_node", node }], { selection: { nodeIds: [node.id], connectionId: null } });
            commit();
            signal.throwIfAborted();
            if (asset.kind === "image") await executeCommand(nodeOpenPanel, { nodeId: node.id }, { scope: context.scope, signal, session });
            signal.throwIfAborted();
            return canvas.getSnapshot();
        },
    };
    return builtinPlugin.extensions.contribute(commands, { id: canvasInsertAsset.id, value: contribution });
}
