import { isWebVideoTaskOwner, sameCanvasVideoRun, type CanvasDocument, type CanvasWebVideoTask } from "@infinite-canvas/shared/canvas/schema/canvas";
import { ModelExecutionError } from "@infinite-canvas/shared/model-http";
import { sha256 } from "@infinite-canvas/shared/utils/sha256";
import type { CanvasSession } from "@workbench/lib/canvas/canvas-session";
import { models } from "@workbench/services/api/models/runtime";
import { resolveGeneratedVideo, videoChannelFingerprint, waitForVideoGenerationTask } from "@workbench/services/api/video";
import type { UploadedFile } from "@workbench/services/file-storage";
import { storage } from "@workbench/services/storage/runtime";
import { callScriptsReady } from "@workbench/stores/use-call-script-store";
import { channelWrites, getModelConfigIssue, type AiConfig } from "@workbench/stores/use-config-store";

export function sameWebVideoTask(current: CanvasWebVideoTask | undefined, expected: CanvasWebVideoTask) {
    return !!current && sameCanvasVideoRun(current, expected) && current.paused === expected.paused;
}

// 仅原会话可以用提交时固定的渠道重试保存；公开节点、复制片段均不持有证明。
const unsaved = new WeakMap<CanvasSession, Map<string, { task: CanvasWebVideoTask; fingerprint: string }>>();

function taskNode(session: CanvasSession, binding: CanvasWebVideoTask) {
    const node = session.getSnapshot().nodes.find((node) => node.id === binding.nodeId);
    if (models.tasks || !node || !isWebVideoTaskOwner(session.projectId, node, binding) ||
        node.metadata?.webVideoSubmissionId !== undefined && node.metadata.webVideoSubmissionId !== binding.runId) throw new ModelExecutionError("MODEL_TASK_CONFLICT");
    return node;
}

async function confirmSaved(session: CanvasSession, binding: CanvasWebVideoTask, signal: AbortSignal) {
    const check = () => {
        signal.throwIfAborted();
        if (!sameWebVideoTask(taskNode(session, binding).metadata?.webVideoTask, binding)) throw new ModelExecutionError("MODEL_TASK_CONFLICT");
    };
    check();
    try {
        await session.flush();
        check();
        const document = await storage.projects.getItem<CanvasDocument>(binding.projectId);
        const node = document?.nodes.find((node) => node.id === binding.nodeId);
        if (!document || !node || !isWebVideoTaskOwner(document.id, node, binding) || node.metadata?.webVideoSubmissionId !== undefined || !sameWebVideoTask(node.metadata?.webVideoTask, binding)) throw new ModelExecutionError("MODEL_TASK_CONFLICT");
    } finally { check(); }
}

function setBinding(session: CanvasSession, binding: CanvasWebVideoTask, previous: CanvasWebVideoTask | null) {
    const node = taskNode(session, binding);
    const current = node.metadata?.webVideoTask;
    const same = sameWebVideoTask(current, binding);
    if (previous) {
        if (!sameWebVideoTask(current, previous) || !sameWebVideoTask({ ...previous, paused: binding.paused }, binding)) throw new ModelExecutionError("MODEL_TASK_CONFLICT");
    } else if (current ? !same : node.metadata?.webVideoSubmissionId !== binding.runId) throw new ModelExecutionError("MODEL_TASK_CONFLICT");
    const status = binding.paused ? "idle" : "loading";
    if (!same || node.metadata?.webVideoSubmissionId !== undefined || node.metadata?.status !== status || node.metadata.errorDetails !== undefined) {
        session.updateDocument((document) => ({ ...document, nodes: document.nodes.map((node) => node.id === binding.nodeId ? {
            ...node, metadata: { ...node.metadata, webVideoSubmissionId: undefined, webVideoTask: binding, status, errorDetails: undefined },
        } : node) }), { source: { kind: "system", id: "web-video-task" }, history: false });
    }
}

