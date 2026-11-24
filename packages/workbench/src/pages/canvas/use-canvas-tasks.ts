import { useEffect, useRef } from "react";
import { assertModelTaskTarget, ModelExecutionError, modelAssetUrl, type ModelTask, type ModelTaskTarget } from "@infinite-canvas/shared/model-http";
import { CanvasNodeType, isCanvasTaskBinding, type CanvasNodeData, type CanvasNodeMetadata, type CanvasTaskBinding } from "@infinite-canvas/shared/canvas/schema/canvas";
import { imageMetadata, audioMetadata, videoMetadata } from "@workbench/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@workbench/lib/canvas/canvas-node-size";
import { uploadMediaFile } from "@workbench/services/file-storage";
import { models } from "@workbench/services/api/models/runtime";
import type { ModelRequestOptions } from "@workbench/services/api/models/types";
import type { CanvasSession } from "@workbench/lib/canvas/canvas-session";
import { prepareImage } from "@workbench/lib/canvas/canvas-session-media";
import { emitPluginEvent } from "@workbench/lib/plugins/runtime";
import { useCanvasStore } from "@workbench/stores/canvas/use-canvas-store";

type Binding = CanvasTaskBinding;
type LiveTask = { binding: Binding; signal: AbortSignal; owner: AbortSignal; slot?: AbortController; terminal: boolean; restoring: boolean; submission?: Promise<ModelTask> };

function targetOf({ projectId, nodeId, slotId }: Binding): ModelTaskTarget {
    return { page: "canvas", projectId, nodeId, slotId };
}

function sameBinding(a: Binding, b: Binding) {
    return a.taskId === b.taskId && a.projectId === b.projectId && a.nodeId === b.nodeId && a.slotId === b.slotId && a.sourceId === b.sourceId;
}

function hasBinding(nodes: readonly CanvasNodeData[], projectId: string, binding: Binding) {
    const node = nodes.find((item) => item.id === binding.nodeId);
    return !!node && isCanvasTaskBinding(projectId, node, binding) && !!node.metadata?.tasks?.some((item) => sameBinding(item, binding));
}

async function resultMetadata(session: CanvasSession, task: ModelTask, signal: AbortSignal): Promise<CanvasNodeMetadata> {
    if (task.action === "text") {
        if (typeof task.result !== "string") throw new ModelExecutionError("MODEL_RESULT_MISSING");
        return { content: task.result };
    }
    if (task.action === "image") {
        const asset = Array.isArray(task.result) && task.result[0];
        if (!asset || asset.collection !== "images" || !asset.key) throw new ModelExecutionError("MODEL_RESULT_MISSING");
        const image = await prepareImage(modelAssetUrl(asset), signal);
        return { ...imageMetadata(image), content: "" };
    }
    const asset = task.result;
    if (!asset || typeof asset === "string" || Array.isArray(asset) || asset.collection !== "media" || !asset.key) throw new ModelExecutionError("MODEL_RESULT_MISSING");
    const media = await uploadMediaFile(modelAssetUrl(asset), task.action, signal);
    return task.action === "video" ? videoMetadata(media) : audioMetadata(media);
}

