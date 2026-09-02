import { useCallback, useEffect, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";

import { requestEdit, requestGeneration, requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import { imageToDataUrl } from "@/services/image-storage";
import { requestVideoGeneration, storeGeneratedVideo } from "@/services/api/video";
import { runLocalH3Task, getLocalH3Task, runRunningHubH3Task, getRunningHubH3Task } from "@/services/api/comfyui";
import { createGenerationLog, deleteGenerationLogs, fetchComfyModels, fetchGenerationLogs, updateGenerationLog } from "@/services/api/canvas-agent";
import { useAgentStore } from "@/stores/use-agent-store";
import { decodeChannelModel, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { ensurePluginsLoaded } from "@/lib/canvas/plugin-loader";
import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasGenerationLogs, CanvasNodeToolbarItem, CanvasPluginAi, CanvasPluginHost } from "@/types/canvas-plugin";
import type { ReferenceImage } from "@/types/image";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

type PluginHostParams = {
    projectId: string;
    effectiveConfig: AiConfig;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (open: boolean) => void;
    theme: CanvasTheme;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    viewportRef: MutableRefObject<ViewportTransform>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    applyAgentOps: (ops?: CanvasAgentOp[]) => unknown;
};

async function persistH3Result(result: Awaited<ReturnType<typeof runLocalH3Task>>) {
    const stored = await storeGeneratedVideo({ url: result.url, mimeType: result.mimeType, width: result.width, height: result.height, durationMs: result.durationMs });
    const segments = result.segments
        ? await Promise.all(result.segments.map(async (segment) => ({
            ...segment,
            media: segment.media ? await Promise.all(segment.media.map(async (media) => {
                if (!media.mimeType.startsWith("video/") || media.storageKey) return media;
                const item = await storeGeneratedVideo({ url: media.url, mimeType: media.mimeType });
                return { ...media, url: item.url, storageKey: item.storageKey };
            })) : segment.media,
        })))
        : result.segments;
    return { ...result, url: stored.url, storageKey: stored.storageKey, segments };
}

/**
 * Plugin node host capabilities: expose host-side AI generation, canvas access, and panel controls
 * through plugin-callable host/ai objects. Loads installed remote plugins on mount and returns renderers for plugin panels and toolbars.
 */
export function usePluginHost(params: PluginHostParams) {
    const { t } = useTranslation();
    const { projectId, effectiveConfig, isAiConfigReady, openConfigDialog, theme, nodesRef, connectionsRef, viewportRef, setNodes, setDialogNodeId, applyAgentOps } = params;
    const generationLogs = useMemo<CanvasGenerationLogs>(() => {
        const unavailable = () => { throw new Error("Canvas Agent 未连接，无法访问生成日志"); };
        return {
            list: async (options: Parameters<CanvasGenerationLogs["list"]>[0] = {}) => { const current = useAgentStore.getState(); if (!current.connected || !current.url || !current.token) return []; const result = await fetchGenerationLogs(current.url, current.token, { ...options, projectId: options.projectId || projectId }); return result.logs || []; },
            create: async (input: any) => { const current = useAgentStore.getState(); if (!current.connected || !current.url || !current.token) return unavailable(); const result = await createGenerationLog(current.url, current.token, { ...input, projectId: input.projectId || projectId }); if (!result.log) throw new Error("Agent 未返回生成日志"); return result.log; },
            update: async (id: string, patch: any) => { const current = useAgentStore.getState(); if (!current.connected || !current.url || !current.token) return unavailable(); const result = await updateGenerationLog(current.url, current.token, id, patch); if (!result.log) throw new Error("Agent 未返回生成日志"); return result.log; },
            remove: async (options: any) => { const current = useAgentStore.getState(); if (!current.connected || !current.url || !current.token) return unavailable(); const result = await deleteGenerationLogs(current.url, current.token, options); return Number(result.deleted || 0); },
        };
    }, [projectId]);

    // Host capabilities available to plugin nodes; methods receive nodeId and are not bound to a specific node.
    const pluginAi = useMemo<CanvasPluginAi>(() => {
        // Convert plugin reference images (data URLs or URLs) into the ReferenceImage[] expected by the host generation API.
        const toReferences = (refs?: string[]): ReferenceImage[] => (refs || []).filter(Boolean).map((src, index) => ({ id: `plugin-ref-${index}`, name: `ref-${index}.png`, type: "image/png", dataUrl: src }));
        // Open the configuration dialog and throw when AI is not configured, allowing the plugin to handle the error.
        const ensureReady = (config: AiConfig) => {
            if (!isAiConfigReady(config, config.model)) {
                openConfigDialog(true);
                throw new Error(t("canvas.plugins.aiConfigRequired"));
            }
        };
        return {
            generateImage: async (prompt, options) => {
                const config = { ...buildGenerationConfig(effectiveConfig, undefined, "image"), count: String(options?.count || 1), ...(options?.model ? { model: options.model } : {}), ...(options?.size ? { size: options.size } : {}) };
                ensureReady(config);
                const references = toReferences(options?.references);
                const items = references.length ? await requestEdit(config, prompt, references, undefined, { signal: options?.signal }) : await requestGeneration(config, prompt, { signal: options?.signal });
                const images = await Promise.all(items.map(async (item) => {
                    try {
                        return await imageToDataUrl({ dataUrl: item.dataUrl }, { signal: options?.signal });
                    } catch (error) {
                        if (options?.signal?.aborted) throw error;
                        return item.dataUrl;
                    }
                }));
                return { images };
            },
            generateVideo: async (prompt, options) => {
                const config = {
                    ...buildGenerationConfig(effectiveConfig, undefined, "video"),
                    ...(options?.model ? { model: options.model } : {}),
                    ...(options?.size ? { size: options.size } : {}),
                    ...(options?.seconds ? { videoSeconds: options.seconds } : {}),
                };
                ensureReady(config);
                const file = await storeGeneratedVideo(await requestVideoGeneration(config, prompt, toReferences(options?.references), { signal: options?.signal }));
                return { url: file.url, mimeType: file.mimeType, width: file.width, height: file.height, durationMs: file.durationMs };
            },
            generateText: async (prompt, options) => {
                const config = { ...buildGenerationConfig(effectiveConfig, undefined, "text"), ...(options?.model ? { model: options.model } : {}) };
                ensureReady(config);
                const messages: AiTextMessage[] = [...(options?.system ? [{ role: "system" as const, content: options.system }] : []), { role: "user" as const, content: prompt }];
                const text = await requestImageQuestion(config, messages, (delta) => options?.onDelta?.(delta), { signal: options?.signal });
                return { text };
            },
            runLocalH3: async (prompt, input, params, options) => {
                const agent = useAgentStore.getState();
                if (!agent.connected || !agent.url || !agent.token) throw new Error("Canvas Agent 未连接，无法运行本地 MiniMax H3");
                const comfy = await fetch(`${agent.url}/comfy/config?token=${encodeURIComponent(agent.token)}`).then(async (response) => {
                    if (!response.ok) throw new Error(`读取 ComfyUI 配置失败（HTTP ${response.status}）`);
                    return await response.json() as { url?: string };
                });
                if (!comfy.url) throw new Error("尚未配置本地 ComfyUI 地址");
                const result = await runLocalH3Task(agent.url, agent.token, comfy.url, prompt, input, params, options?.signal, options?.onTaskId);
                return persistH3Result(result);
            },
            getLocalH3Task: async (taskId) => {
                const agent = useAgentStore.getState();
                if (!agent.connected || !agent.url || !agent.token) throw new Error("Canvas Agent 未连接，无法查询 H3 任务");
                const task = await getLocalH3Task(agent.url, agent.token, taskId) as Awaited<ReturnType<typeof getLocalH3Task>>;
                if (task.status === "succeeded" && task.result?.url && !task.result.storageKey) {
                    return { ...task, result: await persistH3Result(task.result) };
                }
                return task;
            },
            listLocalH3Models: async () => {
                const agent = useAgentStore.getState();
                if (!agent.connected || !agent.url || !agent.token) throw new Error("Canvas Agent 未连接，无法读取 ComfyUI 模型");
                const result = await fetchComfyModels(agent.url, agent.token);
                return { models: result.data?.models || [], loras: result.data?.loras || [] };
            },
            runRunningHubH3: async (prompt, input, params, options) => {
                const agent = useAgentStore.getState();
                if (!agent.connected || !agent.url || !agent.token) throw new Error("Canvas Agent 未连接，无法运行 RunningHub MiniMax H3");
                const result = await runRunningHubH3Task(agent.url, agent.token, prompt, input, params, options?.signal, options?.onTaskId);
                return persistH3Result(result);
            },
            getRunningHubH3Task: async (taskId) => {
                const agent = useAgentStore.getState();
                if (!agent.connected || !agent.url || !agent.token) throw new Error("Canvas Agent 未连接，无法查询 RunningHub H3 任务");
                const task = await getRunningHubH3Task(agent.url, agent.token, taskId) as Awaited<ReturnType<typeof getRunningHubH3Task>>;
                if (task.status === "succeeded" && task.result?.url && !task.result.storageKey) {
                    return { ...task, result: await persistH3Result(task.result) };
                }
                return task;
            },
            // List configured models for a capability; labels use the model name without the channel prefix.
            listModels: (capability) => selectableModelsByCapability(effectiveConfig, capability as ModelCapability | undefined).map((value) => ({ value, label: decodeChannelModel(value)?.model || value })),
            defaultModel: (capability) => buildGenerationConfig(effectiveConfig, undefined, capability).model,
        };
    }, [effectiveConfig, isAiConfigReady, openConfigDialog, t]);

    const pluginHost = useMemo<CanvasPluginHost>(
        () => ({
            projectId,
            getNode: (id) => nodesRef.current.find((node) => node.id === id) || null,
            getNodes: () => nodesRef.current,
            getConnections: () => connectionsRef.current,
            getUpstream: (nodeId) =>
                connectionsRef.current
                    .filter((conn) => conn.toNodeId === nodeId)
                    .map((conn) => nodesRef.current.find((node) => node.id === conn.fromNodeId))
                    .filter((node): node is CanvasNodeData => Boolean(node)),
            getDownstream: (nodeId) =>
                connectionsRef.current
                    .filter((conn) => conn.fromNodeId === nodeId)
                    .map((conn) => nodesRef.current.find((node) => node.id === conn.toNodeId))
                    .filter((node): node is CanvasNodeData => Boolean(node)),
            updateNode: (nodeId, patch) => setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, ...patch } : node))),
            updateMetadata: (nodeId, patch) => setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...patch } } : node))),
            applyOps: (ops) => applyAgentOps(ops),
            ai: pluginAi,
            openPanel: (nodeId) => setDialogNodeId(nodeId),
            closePanel: () => setDialogNodeId(null),
            generationLogs,
        }),
        [applyAgentOps, generationLogs, pluginAi, projectId],
    );

    const renderPluginPanel = useCallback(
        (panelNode: CanvasNodeData) => {
            const Panel = getNodeDefinition(panelNode.type)?.Panel;
            if (!Panel) return null;
            const ctx = buildNodeContext(pluginHost, panelNode, theme, viewportRef.current.k);
            return <Panel ctx={ctx} onClose={() => setDialogNodeId(null)} />;
        },
        [pluginHost, theme],
    );

    // Build the node toolbar from plugin items and a host-provided interaction/move toggle when enabled.
    const buildNodeToolbarItems = useCallback(
        (node: CanvasNodeData): CanvasNodeToolbarItem[] => {
            const definition = getNodeDefinition(node.type);
            const ctx = buildNodeContext(pluginHost, node, theme, viewportRef.current.k);
            const custom = definition?.toolbar?.(ctx) || [];
            // Show the interaction/move toggle only for nodes with content that are not forced into an interactive state.
            if (!definition?.interactionToggle || !node.metadata?.content || definition.forceInteractive?.(node)) return custom;
            const interactive = Boolean(node.metadata?.interactive);
            const toggle: CanvasNodeToolbarItem = {
                id: "node-interaction-toggle",
                title: t(interactive ? "canvas.plugins.interactiveTitle" : "canvas.plugins.movableTitle"),
                label: t(interactive ? "canvas.plugins.move" : "canvas.plugins.interact"),
                icon: interactive ? "✋" : "🖐",
                active: interactive,
                onClick: () => pluginHost.updateMetadata(node.id, { interactive: !interactive }),
            };
            return [toggle, ...custom];
        },
        [pluginHost, t, theme],
    );

    // Load installed remote plugins on startup.
    useEffect(() => {
        void ensurePluginsLoaded();
    }, []);

    return { pluginHost, renderPluginPanel, buildNodeToolbarItems };
}
