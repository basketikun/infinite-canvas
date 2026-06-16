import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, MouseEvent as ReactMouseEvent, MutableRefObject, SetStateAction } from "react";
import { nanoid } from "nanoid";

import { getNodeSpec } from "../../constants";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type ConnectionHandle, type ContextMenuState, type Position, type ViewportTransform } from "../../types";
import type { AddNodesMenuState, ConnectionDropTarget, PendingConnectionCreate } from "../canvas-page-types";
import {
    CONNECTION_HANDLE_HIT_RADIUS,
    CONNECTION_NODE_HIT_PADDING,
    CONNECTION_TAP_MOVE_PX,
    CONNECTION_TAP_MS,
    CONNECTED_NODE_GAP,
    createCanvasNode,
    getConnectionTargetAnchor,
    isHiddenBatchChild,
    normalizeConnection,
} from "../canvas-page-utils";

type ConnectedNodeType = CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio;

type UseCanvasConnectionsParams = {
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    viewportRef: MutableRefObject<ViewportTransform>;
    screenToCanvas: (clientX: number, clientY: number) => Position;
    configNodeMetadata: CanvasNodeMetadata;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
    setAddNodesMenu: Dispatch<SetStateAction<AddNodesMenuState | null>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    message: {
        warning: (content: string) => void;
    };
};