function updateRecovered(node: CanvasNodeData, binding: Binding, patch: CanvasNodeMetadata, keep: boolean) {
    const meta = node.metadata!;
    const tasks = keep ? meta.tasks : meta.tasks?.filter((item) => !sameBinding(item, binding));
    const images = meta.images?.map((item) => item.id === binding.slotId ? { ...item, ...patch, content: patch.content ?? item.content } : item);
    const texts = meta.texts?.map((item) => item.id === binding.slotId ? { ...item, ...patch, content: patch.content ?? item.content } : item);
    const slots = images ?? texts ?? [];
    const primaryId = images ? meta.primaryImageId : meta.primaryTextId;
    const selected = slots.find((item) => item.id === primaryId);
    const primary = selected && selected.status !== "error" ? selected : slots.find((item) => item.status === "success");
    const success = patch.status === "success" || slots.some((item) => item.status === "success");
    const status = tasks?.length && !keep ? "loading" : success ? "success" : "error";
    const metadata: CanvasNodeMetadata = { ...meta, ...(!binding.slotId ? patch : {}), images, texts, tasks, status, errorDetails: status === "error" ? patch.errorDetails : undefined };
    if (binding.slotId && primary) {
        metadata.content = primary.content;
        const image = images?.find((item) => item.id === primary.id);
        if (image) {
            metadata.primaryImageId = image.id;
            metadata.storageKey = image.storageKey;
            metadata.naturalWidth = image.naturalWidth;
            metadata.naturalHeight = image.naturalHeight;
            metadata.bytes = image.bytes;
            metadata.mimeType = image.mimeType;
        } else if (texts) metadata.primaryTextId = primary.id;
    }
    if (patch.status === "success" && (!binding.slotId || primary?.id === binding.slotId) && patch.naturalWidth && patch.naturalHeight && !meta.freeResize && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video)) {
        const size = fitNodeSize(patch.naturalWidth, patch.naturalHeight, node.width, node.height);
        return { ...node, ...size, position: { x: node.position.x + (node.width - size.width) / 2, y: node.position.y + (node.height - size.height) / 2 }, metadata };
    }
    return { ...node, metadata };
}

