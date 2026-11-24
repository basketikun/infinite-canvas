import { useLayoutEffect } from "react";
import { nanoid } from "nanoid";
import type { CommandContext } from "@infinite-canvas/plugin-sdk";
import { nodeOpenPanel } from "@infinite-canvas/plugin-sdk/builtin";
import { CanvasNodeType } from "@infinite-canvas/shared/canvas/schema/canvas";
import { NODE_DEFAULT_SIZE } from "@infinite-canvas/shared/canvas/schema/node-specs";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { useCopyText } from "@workbench/hooks/use-copy-text";
import { createCanvasNode } from "@workbench/lib/canvas/canvas-node-factory";
import type { CanvasSession } from "@workbench/lib/canvas/canvas-session";
import { readNodeResource } from "@workbench/lib/canvas/node-registry";
import { executeCommand } from "@workbench/lib/plugins/commands";
import { bindHostActions } from "@workbench/lib/canvas/host-actions";
import { useConfigStore } from "@workbench/stores/use-config-store";

export function registerImageNodeActions(session: CanvasSession, copyText: ReturnType<typeof useCopyText>) {
    const getNode = (nodeId: string, context: CommandContext) => {
        context.signal.throwIfAborted();
        if (session.signal.aborted || context.canvas?.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
        const node = context.canvas.getNodes().find((item) => item.id === nodeId);
        if (!node) throw new PluginError("PLUGIN_NOT_FOUND");
        return node;
    };
    const getImage = (nodeId: string, context: CommandContext) => {
        const node = getNode(nodeId, context);
        const resource = readNodeResource(node, "execute", context.scope);
        if (resource?.kind !== "image" || !(resource.storageKey || resource.url)) throw new PluginError("PLUGIN_NOT_FOUND");
        return node;
    };
    return bindHostActions(session, {
        nodeCopyPrompt: async ({ nodeId }, context) => {
            const prompt = getNode(nodeId, context).metadata?.prompt;
            if (!prompt) throw new PluginError("PLUGIN_NOT_FOUND");
            if (!await copyText(prompt, "提示词已复制", context.signal)) throw new PluginError("PLUGIN_OPERATION_FAILED");
        },
        nodeCreateImageReversePrompt: async ({ nodeId }, context) => {
            const node = getImage(nodeId, context);
            const canvas = context.canvas!;
            const config = useConfigStore.getState().config;
            const gap = 96;
            const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
            const centerY = node.position.y + node.height / 2;
            const prompt = "请根据参考图片反推一段适合用于 AI 生图的提示词。\n\n要求：\n1. 只输出提示词正文，不要解释。\n2. 覆盖主体、构图、风格、光线、色彩、材质、镜头和氛围。\n3. 尽量写成可直接用于生图模型的完整提示词。";
            const textNode = {
                ...createCanvasNode(CanvasNodeType.Text, { x: node.position.x + node.width + gap + textSpec.width / 2, y: centerY }, { prompt, model: config.textModel || config.model }),
                title: "反推提示词",
            };
            await canvas.transact([
                { type: "add_node", node: textNode },
                { type: "connect_nodes", connection: { id: nanoid(), fromNodeId: node.id, toNodeId: textNode.id } },
            ], { selection: { nodeIds: [textNode.id], connectionId: null } });
            await executeCommand(nodeOpenPanel, { nodeId: textNode.id }, { scope: context.scope, signal: context.signal, session });
            return canvas.getSnapshot();
        },
        nodeSetImageFreeResize: ({ nodeId, freeResize }, context) => {
            const node = getImage(nodeId, context);
            const metadata = { freeResize };
            if (freeResize) return context.canvas!.transact([{ type: "update_node", id: nodeId, metadata }]);
            const ratio = (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height || 1);
            const height = node.width / ratio;
            return context.canvas!.transact([{ type: "update_node", id: nodeId, metadata, patch: {
                height,
                position: { x: node.position.x, y: node.position.y + node.height / 2 - height / 2 },
            } }]);
        },
    });
}

export function useImageNodeActions(session: CanvasSession) {
    const copyText = useCopyText("command");
    useLayoutEffect(() => registerImageNodeActions(session, copyText), [session, copyText]);
}
