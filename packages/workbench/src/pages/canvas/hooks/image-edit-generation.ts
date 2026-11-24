import { commitHostTransaction } from "@workbench/lib/canvas/host-transaction";
import type { Dispatch, SetStateAction } from "react";
import { nanoid } from "nanoid";
import type { CanvasSnapshot, CommandContext, ImageAngleParams, ImageMaskEditParams } from "@infinite-canvas/plugin-sdk";
import { nodeOpenPanel } from "@infinite-canvas/plugin-sdk/builtin";
import { getPluginErrorMessage, PluginError } from "@infinite-canvas/shared/plugins";
import { ModelExecutionError } from "@infinite-canvas/shared/model-http";
import { CanvasNodeType, type CanvasNodeData } from "@infinite-canvas/shared/canvas/schema/canvas";
import { NODE_DEFAULT_SIZE } from "@infinite-canvas/shared/canvas/schema/node-specs";
import type { CanvasSession } from "@workbench/lib/canvas/canvas-session";
import { prepareImage } from "@workbench/lib/canvas/canvas-session-media";
import { buildAngleLabel, buildAnglePrompt, buildGenerationConfig, isGenerationCanceled } from "@workbench/lib/canvas/canvas-generation-helpers";
import { buildImageGenerationMetadata, imageMetadata } from "@workbench/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@workbench/lib/canvas/canvas-node-size";
import { readNodeResource } from "@workbench/lib/canvas/node-registry";
import { executeCommand } from "@workbench/lib/plugins/commands";
import { pluginRegistry } from "@workbench/lib/plugins/registry";
import { imageReferenceLabel } from "@workbench/lib/image-reference-prompt";
import { requestEdit } from "@workbench/services/api/image";
import { useConfigStore, type AiConfig } from "@workbench/stores/use-config-store";
import type { useCanvasTasks } from "../use-canvas-tasks";

type PreparedImage = Awaited<ReturnType<typeof prepareImage>>;
export type ApplyCanvasImageResult = (target: { nodeId: string; signal: AbortSignal; taskId?: string }, url: string, update: (nodes: CanvasNodeData[], image: PreparedImage) => CanvasNodeData[], onAccepted: () => void) => Promise<boolean>;

type ImageEditGeneration = {
    session: CanvasSession;
    getConfig: () => AiConfig;
    startGenerationRequest: (targetNodeId: string, originNodeId: string, runningId?: string, controller?: AbortController, parentSignal?: AbortSignal) => AbortController;
    finishGenerationRequest: (targetNodeId: string, controller: AbortController) => boolean;
    task: Pick<ReturnType<typeof useCanvasTasks>, "options">;
    applyImageResult: ApplyCanvasImageResult;
    setRunningNodeId: Dispatch<SetStateAction<string | null>>;
};

type AngleInput = { nodeId: string; params: ImageAngleParams };
type MaskInput = { nodeId: string } & ImageMaskEditParams;