export function useCanvasTasks(session: CanvasSession, cancel: (signal: AbortSignal) => void) {
    const projectId = session.projectId;
    const live = useRef(new Map<string, LiveTask>());
    useEffect(() => session.subscribe(() => {
        const nodes = session.getSnapshot().nodes;
        for (const item of live.current.values()) {
            if (!hasBinding(nodes, projectId, item.binding)) {
                if (item.slot) item.slot.abort(new ModelExecutionError("MODEL_TASK_CANCELLED"));
                else cancel(item.signal);
            }
        }
    }), [cancel, session]);
    const setNodes = (update: (nodes: CanvasNodeData[]) => CanvasNodeData[]) => session.updateDocument((document) => ({ ...document, nodes: update(document.nodes) }), { source: { kind: "system", id: "model-task" }, history: false });

    function forget(item: LiveTask) {
        if (live.current.get(item.binding.taskId) === item) live.current.delete(item.binding.taskId);
    }

    function removeBinding(binding: Binding) {
        if (!hasBinding(session.getSnapshot().nodes, projectId, binding)) return;
        setNodes((nodes) => nodes.map((node) => node.id === binding.nodeId ? { ...node, metadata: { ...node.metadata, tasks: node.metadata?.tasks?.filter((entry) => !sameBinding(entry, binding)) } } : node));
    }

    function assertOwned(binding: Binding, signal: AbortSignal) {
        signal.throwIfAborted();
        session.signal.throwIfAborted();
        if (!hasBinding(session.getSnapshot().nodes, projectId, binding)) throw new ModelExecutionError("MODEL_TASK_CONFLICT");
    }

    function publish(item: LiveTask, signal: AbortSignal, patch: CanvasNodeMetadata, keep: boolean, kind?: ModelTask["action"]) {
        const { binding } = item;
        assertOwned(binding, signal);
        forget(item);
        setNodes((nodes) => nodes.map((node) => node.id === binding.nodeId ? updateRecovered(node, binding, patch, keep) : node));
        if (kind) emitPluginEvent("result.applied", { projectId, kind, nodeIds: [binding.nodeId], taskId: binding.taskId });
    }

    function publishFailure(item: LiveTask, signal: AbortSignal, error: unknown, keep: boolean) {
        publish(item, signal, { status: "error", errorDetails: error instanceof ModelExecutionError ? error.message : "暂时无法读取生成结果，请重新打开画布。" }, keep);
        return false;
    }

    async function applyCompleted(item: LiveTask, snapshot: ModelTask, signal: AbortSignal) {
        assertOwned(item.binding, signal);
        assertModelTaskTarget(snapshot, item.binding.taskId, targetOf(item.binding));
        let result: CanvasNodeMetadata;
        try { result = await resultMetadata(session, snapshot, signal); }
        catch (error) { return publishFailure(item, signal, error, true); }
        publish(item, signal, { ...result, status: "success", errorDetails: undefined }, false, snapshot.action);
        return true;
    }

    function options(nodeId: string, sourceId: string, owner: AbortSignal, slotId?: string, slot?: AbortController): ModelRequestOptions {
        const signal = slot ? AbortSignal.any([owner, slot.signal]) : owner;
        if (!models.tasks) return { signal };
        const taskId = crypto.randomUUID();
        const binding = { taskId, projectId, nodeId, sourceId, slotId };
        const item: LiveTask = { binding, signal, owner, slot, terminal: false, restoring: false };
        return {
            taskId, signal, target: targetOf(binding),
            beforeSubmit: async () => {
                signal.throwIfAborted();
                session.signal.throwIfAborted();
                const node = session.getSnapshot().nodes.find((entry) => entry.id === nodeId);
                if (!node || !isCanvasTaskBinding(projectId, node, binding)) throw new ModelExecutionError("MODEL_TASK_CANCELLED");
                if (live.current.has(taskId)) throw new ModelExecutionError("MODEL_TASK_CONFLICT");
                live.current.set(taskId, item);
                let saved = false;
                const unsubscribe = useCanvasStore.getState().subscribeSaves((receipt) => {
                    if (receipt.projectId === projectId && receipt.status === "saved" && receipt.snapshot && hasBinding(receipt.snapshot.nodes, projectId, binding)) saved = true;
                });
                try {
                    setNodes((nodes) => nodes.map((node) => node.id === nodeId ? { ...node, metadata: { ...node.metadata,
                        tasks: [...node.metadata?.tasks?.filter((entry) => slotId !== undefined && entry.slotId !== undefined && entry.slotId !== slotId) ?? [], binding],
                    } } : node));
                    await session.flush();
                } finally { unsubscribe(); }
                signal.throwIfAborted();
                session.signal.throwIfAborted();
                if (!saved || !hasBinding(session.getSnapshot().nodes, projectId, binding)) throw new ModelExecutionError("MODEL_TASK_CANCELLED");
            },
            onTaskSubmission: (receipt) => { item.submission = receipt; },
            onTerminal: () => { item.terminal = true; },
        };
    }

    function finish(nodeId: string, signal: AbortSignal) {
        for (const item of live.current.values()) {
            if (item.binding.nodeId !== nodeId || (item.signal !== signal && item.owner !== signal)) continue;
            forget(item);
            if (!item.signal.aborted && !session.signal.aborted && item.terminal) removeBinding(item.binding);
        }
    }

    function canApply(taskId: string, nodeId: string, signal: AbortSignal) {
        const item = live.current.get(taskId);
        return !!item && item.signal === signal && !signal.aborted && !session.signal.aborted && item.binding.nodeId === nodeId && hasBinding(session.getSnapshot().nodes, projectId, item.binding);
    }

    function applied(taskId: string, signal: AbortSignal) {
        const item = live.current.get(taskId);
        if (item?.signal === signal) item.terminal = true;
    }

    async function stop(nodeId: string, signal: AbortSignal) {
        const items = [...live.current.values()].filter((item) => item.binding.nodeId === nodeId && item.owner === signal && !item.signal.aborted);
        let changed = false;
        const results = await Promise.allSettled(items.map(async (item) => {
            const { binding } = item;
            const owner = new AbortController();
            const stopping = AbortSignal.any([session.signal, owner.signal]);
            const check = () => {
                if (!hasBinding(session.getSnapshot().nodes, projectId, binding)) owner.abort(new ModelExecutionError("MODEL_TASK_CONFLICT"));
            };
            const unsubscribe = session.subscribe(check);
            try {
                check();
                stopping.throwIfAborted();
                // stop 调用方在提交链返回前同步中止原 controller；已启动的提交仍需取得真实回执。
                await item.submission;
                stopping.throwIfAborted();
                if (item.restoring || item.submission) {
                    const snapshot = await models.tasks!.cancel(binding.taskId, targetOf(binding), stopping);
                    stopping.throwIfAborted();
                    if (!snapshot) throw new ModelExecutionError("MODEL_UNAVAILABLE");
                    assertModelTaskTarget(snapshot, binding.taskId, targetOf(binding));
                    if (snapshot.status === "running") throw new ModelExecutionError("MODEL_UNAVAILABLE");
                    if (snapshot.status !== "cancelled") {
                        if (snapshot.status === "completed") await applyCompleted(item, snapshot, stopping);
                        else publishFailure(item, stopping, new ModelExecutionError(snapshot.code!, snapshot.message), snapshot.status === "paused");
                        changed = true;
                        return false;
                    }
                }
                forget(item);
                removeBinding(binding);
                changed = true;
                return true;
            } finally { unsubscribe(); }
        }));
        if (changed) await session.flush();
        for (const result of results) if (result.status === "rejected") throw result.reason;
        return results.every((result) => result.status === "fulfilled" && result.value);
    }

    async function restore(node: CanvasNodeData, controller: AbortController, resume = false) {
        const { signal } = controller;
        const bindings = node.metadata?.tasks ?? [];
        signal.throwIfAborted();
        session.signal.throwIfAborted();
        const nodes = session.getSnapshot().nodes;
        const claimed = new Set<string>();
        for (const binding of bindings) {
            const previous = live.current.get(binding.taskId);
            // 旧观察已取消但其读取可能还没返回；新视图可继续观察同一绑定。
            const replacing = previous?.restoring && previous.signal.aborted && sameBinding(previous.binding, binding);
            if (node.id !== binding.nodeId || !hasBinding(nodes, projectId, binding) || claimed.has(binding.taskId) || (previous && !replacing)) throw new ModelExecutionError("MODEL_TASK_CONFLICT");
            claimed.add(binding.taskId);
        }
        const results = await Promise.allSettled(bindings.map(async (binding) => {
            const slot = binding.slotId !== undefined ? new AbortController() : undefined;
            const signal = slot ? AbortSignal.any([controller.signal, slot.signal]) : controller.signal;
            const item: LiveTask = { binding, signal, owner: controller.signal, slot, terminal: false, restoring: true };
            const target = targetOf(binding);
            live.current.set(binding.taskId, item);
            try {
                let snapshot: ModelTask;
                try {
                    snapshot = await models.tasks!.wait(binding.taskId, {
                        signal, resume, target,
                        onText: (content, task) => {
                            assertOwned(binding, signal);
                            assertModelTaskTarget(task, binding.taskId, target);
                            setNodes((items) => items.map((entry) => {
                                if (entry.id !== node.id) return entry;
                                const meta = entry.metadata!;
                                return { ...entry, metadata: { ...meta, ...(!binding.slotId || meta.primaryTextId === binding.slotId ? { content } : {}), texts: meta.texts?.map((text) => text.id === binding.slotId ? { ...text, content } : text) } };
                            }));
                        },
                        onTerminalFailure: (task) => {
                            assertOwned(binding, signal);
                            assertModelTaskTarget(task, binding.taskId, target);
                            item.terminal = true;
                        },
                    });
                } catch (error) {
                    if (signal.aborted || session.signal.aborted) return false;
                    if (error instanceof ModelExecutionError && error.code === "MODEL_TASK_CONFLICT") throw error;
                    return publishFailure(item, signal, error, !item.terminal);
                }
                return await applyCompleted(item, snapshot, signal);
            } finally { forget(item); }
        }));
        for (const result of results) if (result.status === "rejected") throw result.reason;
        return results.some((result) => result.status === "fulfilled" && result.value);
    }
    return { options, finish, restore, stop, canApply, applied };
}
