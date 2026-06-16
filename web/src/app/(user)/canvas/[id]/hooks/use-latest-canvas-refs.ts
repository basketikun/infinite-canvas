import { useLayoutEffect, useRef } from "react";

import type { CanvasConnection, CanvasNodeData, CanvasNodeGroup, SelectionBox, ViewportTransform } from "../../types";

type UseLatestCanvasRefsParams = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    groups: CanvasNodeGroup[];
    selectedNodeIds: Set<string>;
    viewport: ViewportTransform;
    selectionBox: SelectionBox | null;
};

export function useLatestCanvasRefs({ nodes, connections, groups, selectedNodeIds, viewport, selectionBox }: UseLatestCanvasRefsParams) {
    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const groupsRef = useRef(groups);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const viewportRef = useRef(viewport);
    const selectionBoxRef = useRef(selectionBox);

    useLayoutEffect(() => {
        nodesRef.current = nodes;
        connectionsRef.current = connections;
        groupsRef.current = groups;
        selectedNodeIdsRef.current = selectedNodeIds;
        viewportRef.current = viewport;
    }, [nodes, connections, groups, selectedNodeIds, viewport]);

    useLayoutEffect(() => {
        selectionBoxRef.current = selectionBox;
    }, [selectionBox]);

    return {
        nodesRef,
        connectionsRef,
        groupsRef,
        selectedNodeIdsRef,
        viewportRef,
        selectionBoxRef,
    };
}
