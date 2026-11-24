import { PluginError } from "@infinite-canvas/shared/plugins";
import type { CanvasGenerationRequest } from "@workbench/lib/canvas/node-generation-state";

/** 生成命令会包装其内部观察的中止原因。只忽略用户主动停止的这一种。 */
export function isNodeGenerationStopped(error: unknown) {
    return error instanceof PluginError && error.code === "PLUGIN_OPERATION_FAILED" && error.cause instanceof DOMException && error.cause.name === "AbortError" && error.cause.message === "task-stop";
}

export type NodeStopConfirmation = { accept: () => Promise<void>; cancel: () => void };

export async function confirmNodeStop(present: (confirmation: NodeStopConfirmation) => () => void, signal: AbortSignal, requests: ReadonlyMap<string, CanvasGenerationRequest>, nodeId: string, stop: (controllers: ReadonlySet<AbortController>) => Promise<void>) {
    signal.throwIfAborted();
    const original = [...requests.values()].filter((item) => !item.controller.signal.aborted && [item.runningNodeId, item.targetNodeId, item.originNodeId].includes(nodeId));
    if (!original.length) return;

    const receipt = Promise.withResolvers<void>();
    let decided = false;
    const dismiss = present({
        accept: async () => {
            if (decided) return;
            decided = true;
            try {
                signal.throwIfAborted();
                const controllers = new Set(original.filter((item) => requests.get(item.targetNodeId) === item && !item.controller.signal.aborted).map((item) => item.controller));
                if (controllers.size) await stop(controllers);
                signal.throwIfAborted();
                receipt.resolve();
            } catch (error) { receipt.reject(error); }
        },
        cancel: () => {
            if (decided) return;
            decided = true;
            receipt.resolve();
        },
    });
    const close = () => {
        if (!decided) {
            decided = true;
            receipt.reject(signal.reason);
        }
        dismiss();
    };
    signal.addEventListener("abort", close, { once: true });
    if (signal.aborted) close();
    try { await receipt.promise; }
    finally { signal.removeEventListener("abort", close); if (!signal.aborted) dismiss(); }
}