export function createImageEditCommands(generation: ImageEditGeneration) {
    const { session } = generation;
    const source = (nodeId: string, context: CommandContext) => {
        context.signal.throwIfAborted();
        if (session.signal.aborted || context.canvas?.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
        const node = context.canvas.getNodes().find((item) => item.id === nodeId);
        if (!node) throw new PluginError("PLUGIN_NOT_FOUND");
        const resource = readNodeResource(node, "execute", context.scope);
        if (resource?.kind !== "image" || !(resource.storageKey || resource.url)) throw new PluginError("PLUGIN_NOT_FOUND");
        resource.signal.throwIfAborted();
        return { node, resource };
    };
    const run = async (input: AngleInput | MaskInput, context: CommandContext): Promise<CanvasSnapshot> => {
        const { nodeId } = input;
        const mask = "maskDataUrl" in input ? input : undefined;
        const generate = mask ? mask.generate : true;
        const { node, resource } = source(nodeId, context);
        const config = generate ? { ...buildGenerationConfig(generation.getConfig(), node, "image"), count: "1", ...(mask ? { size: node.metadata?.size || "auto" } : {}) } : undefined;
        if (config && !useConfigStore.getState().isAiConfigReady(config, config.model)) {
            const settings = useConfigStore.getState();
            settings.openConfigDialog(true, "builtin:channels", config.model);
            throw new ModelExecutionError("MODEL_CONFIG_MISSING");
        }
        const metadata = (resource.storageKey ? resource.storageKey === node.metadata?.storageKey : resource.url === node.metadata?.content) ? node.metadata : undefined;
        const references = [{ id: node.id, name: `${node.title || node.id}.png`, type: metadata?.mimeType || "image/png", dataUrl: resource.url, storageKey: resource.storageKey }];
        const prompt = mask ? `参考${imageReferenceLabel(0)}为原图，${imageReferenceLabel(1)}是在原图上用蓝色半透明标注出的待修改区域。请只修改蓝色标注覆盖的区域，其余区域与原图保持完全一致，输出与原图相同尺寸的完整图片，并且结果中不要保留任何蓝色标注。修改要求：${mask.prompt}` : buildAnglePrompt((input as AngleInput).params);
        const childId = nanoid();
        const size = mask ? { width: node.width, height: node.height } : NODE_DEFAULT_SIZE[CanvasNodeType.Image];
        const controller = new AbortController();
        const { signal } = controller;
        const parent = AbortSignal.any([context.signal, session.signal, resource.signal]);
        parent.throwIfAborted();
        const cancel = () => controller.abort(parent.reason);
        parent.addEventListener("abort", cancel, { once: true, signal });
        let created = false;
        let started = false;
        let canceled = false;
        let targetLost = false;
        let resultAccepted = false;
        const revision = session.getSnapshot().revision;
        const checkNodes = () => {
            if (signal.aborted) return;
            try {
                const current = source(nodeId, context);
                targetLost = created && session.getSnapshot().nodes.find((item) => item.id === childId)?.type !== CanvasNodeType.Image;
                if (targetLost || current.node.type !== node.type || current.resource.contributionId !== resource.contributionId || current.resource.storageKey !== resource.storageKey || current.resource.url !== resource.url) controller.abort(new PluginError("PLUGIN_NOT_FOUND"));
            } catch (error) { controller.abort(error); }
        };
        const unsubscribe = session.subscribe(checkNodes);
        const unsubscribeRegistry = pluginRegistry.subscribeAll(checkNodes);
        const unsubscribeHistory = session.on("document.committed", (event) => {
            if (event.revision <= revision) return;
            if (event.operation !== "transact" || event.removedNodeIds?.includes(childId)) targetLost = true;
            if (targetLost || event.removedNodeIds?.includes(nodeId)) controller.abort(new PluginError("PLUGIN_INACTIVE"));
        });
        try {
            let generationMetadata: ReturnType<typeof buildImageGenerationMetadata> | undefined;
            const image = mask && await prepareImage(mask.maskDataUrl, signal);
            {
                checkNodes();
                signal.throwIfAborted();
                const nodes: CanvasNodeData[] = [];
                if (image) {
                    const maskId = nanoid();
                    nodes.push({ id: maskId, type: CanvasNodeType.Image, title: "遮罩标注", position: { x: node.position.x, y: node.position.y + node.height + 96 }, width: node.width, height: node.height, metadata: imageMetadata(image) });
                    references.push({ id: maskId, name: "mask.png", type: image.mimeType || "image/png", dataUrl: image.url, storageKey: image.storageKey });
                }
                generationMetadata = config ? buildImageGenerationMetadata("edit", config, 1, references) : undefined;
                nodes.push({ id: childId, type: CanvasNodeType.Image, title: mask ? mask.prompt.slice(0, 32) || "局部编辑结果" : buildAngleLabel((input as AngleInput).params), position: { x: node.position.x + node.width + 96, y: node.position.y }, width: size.width, height: size.height, metadata: generate ? { prompt, status: "loading", ...generationMetadata } : { prompt } });
                signal.throwIfAborted();
                if (generate) {
                    generation.startGenerationRequest(childId, node.id, childId, controller, context.signal);
                    started = true;
                    generation.setRunningNodeId(childId);
                }
                commitHostTransaction(context.canvas!, [
                    ...nodes.map((node) => ({ type: "add_node" as const, node })),
                    ...references.map((reference) => ({ type: "connect_nodes" as const, connection: { id: nanoid(), fromNodeId: reference.id, toNodeId: childId } })),
                ], { selection: { nodeIds: [childId], connectionId: null } });
                created = true;
            }
            checkNodes();
            signal.throwIfAborted();
            await executeCommand(nodeOpenPanel, { nodeId: childId }, { scope: context.scope, signal, session });
            if (config) {
                const options = generation.task.options(childId, node.id, signal);
                const image = (await requestEdit(config, prompt, references, options))[0];
                signal.throwIfAborted();
                const applied = await generation.applyImageResult({ nodeId: childId, signal, taskId: options.taskId }, image.dataUrl, (nodes, uploaded) => {
                    checkNodes();
                    signal.throwIfAborted();
                    const imageSize = fitNodeSize(uploaded.width, uploaded.height, size.width, size.height);
                    return nodes.map((item) => item.id === childId && item.type === CanvasNodeType.Image ? { ...item, ...imageSize, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item);
                }, () => { resultAccepted = true; });
                if (!applied) throw new PluginError("PLUGIN_NOT_FOUND");
                signal.throwIfAborted();
            }
        } catch (error) {
            console.error("[canvas] image edit generation", mask ? "mask" : "angle", nodeId, childId, error);
            canceled = signal.aborted || isGenerationCanceled(error);
            if (generate && created && !resultAccepted && !canceled && !session.signal.aborted) {
                const errorDetails = error instanceof ModelExecutionError ? error.message : getPluginErrorMessage(error);
                session.updateDocument((document) => ({ ...document, nodes: document.nodes.map((item) => item.id === childId ? { ...item, metadata: { ...item.metadata, status: "error", errorDetails } } : item) }), { source: { kind: "system", id: "generation" }, history: false });
            }
            throw error;
        } finally {
            unsubscribe();
            unsubscribeRegistry();
            unsubscribeHistory();
            parent.removeEventListener("abort", cancel);
            const current = started && generation.finishGenerationRequest(childId, controller);
            if (current) {
                generation.setRunningNodeId((value) => value === childId ? null : value);
                if (canceled && !targetLost && !session.signal.aborted) {
                    const pending = session.getSnapshot().nodes.find((item) => item.id === childId);
                    if (pending?.metadata?.status === "loading" && !pending.metadata.tasks?.length) session.updateDocument((document) => ({ ...document, nodes: document.nodes.map((item) => item.id === childId ? { ...item, metadata: { ...item.metadata, status: "idle", errorDetails: undefined } } : item) }), { source: { kind: "system", id: "generation" }, history: false });
                }
            }
        }
        return context.canvas!.getSnapshot();
    };
    return { nodeGenerateImageAngle: run, nodeEditImageMask: run };
}
