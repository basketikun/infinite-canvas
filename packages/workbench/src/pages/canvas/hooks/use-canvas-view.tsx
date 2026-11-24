import { useCallback, useLayoutEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { createCanvasView, type CanvasViewController } from "@workbench/lib/canvas/canvas-view";
import type { CanvasSession } from "@workbench/lib/canvas/canvas-session";

export function useCanvasView(session: CanvasSession, containerRef: RefObject<HTMLDivElement | null>, setContextMenu: (value: null) => void) {
    const [view, setView] = useState<CanvasViewController | null>(null);
    const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
    useLayoutEffect(() => {
        const current = createCanvasView(session, containerRef, setHoverNodeId, () => setContextMenu(null));
        setView(current);
        return () => current.dispose();
    }, [session, containerRef, setContextMenu]);
    const active = view?.scope.projectId === session.projectId && !view.scope.signal.aborted ? view : null;
    const snapshot = useSyncExternalStore(
        useCallback((listener: () => void) => active ? active.subscribe(listener) : () => {}, [active]),
        useCallback(() => active ? active.getSnapshot() : null, [active]),
    );
    return { view: active, hoverNodeId: active ? hoverNodeId : null, canvasTool: snapshot?.tool ?? "pan", isMiniMapOpen: snapshot?.miniMapOpen ?? false };
}