export async function saveWebVideoTask(session: CanvasSession, binding: CanvasWebVideoTask, signal: AbortSignal, previous?: CanvasWebVideoTask): Promise<void> {
    const running = AbortSignal.any([session.signal, signal]);
    running.throwIfAborted();
    setBinding(session, binding, previous ?? null);
    await confirmSaved(session, binding, running);
}

/** expected=null 创建，传原绑定恢复；省略时只查询已经保存的任务。 */
export async function readWebVideoTaskResult(session: CanvasSession, binding: CanvasWebVideoTask, getConfig: () => AiConfig, signal: AbortSignal, apply: (file: UploadedFile) => boolean, options?: { expected?: CanvasWebVideoTask | null; originalFingerprint?: string; onAccepted?: () => void }): Promise<void> {
    const owner = new AbortController();
    const observing = AbortSignal.any([signal, session.signal, owner.signal]);
    observing.throwIfAborted();
    if (binding.paused) throw new ModelExecutionError("MODEL_TASK_CONFLICT");
    if (options?.originalFingerprint !== undefined) {
        if (options.expected !== null || taskNode(session, binding).metadata?.webVideoSubmissionId !== binding.runId) throw new ModelExecutionError("MODEL_TASK_CONFLICT");
        if (!unsaved.has(session)) unsaved.set(session, new Map());
        unsaved.get(session)!.set(binding.nodeId, { task: binding, fingerprint: options.originalFingerprint });
    }
    if (options?.expected !== undefined) setBinding(session, binding, options.expected);
    const check = () => {
        if (observing.aborted) return;
        try {
            if (!sameWebVideoTask(taskNode(session, binding).metadata?.webVideoTask, binding)) owner.abort(new ModelExecutionError("MODEL_TASK_CONFLICT"));
        } catch (error) { owner.abort(error); }
    };
    check();
    observing.throwIfAborted();
    const unsubscribe = session.subscribe(check);
    let accepted = false;
    try {
        const { projectId, nodeId, sourceId, runId, id, model, scriptId, script } = binding;
        const pending = unsaved.get(session)?.get(nodeId);
        let original: string | null | undefined;
        try {
            await confirmSaved(session, binding, observing);
            const identity = await sha256(new TextEncoder().encode(JSON.stringify([projectId, nodeId, sourceId, runId, id, model, scriptId, script])).buffer);
            observing.throwIfAborted();
            original = await storage.canvasVideoConnection?.(binding, identity, pending && sameCanvasVideoRun(pending.task, binding) ? pending.fingerprint : undefined);
            if (original && pending && unsaved.get(session)?.get(nodeId) === pending && sameCanvasVideoRun(pending.task, binding)) unsaved.get(session)!.delete(nodeId);
        } catch (error) {
            if (error instanceof ModelExecutionError) throw error;
            observing.throwIfAborted();
            console.error("[canvas] video task receipt", error);
            throw new ModelExecutionError("MODEL_VIDEO_RECEIPT_UNSAVED");
        }
        observing.throwIfAborted();
        if (!original) throw new ModelExecutionError("MODEL_VIDEO_CONNECTION_UNVERIFIED");
        await callScriptsReady;
        const result = await waitForVideoGenerationTask(async () => {
            await channelWrites.flush();
            const config = getConfig();
            if (await videoChannelFingerprint(config, model, runId) !== original) throw new ModelExecutionError("MODEL_VIDEO_CONNECTION_CHANGED");
            if (getModelConfigIssue(config, model, undefined, scriptId)) throw new ModelExecutionError("MODEL_CONFIG_MISSING");
            return config;
        }, binding, { signal: observing });
        observing.throwIfAborted();
        const source = await resolveGeneratedVideo(result, observing);
        await session.commitMediaResult(source, observing, apply, { onAccepted: () => { accepted = true; options?.onAccepted?.(); } });
    } catch (error) {
        if (!accepted) observing.throwIfAborted();
        throw error;
    } finally { unsubscribe(); }
}