export function useCanvasConnections({
    nodesRef,
    connectionsRef,
    viewportRef,
    screenToCanvas,
    configNodeMetadata,
    setNodes,
    setConnections,
    setSelectedNodeIds,
    setContextMenu,
    setAddNodesMenu,
    setDialogNodeId,
    message,
}: UseCanvasConnectionsParams) {
    const connectionTapRef = useRef<{ startTime: number; startX: number; startY: number } | null>(null);
    const connectingParamsRef = useRef<ConnectionHandle | null>(null);
    const connectionTargetNodeIdRef = useRef<string | null>(null);
    const pendingConnectionCreateRef = useRef<PendingConnectionCreate | null>(null);
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    const [connectingParams, setConnectingParams] = useState<ConnectionHandle | null>(null);
    const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<string | null>(null);
    const [pendingConnectionCreate, setPendingConnectionCreate] = useState<PendingConnectionCreate | null>(null);
    const [mouseWorld, setMouseWorld] = useState<Position>({ x: 0, y: 0 });

    useLayoutEffect(() => {
        connectingParamsRef.current = connectingParams;
        connectionTargetNodeIdRef.current = connectionTargetNodeId;
        pendingConnectionCreateRef.current = pendingConnectionCreate;
    }, [connectingParams, connectionTargetNodeId, pendingConnectionCreate]);

    const setConnecting = useCallback((next: ConnectionHandle | null) => {
        connectingParamsRef.current = next;
        setConnectingParams(next);
        if (!next) {
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
        }
    }, []);

    const setPendingConnectionCreateState = useCallback((next: PendingConnectionCreate | null) => {
        pendingConnectionCreateRef.current = next;
        setPendingConnectionCreate(next);
    }, []);

    const setConnectionTargetNodeIdState = useCallback((next: string | null) => {
        connectionTargetNodeIdRef.current = next;
        setConnectionTargetNodeId(next);
    }, []);

    const connectNodes = useCallback(
        (current: ConnectionHandle, targetNodeId: string) => {
            if (current.nodeId === targetNodeId) return;

            const connection = normalizeConnection(current.nodeId, targetNodeId, nodesRef.current, current.handleType);
            if (!connection) {
                message.warning("配置节点之间不能连接");
                return;
            }
            const { fromNodeId, toNodeId } = connection;
            const exists = connectionsRef.current.some((conn) => conn.fromNodeId === fromNodeId && conn.toNodeId === toNodeId);
            if (!exists) setConnections((prev) => [...prev, { id: `conn-${Date.now()}`, fromNodeId, toNodeId }]);
            setContextMenu(null);
            setAddNodesMenu(null);
        },
        [connectionsRef, message, nodesRef, setAddNodesMenu, setConnections, setContextMenu],
    );

    const createConnectedNode = useCallback(
        (type: ConnectedNodeType, pending: PendingConnectionCreate) => {
            const sourceNode = nodesRef.current.find((node) => node.id === pending.connection.nodeId);
            const spec = getNodeSpec(type);
            const centerPosition =
                pending.placeByHandle && sourceNode
                    ? {
                          x: pending.connection.handleType === "source" ? sourceNode.position.x + sourceNode.width + CONNECTED_NODE_GAP + spec.width / 2 : sourceNode.position.x - CONNECTED_NODE_GAP - spec.width / 2,
                          y: sourceNode.position.y + sourceNode.height / 2,
                      }
                    : pending.position;
            const newNode = createCanvasNode(type, centerPosition, type === CanvasNodeType.Config ? configNodeMetadata : undefined);
            const connection = normalizeConnection(pending.connection.nodeId, newNode.id, [...nodesRef.current, newNode], pending.connection.handleType);
            if (!connection) {
                message.warning("配置节点之间不能连接");
                return;
            }
            setNodes((prev) => [...prev, newNode]);
            setConnections((prev) => [...prev, { id: nanoid(), ...connection }]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            setAddNodesMenu(null);
            if (type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio) setDialogNodeId(newNode.id);
            setPendingConnectionCreateState(null);
            setConnecting(null);
        },
        [configNodeMetadata, message, nodesRef, setAddNodesMenu, setConnecting, setConnections, setDialogNodeId, setNodes, setPendingConnectionCreateState, setSelectedNodeIds],
    );

    const cancelPendingConnectionCreate = useCallback(() => {
        connectionTapRef.current = null;
        setPendingConnectionCreateState(null);
        setConnecting(null);
    }, [setConnecting, setPendingConnectionCreateState]);

    const getConnectionDropTarget = useCallback(
        (clientX: number, clientY: number, current: ConnectionHandle): ConnectionDropTarget => {
            const world = screenToCanvas(clientX, clientY);
            const scale = Math.max(viewportRef.current.k, 0.05);
            const padding = CONNECTION_NODE_HIT_PADDING / scale;
            const handleRadius = CONNECTION_HANDLE_HIT_RADIUS / scale;
            let isNearNode = false;
            let bestNodeId: string | null = null;
            let bestPriority = Number.POSITIVE_INFINITY;

            [...nodesRef.current]
                .filter((node) => !isHiddenBatchChild(node, nodesRef.current))
                .reverse()
                .forEach((node) => {
                    const anchor = getConnectionTargetAnchor(node, current);
                    const dx = world.x - anchor.x;
                    const dy = world.y - anchor.y;
                    const hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
                    const hitsInside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
                    const hitsExpanded = world.x >= node.position.x - padding && world.x <= node.position.x + node.width + padding && world.y >= node.position.y - padding && world.y <= node.position.y + node.height + padding;

                    if (!hitsHandle && !hitsInside && !hitsExpanded) return;
                    isNearNode = true;
                    if (node.id === current.nodeId || !normalizeConnection(current.nodeId, node.id, nodesRef.current, current.handleType)) return;

                    const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
                    if (priority < bestPriority) {
                        bestNodeId = node.id;
                        bestPriority = priority;
                    }
                });

            return { nodeId: bestNodeId, isNearNode };
        },
        [nodesRef, screenToCanvas, viewportRef],
    );

    const updateConnectionDrag = useCallback(
        (clientX: number, clientY: number) => {
            const currentConnection = connectingParamsRef.current;
            if (!currentConnection || pendingConnectionCreateRef.current) return;
            const dropTarget = getConnectionDropTarget(clientX, clientY, currentConnection);
            setConnectionTargetNodeIdState(dropTarget.nodeId);
            setMouseWorld(screenToCanvas(clientX, clientY));
        },
        [getConnectionDropTarget, screenToCanvas, setConnectionTargetNodeIdState],
    );

    const finishConnectionDrag = useCallback(
        (clientX: number, clientY: number) => {
            if (pendingConnectionCreateRef.current) return;

            const currentConnection = connectingParamsRef.current;
            if (!currentConnection) return;

            const dropTarget = getConnectionDropTarget(clientX, clientY, currentConnection);
            const tap = connectionTapRef.current;
            const isShortTap = Boolean(tap && Date.now() - tap.startTime <= CONNECTION_TAP_MS && Math.hypot(clientX - tap.startX, clientY - tap.startY) <= CONNECTION_TAP_MOVE_PX);
            const position = screenToCanvas(clientX, clientY);

            if (dropTarget.nodeId) {
                connectNodes(currentConnection, dropTarget.nodeId);
                setConnecting(null);
            } else if (isShortTap) {
                setMouseWorld(position);
                setAddNodesMenu(null);
                setPendingConnectionCreateState({ connection: currentConnection, position, placeByHandle: true });
            } else if (dropTarget.isNearNode) {
                setConnecting(null);
            } else {
                setMouseWorld(position);
                setAddNodesMenu(null);
                setPendingConnectionCreateState({ connection: currentConnection, position });
            }
            connectionTapRef.current = null;
        },
        [connectNodes, getConnectionDropTarget, screenToCanvas, setAddNodesMenu, setConnecting, setPendingConnectionCreateState],
    );

    const deleteConnection = useCallback(
        (connectionId: string) => {
            setConnections((prev) => prev.filter((conn) => conn.id !== connectionId));
            setSelectedConnectionId((current) => (current === connectionId ? null : current));
            setContextMenu((current) => (current?.type === "connection" && current.connectionId === connectionId ? null : current));
        },
        [setConnections, setContextMenu, setSelectedConnectionId],
    );

    const selectConnection = useCallback(
        (connectionId: string) => {
            setSelectedConnectionId(connectionId);
            setSelectedNodeIds(new Set());
            setContextMenu(null);
            setAddNodesMenu(null);
        },
        [setAddNodesMenu, setContextMenu, setSelectedNodeIds],
    );

    const openConnectionContextMenu = useCallback(
        (connectionId: string, x: number, y: number) => {
            setSelectedConnectionId(connectionId);
            setSelectedNodeIds(new Set());
            setAddNodesMenu(null);
            setContextMenu({ type: "connection", x, y, connectionId });
        },
        [setAddNodesMenu, setContextMenu, setSelectedNodeIds],
    );

    const handleConnectStart = useCallback(
        (event: ReactMouseEvent, nodeId: string, handleType: "source" | "target") => {
            event.stopPropagation();
            connectionTapRef.current = { startTime: Date.now(), startX: event.clientX, startY: event.clientY };
            setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            setConnecting({ nodeId, handleType });
            setConnectionTargetNodeIdState(null);
            setSelectedConnectionId(null);
        },
        [screenToCanvas, setConnecting, setConnectionTargetNodeIdState],
    );

    return {
        selectedConnectionId,
        setSelectedConnectionId,
        connectingParams,
        setConnecting,
        connectingParamsRef,
        connectionTargetNodeId,
        connectionTargetNodeIdRef,
        pendingConnectionCreate,
        pendingConnectionCreateRef,
        mouseWorld,
        cancelPendingConnectionCreate,
        createConnectedNode,
        deleteConnection,
        finishConnectionDrag,
        handleConnectStart,
        openConnectionContextMenu,
        selectConnection,
        updateConnectionDrag,
    };
}
