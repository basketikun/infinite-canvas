import { useLayoutEffect, useState } from "react";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { PluginError } from "@infinite-canvas/shared/plugins";
import type { CanvasSession } from "@workbench/lib/canvas/canvas-session";
import { bindHostActions } from "@workbench/lib/canvas/host-actions";

export type NodeInfoRecord = {
    // 从当前会话快照读取信息的目标节点。
    nodeId: string;
    // 打开信息时捕获的调用方与项目作用域。
    scope: ScopeBinding;
    // 只关闭本次打开的记录，旧回调不会关闭新记录。
    close: () => void;
};

export function registerNodeInfo(session: CanvasSession, onChange: (record: NodeInfoRecord | null) => void) {
    let current: NodeInfoRecord | null = null;
    const dispose = bindHostActions(session, {
        nodeOpenInfo: ({ nodeId }, context) => {
            context.signal.throwIfAborted();
            if (!context.canvas!.getNodes().some((node) => node.id === nodeId)) throw new PluginError("PLUGIN_NOT_FOUND");
            current?.close();
            const scope = Object.freeze({ ...context.scope, signal: AbortSignal.any([context.signal, session.signal]) });
            scope.signal.throwIfAborted();
            const record: NodeInfoRecord = { nodeId, scope, close: () => {
                if (current !== record) return;
                current = null;
                unsubscribe();
                scope.signal.removeEventListener("abort", record.close);
                onChange(null);
            } };
            const unsubscribe = session.subscribe(() => {
                if (!session.getSnapshot().nodes.some((node) => node.id === nodeId)) record.close();
            });
            scope.signal.addEventListener("abort", record.close, { once: true });
            current = record;
            onChange(record);
        },
    });
    return () => { dispose(); current?.close(); };
}

export function useNodeInfo(session: CanvasSession) {
    const [record, setRecord] = useState<NodeInfoRecord | null>(null);
    useLayoutEffect(() => registerNodeInfo(session, setRecord), [session]);
    return record;
}
