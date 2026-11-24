import { commitHostTransaction } from "@workbench/lib/canvas/host-transaction";
import { nanoid } from "nanoid";
import type { CanvasSnapshot, CommandContext, PluginCommand } from "@infinite-canvas/plugin-sdk";
import { canvasImportMedia, commands, nodeOpenPanel } from "@infinite-canvas/plugin-sdk/builtin";
import { CanvasNodeType, type CanvasGraph, type CanvasNodeData, type Position } from "@infinite-canvas/shared/canvas/schema/canvas";
import { NODE_DEFAULT_SIZE } from "@infinite-canvas/shared/canvas/schema/node-specs";
import { PluginError } from "@infinite-canvas/shared/plugins";
import type { CanvasGenerationRequest } from "@workbench/lib/canvas/node-generation-state";
import { uploadMediaFile } from "@workbench/services/file-storage";
import { executeCommand } from "@workbench/lib/plugins/commands";
import { builtinPlugin } from "@workbench/lib/plugins/registry";
import { isAudioFile } from "./canvas-generation-helpers";
import { audioMetadata, imageMetadata, videoMetadata } from "./canvas-node-factory";
import { fitNodeSize } from "./canvas-node-size";
import type { CanvasSession } from "./canvas-session";
import { prepareImage } from "./canvas-session-media";

type MediaImportInput = { files: File[] } & ({ position: Position; nodeId?: string; sourceNodeId?: never } | { sourceNodeId: string; nodeId?: never; position?: never });

export function registerCanvasMediaImport(session: CanvasSession, requests: Map<string, CanvasGenerationRequest>) {
    const target = (nodeId: string | undefined, context: CommandContext) => {
        context.signal.throwIfAborted();
        if (session.signal.aborted || context.canvas?.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
        const node = nodeId === undefined ? undefined : context.canvas.getNodes().find((item) => item.id === nodeId);
        if (nodeId !== undefined && !node) throw new PluginError("PLUGIN_NOT_FOUND");
        return node;
    };
    const contribution: PluginCommand<MediaImportInput, CanvasSnapshot> = {
        command: canvasImportMedia,
        title: "导入媒体文件",
        run: async ({ position, nodeId, sourceNodeId, files: input }, context) => {
            const anchorId = sourceNodeId ?? nodeId;
            const original = target(anchorId, context);
            const files = input.filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/") || isAudioFile(file));
            if (!files.length) throw new PluginError("PLUGIN_NOT_FOUND");
            const canvas = context.canvas!;
            const controller = new AbortController();
            const signal = AbortSignal.any([context.signal, session.signal, controller.signal]);
            const unsubscribe = anchorId === undefined ? undefined : session.on("document.committed", (event) => {
                if (event.removedNodeIds?.includes(anchorId) || session.getSnapshot().nodes.find((node) => node.id === anchorId)?.type !== original?.type) controller.abort(new PluginError("PLUGIN_NOT_FOUND"));
            });
            try {
                signal.throwIfAborted();
                if (nodeId !== undefined) requests.get(nodeId)?.controller.abort();
                signal.throwIfAborted();
                const results = await Promise.allSettled(files.map(async (file) => {
                    try {
                        const audio = isAudioFile(file);
                        if (!audio && file.type.startsWith("image/")) {
                            const image = await prepareImage(file, signal);
                            return { type: CanvasNodeType.Image, title: file.name, ...fitNodeSize(image.width, image.height), metadata: imageMetadata(image) };
                        }
                        const media = await uploadMediaFile(file, "media", signal);
                        if (audio) {
                            const { width, height } = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                            return { type: CanvasNodeType.Audio, title: file.name, width, height, metadata: audioMetadata(media) };
                        }
                        return { type: CanvasNodeType.Video, title: file.name, ...fitNodeSize(media.width || 1280, media.height || 720, 420, 420), metadata: videoMetadata(media) };
                    } catch (error) {
                        controller.abort(error);
                        throw error;
                    }
                }));
                const failure = results.find((result) => result.status === "rejected");
                if (failure?.status === "rejected") throw failure.reason;
                signal.throwIfAborted();
                if (nodeId !== undefined) requests.get(nodeId)?.controller.abort();
                signal.throwIfAborted();
                const replaced = target(nodeId, context);
                const current = canvas.getSnapshot();
                const source = target(sourceNodeId, context);
                const priorOutputs = new Set(current.connections.filter(edge => edge.fromNodeId === sourceNodeId).map(edge => edge.toNodeId));
                let outputY = source && current.nodes.reduce((y, node) => priorOutputs.has(node.id) ? Math.max(y, node.position.y + node.height + 32) : y, source.position.y);
                const imported: CanvasNodeData[] = results.map((result, index) => {
                    const media = (result as PromiseFulfilledResult<Omit<CanvasNodeData, "id" | "position">>).value;
                    if (index === 0 && replaced) return {
                        ...media,
                        id: replaced.id,
                        position: media.type === CanvasNodeType.Image ? { ...replaced.position } : {
                            x: replaced.position.x + replaced.width / 2 - media.width / 2,
                            y: replaced.position.y + replaced.height / 2 - media.height / 2,
                        },
                        metadata: { ...media.metadata, ...(replaced.metadata?.groupId === undefined ? {} : { groupId: replaced.metadata.groupId }) },
                    };
                    if (source) {
                        const output = { ...media, id: nanoid(), position: { x: source.position.x + source.width + 32, y: outputY! } };
                        outputY = output.position.y + media.height + 32;
                        return output;
                    }
                    return {
                        ...media,
                        id: nanoid(),
                        position: { x: position!.x + index * 40 - media.width / 2, y: position!.y + index * 40 - media.height / 2 },
                    };
                });
                const added = replaced ? imported.slice(1) : imported;
                const graph = {
                    nodes: [...current.nodes.map((node) => node.id === nodeId ? imported[0] : node), ...added],
                    connections: source ? [...current.connections, ...added.map(node => ({ id: nanoid(), fromNodeId: source.id, toNodeId: node.id }))] : current.connections,
                } as CanvasGraph;
                unsubscribe?.();
                commitHostTransaction(canvas, [{ type: "replace_graph", graph }], source ? undefined : { selection: { nodeIds: [imported[imported.length - 1].id], connectionId: null } });
                await session.flush();
                signal.throwIfAborted();
                const panel = added.findLast((node) => node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video);
                const latest = canvas.getSnapshot();
                if (!source && panel && latest.selection.nodeIds.length === 1 && latest.selection.nodeIds[0] === imported.at(-1)!.id &&
                    latest.nodes.some((node) => node.id === panel.id && node.type === panel.type && node.metadata?.storageKey === panel.metadata?.storageKey)) {
                    await executeCommand(nodeOpenPanel, { nodeId: panel.id }, { scope: context.scope, signal, session });
                }
                signal.throwIfAborted();
                return canvas.getSnapshot();
            } finally {
                unsubscribe?.();
            }
        },
    };
    return builtinPlugin.extensions.contribute(commands, { id: canvasImportMedia.id, value: contribution });
}
