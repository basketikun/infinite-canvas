import type { CanvasDocumentOp } from "@infinite-canvas/shared/canvas/ops/apply";
import type { CanvasSnapshot, ReadonlyCanvasNode } from "@infinite-canvas/plugin-sdk";
import { isCanvasTaskBinding, isWebVideoTaskOwner, type CanvasWebVideoTask } from "@infinite-canvas/shared/canvas/schema/canvas";
import { ModelExecutionError } from "@infinite-canvas/shared/model-http";

export type CanvasGenerationRequest = {
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
    controller: AbortController;
    mediaTarget?: { revision: number; type: string; originType?: string; slotId?: string };
    webVideoSubmissionId?: string;
    webVideoTask?: CanvasWebVideoTask;
    release: () => void;
};

/** 有原任务时只能恢复；缺少恢复上下文不能改投一次新生成。 */
export function resolveNodeRetryTarget(projectId: string, node: ReadonlyCanvasNode, slotId: string | undefined, canRestoreTasks: boolean) {
    const webTask = node.metadata?.webVideoTask;
    if (webTask) {
        if (!isWebVideoTaskOwner(projectId, node, webTask)) throw new ModelExecutionError("MODEL_TASK_CONFLICT");
        if (canRestoreTasks) throw new ModelExecutionError("MODEL_CONFIG_MISSING");
        return { kind: "video" as const };
    }
    const bindings = node.metadata?.tasks?.filter((binding) => slotId === undefined || binding.slotId === slotId);
    if (bindings?.length) {
        if (bindings.some((binding) => !isCanvasTaskBinding(projectId, node, binding))) throw new ModelExecutionError("MODEL_TASK_CONFLICT");
        if (!canRestoreTasks) throw new ModelExecutionError("MODEL_CONFIG_MISSING");
        return { kind: "tasks" as const, bindings };
    }
    return { kind: "generate" as const };
}

/** 同批次目标共用控制器；更换目标请求只撤销对应的上一代。 */
export function startNodeGenerationRequest(requests: Map<string, CanvasGenerationRequest>, sessionSignal: AbortSignal, targetNodeId: string, originNodeId: string, runningId = originNodeId, controller = new AbortController(), parentSignal?: AbortSignal) {
    sessionSignal.throwIfAborted();
    parentSignal?.throwIfAborted();
    controller.signal.throwIfAborted();
    const previous = requests.get(targetNodeId);
    if (previous?.controller === controller) return controller;
    const signal = parentSignal ? AbortSignal.any([sessionSignal, parentSignal]) : sessionSignal;
    const cancel = () => controller.abort(signal.reason);
    signal.addEventListener("abort", cancel, { once: true, signal: controller.signal });
    previous?.release();
    previous?.controller.abort();
    requests.set(targetNodeId, { targetNodeId, originNodeId, runningNodeId: runningId, controller, release: () => signal.removeEventListener("abort", cancel) });
    return controller;
}

/** 先捕获同一控制器上的全部任务，收到停止回执后只更新仍属于本次操作的节点。 */
export async function stopNodeGenerationRequests(runningId: string, requests: Map<string, CanvasGenerationRequest>, stop: (nodeId: string, signal: AbortSignal) => Promise<boolean>, update: (confirmed: Set<string>, finished: Set<string>) => void, original?: ReadonlySet<AbortController>) {
    const active = [...requests.values()];
    const controllers = original ?? new Set(active.filter((item) => [item.runningNodeId, item.targetNodeId, item.originNodeId].includes(runningId)).map((item) => item.controller));
    const targets = active.filter((item) => controllers.has(item.controller));
    const receipts = targets.map((item) => stop(item.targetNodeId, item.controller.signal));
    for (const controller of controllers) controller.abort(new DOMException("task-stop", "AbortError"));
    const results = await Promise.allSettled(receipts);
    const confirmed = new Set<string>();
    const finished = new Set<string>();
    const retained = new Set<string>();
    for (const [index, item] of targets.entries()) {
        const result = results[index];
        const current = requests.get(item.targetNodeId) === item;
        const ids = current && result.status === "fulfilled" && result.value ? confirmed : retained;
        ids.add(item.targetNodeId);
        ids.add(item.originNodeId);
        if (current) {
            finished.add(item.runningNodeId);
            item.release();
            requests.delete(item.targetNodeId);
        }
    }
    for (const item of requests.values()) {
        finished.delete(item.runningNodeId);
        retained.add(item.targetNodeId);
        retained.add(item.originNodeId);
    }
    for (const id of retained) confirmed.delete(id);
    if (confirmed.size || finished.size) update(confirmed, finished);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
}

/** 手工改稿只结束本地观察；保留其他批次任务，不发出远端停止意图。 */
export function setTextNodeContent(node: ReadonlyCanvasNode, content: string, transact: (ops: CanvasDocumentOp[]) => CanvasSnapshot, requests: Map<string, CanvasGenerationRequest>) {
    requests.get(node.id)?.controller.abort();
    return transact([{ type: "update_node", id: node.id, metadata: {
        content,
        tasks: node.metadata?.tasks?.filter((binding) => binding.slotId && binding.slotId !== node.metadata?.primaryTextId),
        texts: node.metadata?.texts?.map((text) => text.id === node.metadata?.primaryTextId ? { ...text, content } : { ...text }),
    } }]);
}
