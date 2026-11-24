import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { useAgentStore } from "@workbench/stores/use-agent-store";
import type { CanvasAgentOp } from "@infinite-canvas/shared/canvas/tools/types";
import { executeCanvasAgentOps, type CanvasAgentSnapshot } from "@workbench/lib/canvas/canvas-agent-ops";
import type { CanvasSession } from "@workbench/lib/canvas/canvas-session";
import type { ContextMenuState } from "@workbench/types/canvas";

type AgentBridgeParams = {
    session: CanvasSession;
    title: string;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
};

/** 工具先准备完整批次，再向发起时的项目会话提交一次事务。 */
export function useAgentBridge({ session, title, setContextMenu }: AgentBridgeParams) {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
    const setAgentCanvasContext = useAgentStore((state) => state.setCanvasContext);
    const agentSnapshot = useMemo<CanvasAgentSnapshot>(() => ({ projectId: session.projectId, title, nodes: snapshot.nodes, connections: snapshot.connections, selectedNodeIds: snapshot.selection.nodeIds, viewport: snapshot.viewport }), [session, snapshot, title]);
    const applyAgentOps = useCallback(async (ops: CanvasAgentOp[] = []) => {
        const snapshot = await executeCanvasAgentOps(session, title, ops);
        session.signal.throwIfAborted();
        setContextMenu(null);
        return snapshot;
    }, [session, setContextMenu, title]);
    useLayoutEffect(() => {
        if (!session.signal.aborted) setAgentCanvasContext({ signal: session.signal, snapshot: agentSnapshot, applyOps: applyAgentOps });
    }, [agentSnapshot, applyAgentOps, session, setAgentCanvasContext]);
    useLayoutEffect(() => {
        const close = () => {
            if (useAgentStore.getState().canvasContext?.signal === session.signal) setAgentCanvasContext(null);
        };
        session.signal.addEventListener("abort", close, { once: true });
        if (session.signal.aborted) close();
        return () => { session.signal.removeEventListener("abort", close); close(); };
    }, [session, setAgentCanvasContext]);

    return { applyAgentOps };
}
