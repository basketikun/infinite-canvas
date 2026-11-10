import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { subscribeImagePreviews, getImagePreviewRevision } from "@/services/image-storage";
import { CanvasNodeGridItem, CanvasNodeListItem } from "./canvas-node-list-items";
import { CanvasNodeViewport } from "./canvas-node-viewport";
import { CanvasNodesControls, CanvasNodesSelection } from "./canvas-nodes-controls";
import { useCanvasNodesTab, type CanvasNodesProps } from "./use-canvas-nodes-tab";

export function CanvasNodesTab(props: CanvasNodesProps) {
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const state = useCanvasNodesTab(props);
    const grid = state.nodeViewMode === "grid";
    const Item = grid ? CanvasNodeGridItem : CanvasNodeListItem;
    return (
        <div className="flex h-full flex-col" onMouseLeave={() => props.onHoverNode(null)}>
            <CanvasNodesControls state={state} theme={props.theme} />
            <CanvasNodeViewport rows={grid ? state.gridRows : state.treeRows} grid={grid}
                onScroll={() => props.onHoverNode(null)}
                renderItem={(row) => <Item key={row.node.id} row={row} state={state} theme={props.theme} />}
                empty={<div className="pt-16 text-center text-sm opacity-40">{t("canvas.sidePanel.noNodes")}</div>} />
            {state.selectMode ? <CanvasNodesSelection state={state} theme={props.theme} /> : null}
        </div>
    );
}
