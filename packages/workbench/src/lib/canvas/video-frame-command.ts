import { commitHostTransaction } from "@workbench/lib/canvas/host-transaction";
import { nanoid } from "nanoid";
import type { CommandContext } from "@infinite-canvas/plugin-sdk";
import { nodeOpenPanel } from "@infinite-canvas/plugin-sdk/builtin";
import { CanvasNodeType, type CanvasNodeData } from "@infinite-canvas/shared/canvas/schema/canvas";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { executeCommand } from "@workbench/lib/plugins/commands";
import { pluginRegistry } from "@workbench/lib/plugins/registry";
import { imageMetadata } from "./canvas-node-factory";
import { prepareImage } from "./canvas-session-media";
import { fitNodeSize } from "./canvas-node-size";
import type { CanvasSession } from "./canvas-session";
import { captureVideoFrame } from "./canvas-video-frame";
import { readNodeResource } from "./node-registry";
import { bindHostActions } from "./host-actions";

type FrameResource = NonNullable<ReturnType<typeof readNodeResource>>;

export function requireVideoFrameSource(resource: FrameResource | null, expected?: FrameResource) {
    if (expected?.signal.aborted || resource?.signal.aborted) throw new PluginError("PLUGIN_INACTIVE");
    if (expected && (resource?.kind !== expected.kind || resource.contributionId !== expected.contributionId || resource.storageKey !== expected.storageKey || resource.url !== expected.url)) throw new PluginError("PLUGIN_INACTIVE");
    if (resource?.kind !== "video" || !(resource.storageKey || resource.url)) throw new PluginError("PLUGIN_NOT_FOUND");
    return resource;
}

export function registerVideoFrameCommand(session: CanvasSession) {
    const getVideo = (nodeId: string, context: CommandContext, expected?: FrameResource) => {
        context.signal.throwIfAborted();
        if (session.signal.aborted || context.canvas?.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
        const node = context.canvas.getNodes().find((item) => item.id === nodeId);
        if (!node) throw new PluginError("PLUGIN_NOT_FOUND");
        return { node, resource: requireVideoFrameSource(readNodeResource(node, "execute", context.scope), expected) };
    };
    return bindHostActions(session, {
        nodeCaptureVideoFrame: async (input, context) => {
            const { resource } = getVideo(input.nodeId, context);
            const canvas = context.canvas!;
            const controller = new AbortController();
            const signal = AbortSignal.any([context.signal, session.signal, resource.signal, controller.signal]);
            const current = () => {
                signal.throwIfAborted();
                return getVideo(input.nodeId, context, resource).node;
            };
            const check = () => {
                try { current(); }
                catch (error) { controller.abort(error); }
            };
            const unsubscribe = session.subscribe(check);
            const unsubscribeRegistry = pluginRegistry.subscribeAll(check);
            try {
                const blob = await captureVideoFrame(resource, input.position, input.position === "current" ? input.currentTime : 0, signal);
                current();
                const id = nanoid();
                const image = await prepareImage(blob, signal);
                const node = current();
                const graph = canvas.getSnapshot();
                const size = fitNodeSize(image.width, image.height, 420, 420);
                const x = node.position.x + node.width + 96;
                let y = node.position.y + node.height / 2 - size.height / 2;
                while (graph.nodes.some((item) => item.id !== node.id && item.position.x < x + size.width && item.position.x + item.width > x && item.position.y < y + size.height && item.position.y + item.height > y)) y += size.height + 24;
                const child: CanvasNodeData = {
                    id,
                    type: CanvasNodeType.Image,
                    title: `${node.title || "视频"} ${{ first: "首帧", last: "尾帧", current: "当前帧" }[input.position]}`,
                    position: { x, y },
                    ...size,
                    metadata: imageMetadata(image),
                };
                commitHostTransaction(canvas, [
                    { type: "add_node", node: child },
                    { type: "connect_nodes", connection: { id: nanoid(), fromNodeId: node.id, toNodeId: child.id } },
                ], { selection: { nodeIds: [child.id], connectionId: null } });
                signal.throwIfAborted();
                await executeCommand(nodeOpenPanel, { nodeId: id }, { scope: context.scope, signal, session });
                signal.throwIfAborted();
                return canvas.getSnapshot();
            } catch (error) {
                if (resource.signal.aborted && !context.signal.aborted && !session.signal.aborted) throw new PluginError("PLUGIN_INACTIVE", { cause: error });
                throw error;
            } finally {
                unsubscribe();
                unsubscribeRegistry();
            }
        },
    });
}
