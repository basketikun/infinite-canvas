import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import i18n from "@/i18n";
import { useAgentStore } from "@/stores/use-agent-store";
import { applyCanvasAgentOps, assertCanvasWrite, canvasOpsTouches, canvasSnapshotChanges, type CanvasAgentOp, type CanvasAgentSnapshot, type CanvasAgentWriteRequest, type CanvasChangeSet, type CanvasRevisionEntry } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasConnection, CanvasNodeData, ContextMenuState, ViewportTransform } from "@/types/canvas";

type GenerateNodeRef = MutableRefObject<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>;
let lastRevisionSeed = 0;

function nextRevisionSeed() {
    lastRevisionSeed = Math.max(lastRevisionSeed + 1, Date.now());
    return lastRevisionSeed;
}

type AgentBridgeParams = {
    projectId: string;
    title: string | undefined;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: Set<string>;
    viewport: ViewportTransform;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    selectedNodeIdsRef: MutableRefObject<Set<string>>;
    viewportRef: MutableRefObject<ViewportTransform>;
    generateNodeRef: GenerateNodeRef;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
};

/**
 * Bridge between the canvas and local Agent: publish the current snapshot and apply/undo capabilities
 * to the Agent store for the local Codex panel. All members except applyAgentOps are internal.
 */
export function useAgentBridge(params: AgentBridgeParams) {
    const { projectId, title, nodes, connections, selectedNodeIds, viewport, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef, generateNodeRef, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, setViewport, setContextMenu } =
        params;
    const setAgentCanvasContext = useAgentStore((state) => state.setCanvasContext);
    const [agentUndoSnapshot, setAgentUndoSnapshot] = useState<CanvasAgentSnapshot | null>(null);
    const [revision, setRevision] = useState(nextRevisionSeed);
    const revisionRef = useRef(revision);
    const observedSnapshotRef = useRef<CanvasAgentSnapshot | null>(null);
    const revisionJournalRef = useRef<CanvasRevisionEntry[]>([]);
    const projectTitle = title || i18n.t("canvas.project.untitled");

    const agentSnapshot = useMemo<CanvasAgentSnapshot>(() => ({ projectId, title: projectTitle, nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport, revision }), [connections, projectTitle, nodes, projectId, revision, selectedNodeIds, viewport]);
    const recordRevision = useCallback((changes: CanvasChangeSet) => {
        const nextRevision = revisionRef.current + 1;
        revisionRef.current = nextRevision;
        revisionJournalRef.current = [...revisionJournalRef.current, { ...changes, revision: nextRevision }].slice(-200);
        setRevision(nextRevision);
        return nextRevision;
    }, []);
    useLayoutEffect(() => {
        const current: CanvasAgentSnapshot = { projectId, title: projectTitle, nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport, revision: revisionRef.current };
        const previous = observedSnapshotRef.current;
        if (!previous) {
            observedSnapshotRef.current = current;
            return;
        }
        if (previous.projectId !== projectId) {
            const nextRevision = nextRevisionSeed();
            revisionRef.current = nextRevision;
            revisionJournalRef.current = [];
            observedSnapshotRef.current = { ...current, revision: nextRevision };
            setRevision(nextRevision);
            return;
        }
        const changes = canvasSnapshotChanges(previous, current);
        if (changes.nodeIds.length || changes.connectionIds.length || changes.selection || changes.viewport) {
            const nextRevision = recordRevision(changes);
            observedSnapshotRef.current = { ...current, revision: nextRevision };
        } else {
            observedSnapshotRef.current = { ...current, revision: revisionRef.current };
        }
    }, [connections, nodes, projectId, projectTitle, recordRevision, selectedNodeIds, viewport]);
    const applyAgentOps = useCallback(
        (ops?: CanvasAgentOp[], request?: Pick<CanvasAgentWriteRequest, "projectId" | "baseRevision">) => {
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            const before: CanvasAgentSnapshot = { projectId, title: projectTitle, nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current, revision: revisionRef.current };
            if (request) assertCanvasWrite({ ...request, ops: safeOps }, before, revisionJournalRef.current);
            const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
            const next = applyCanvasAgentOps(
                before,
                safeOps.filter((op) => op.type !== "run_generation"),
            );
            const nextRevision = recordRevision(canvasOpsTouches(safeOps));
            const revised = { ...next, revision: nextRevision };
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            selectedNodeIdsRef.current = new Set(next.selectedNodeIds);
            viewportRef.current = next.viewport;
            setAgentUndoSnapshot(before);
            setNodes(next.nodes);
            setConnections(next.connections);
            setSelectedNodeIds(new Set(next.selectedNodeIds));
            setSelectedConnectionId(null);
            setViewport(next.viewport);
            setContextMenu(null);
            if (generationOps.length) {
                queueMicrotask(() =>
                    generationOps.forEach((op) => {
                        const target = nodesRef.current.find((node) => node.id === op.nodeId);
                        const prompt = op.prompt?.trim() ? op.prompt : (target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                        void generateNodeRef.current?.(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt);
                    }),
                );
            }
            observedSnapshotRef.current = revised;
            return revised;
        },
        [projectTitle, projectId, recordRevision],
    );
    const undoAgentOps = useCallback(() => {
        if (!agentUndoSnapshot) return null;
        nodesRef.current = agentUndoSnapshot.nodes;
        connectionsRef.current = agentUndoSnapshot.connections;
        selectedNodeIdsRef.current = new Set(agentUndoSnapshot.selectedNodeIds);
        viewportRef.current = agentUndoSnapshot.viewport;
        setNodes(agentUndoSnapshot.nodes);
        setConnections(agentUndoSnapshot.connections);
        setSelectedNodeIds(new Set(agentUndoSnapshot.selectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(agentUndoSnapshot.viewport);
        setContextMenu(null);
        setAgentUndoSnapshot(null);
        const nextRevision = recordRevision(canvasSnapshotChanges({ ...agentUndoSnapshot, revision: revisionRef.current }, { ...agentSnapshot, revision: revisionRef.current }));
        const snapshot = { ...agentUndoSnapshot, projectId, title: projectTitle, revision: nextRevision };
        observedSnapshotRef.current = snapshot;
        return snapshot;
    }, [agentSnapshot, agentUndoSnapshot, projectTitle, projectId, recordRevision]);

    useEffect(() => {
        setAgentCanvasContext({ snapshot: agentSnapshot, applyOps: applyAgentOps, undoOps: undoAgentOps, canUndo: Boolean(agentUndoSnapshot) });
        return () => setAgentCanvasContext(null);
    }, [agentSnapshot, applyAgentOps, agentUndoSnapshot, setAgentCanvasContext, undoAgentOps]);

    return { applyAgentOps };
}
