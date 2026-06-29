"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData } from "../types";

export type CanvasHistorySnapshot = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
};

type CanvasHistoryState = {
    canUndo: boolean;
    canRedo: boolean;
};

type CanvasHistoryStacks = {
    past: CanvasHistorySnapshot[];
    future: CanvasHistorySnapshot[];
};

type CanvasHistoryHandlers = {
    enabled: boolean;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setChatSessions: Dispatch<SetStateAction<CanvasAssistantSession[]>>;
    setActiveChatId: Dispatch<SetStateAction<string | null>>;
    setBackgroundMode: Dispatch<SetStateAction<CanvasBackgroundMode>>;
    setShowImageInfo: Dispatch<SetStateAction<boolean>>;
    onApplyHistory?: () => void;
};

const HISTORY_COMMIT_DEBOUNCE_MS = 180;
const HISTORY_LIMIT = 50;

function isSameHistorySnapshot(previous: CanvasHistorySnapshot | null, next: CanvasHistorySnapshot) {
    return (
        previous?.nodes === next.nodes &&
        previous.connections === next.connections &&
        previous.chatSessions === next.chatSessions &&
        previous.activeChatId === next.activeChatId &&
        previous.backgroundMode === next.backgroundMode &&
        previous.showImageInfo === next.showImageInfo
    );
}

export function useCanvasHistory(snapshot: CanvasHistorySnapshot, handlers: CanvasHistoryHandlers) {
    const historyRef = useRef<CanvasHistoryStacks>({ past: [], future: [] });
    const lastHistoryRef = useRef<CanvasHistorySnapshot | null>(null);
    const historyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const applyingHistoryRef = useRef(false);
    const historyPausedRef = useRef(false);
    const [historyState, setHistoryState] = useState<CanvasHistoryState>({ canUndo: false, canRedo: false });

    const { enabled, setNodes, setConnections, setChatSessions, setActiveChatId, setBackgroundMode, setShowImageInfo, onApplyHistory } = handlers;

    const createHistoryEntry = useCallback(
        (): CanvasHistorySnapshot => ({
            nodes: snapshot.nodes,
            connections: snapshot.connections,
            chatSessions: snapshot.chatSessions,
            activeChatId: snapshot.activeChatId,
            backgroundMode: snapshot.backgroundMode,
            showImageInfo: snapshot.showImageInfo,
        }),
        [snapshot.activeChatId, snapshot.backgroundMode, snapshot.chatSessions, snapshot.connections, snapshot.nodes, snapshot.showImageInfo],
    );

    const clearHistoryCommitTimer = useCallback(() => {
        if (!historyCommitTimerRef.current) return;
        clearTimeout(historyCommitTimerRef.current);
        historyCommitTimerRef.current = null;
    }, []);

    const syncHistoryState = useCallback(() => {
        setHistoryState({
            canUndo: historyRef.current.past.length > 0,
            canRedo: historyRef.current.future.length > 0,
        });
    }, []);

    const resetHistory = useCallback(
        (entry: CanvasHistorySnapshot) => {
            clearHistoryCommitTimer();
            historyRef.current = { past: [], future: [] };
            lastHistoryRef.current = entry;
            historyPausedRef.current = false;
            applyingHistoryRef.current = false;
            syncHistoryState();
        },
        [clearHistoryCommitTimer, syncHistoryState],
    );

    const commitHistory = useCallback(() => {
        if (!enabled || applyingHistoryRef.current || historyPausedRef.current) return;

        const next = createHistoryEntry();
        const previous = lastHistoryRef.current;
        if (isSameHistorySnapshot(previous, next)) return;

        clearHistoryCommitTimer();
        historyCommitTimerRef.current = setTimeout(() => {
            const current = createHistoryEntry();
            const last = lastHistoryRef.current;
            if (!last || applyingHistoryRef.current || historyPausedRef.current) return;

            historyRef.current.past = [...historyRef.current.past.slice(-(HISTORY_LIMIT - 1)), last];
            historyRef.current.future = [];
            lastHistoryRef.current = current;
            historyCommitTimerRef.current = null;
            syncHistoryState();
        }, HISTORY_COMMIT_DEBOUNCE_MS);
    }, [clearHistoryCommitTimer, createHistoryEntry, enabled, syncHistoryState]);

    const applyHistory = useCallback(
        (entry: CanvasHistorySnapshot) => {
            clearHistoryCommitTimer();
            applyingHistoryRef.current = true;
            setNodes(entry.nodes);
            setConnections(entry.connections);
            setChatSessions(entry.chatSessions);
            setActiveChatId(entry.activeChatId);
            setBackgroundMode(entry.backgroundMode);
            setShowImageInfo(entry.showImageInfo);
            onApplyHistory?.();

            setTimeout(() => {
                lastHistoryRef.current = entry;
                applyingHistoryRef.current = false;
                syncHistoryState();
            });
        },
        [clearHistoryCommitTimer, onApplyHistory, setActiveChatId, setBackgroundMode, setChatSessions, setConnections, setNodes, setShowImageInfo, syncHistoryState],
    );

    const undoCanvas = useCallback(() => {
        const previous = historyRef.current.past.pop();
        const current = lastHistoryRef.current;
        if (!previous || !current) return;
        historyRef.current.future.push(current);
        applyHistory(previous);
    }, [applyHistory]);

    const redoCanvas = useCallback(() => {
        const next = historyRef.current.future.pop();
        const current = lastHistoryRef.current;
        if (!next || !current) return;
        historyRef.current.past.push(current);
        applyHistory(next);
    }, [applyHistory]);

    const pauseHistory = useCallback(() => {
        historyPausedRef.current = true;
    }, []);

    const resumeHistory = useCallback(() => {
        historyPausedRef.current = false;
    }, []);

    const isHistoryPaused = useCallback(() => historyPausedRef.current, []);

    const getCleanupHistory = useCallback(
        () => ({
            history: historyRef.current,
            lastHistory: lastHistoryRef.current,
        }),
        [],
    );

    useEffect(() => {
        commitHistory();
        return clearHistoryCommitTimer;
    }, [clearHistoryCommitTimer, commitHistory]);

    useEffect(() => clearHistoryCommitTimer, [clearHistoryCommitTimer]);

    return {
        historyState,
        commitHistory,
        undoCanvas,
        redoCanvas,
        resetHistory,
        pauseHistory,
        resumeHistory,
        isHistoryPaused,
        getCleanupHistory,
    };
}
