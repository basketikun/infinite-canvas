import { useEffect, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasNodeData } from "../types";
import { useCanvasHistory, type CanvasHistorySnapshot } from "./use-canvas-history";

function createNode(id: string, x: number): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Text,
        title: id,
        position: { x, y: 0 },
        width: 240,
        height: 160,
    };
}

type HistoryApi = {
    history: ReturnType<typeof useCanvasHistory>;
    getSnapshot: () => CanvasHistorySnapshot;
    setSnapshot: (patch: Partial<CanvasHistorySnapshot>) => void;
};

function HistoryHarness({ onReady, onApplyHistory }: { onReady: (api: HistoryApi) => void; onApplyHistory: () => void }) {
    const [nodes, setNodes] = useState<CanvasNodeData[]>([createNode("n1", 0)]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [backgroundMode, setBackgroundMode] = useState<CanvasHistorySnapshot["backgroundMode"]>("lines");
    const [showImageInfo, setShowImageInfo] = useState(false);

    const snapshot: CanvasHistorySnapshot = {
        nodes,
        connections,
        chatSessions,
        activeChatId,
        backgroundMode,
        showImageInfo,
    };

    const history = useCanvasHistory(snapshot, {
        enabled: true,
        setNodes,
        setConnections,
        setChatSessions,
        setActiveChatId,
        setBackgroundMode,
        setShowImageInfo,
        onApplyHistory,
    });

    useEffect(() => {
        onReady({
            history,
            getSnapshot: () => snapshot,
            setSnapshot: (patch) => {
                if (patch.nodes) setNodes(patch.nodes);
                if (patch.connections) setConnections(patch.connections);
                if (patch.chatSessions) setChatSessions(patch.chatSessions);
                if ("activeChatId" in patch) setActiveChatId(patch.activeChatId ?? null);
                if (patch.backgroundMode) setBackgroundMode(patch.backgroundMode);
                if ("showImageInfo" in patch) setShowImageInfo(Boolean(patch.showImageInfo));
            },
        });
    }, [history, onReady, snapshot, onApplyHistory]);

    return null;
}

describe("useCanvasHistory", () => {
    let root: Root;
    let container: HTMLDivElement;
    let api: HistoryApi;
    const onApplyHistory = vi.fn();

    beforeEach(() => {
        vi.useFakeTimers();
        onApplyHistory.mockClear();
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        vi.useRealTimers();
    });

    it("debounces commits and applies undo redo snapshots", () => {
        act(() => {
            root.render(<HistoryHarness onReady={(next) => (api = next)} onApplyHistory={onApplyHistory} />);
        });

        act(() => {
            api.history.resetHistory(api.getSnapshot());
        });

        const movedNode = createNode("n1", 32);
        act(() => {
            api.setSnapshot({ nodes: [movedNode] });
        });

        act(() => {
            vi.advanceTimersByTime(179);
        });
        expect(api.history.historyState.canUndo).toBe(false);

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(api.history.historyState).toEqual({ canUndo: true, canRedo: false });
        expect(api.history.getCleanupHistory().history.past).toHaveLength(1);
        expect(api.history.getCleanupHistory().lastHistory?.nodes).toEqual([movedNode]);

        act(() => {
            api.history.undoCanvas();
        });
        act(() => {
            vi.runOnlyPendingTimers();
        });
        expect(api.getSnapshot().nodes[0].position.x).toBe(0);
        expect(api.history.historyState).toEqual({ canUndo: false, canRedo: true });
        expect(onApplyHistory).toHaveBeenCalledTimes(1);

        act(() => {
            api.history.redoCanvas();
        });
        act(() => {
            vi.runOnlyPendingTimers();
        });
        expect(api.getSnapshot().nodes).toEqual([movedNode]);
        expect(api.history.historyState).toEqual({ canUndo: true, canRedo: false });
        expect(onApplyHistory).toHaveBeenCalledTimes(2);
    });
});
