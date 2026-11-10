import { useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import type { CanvasTheme } from "@/lib/canvas-theme";
import { exportCanvasNodes } from "@/lib/canvas/canvas-export";
import { buildCanvasNodeRows } from "@/lib/canvas/canvas-node-list";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const PRESS_FOCUS_DELAY = 180;

export type CanvasNodesProps = {
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    onFocusNode: (nodeId: string) => void;
    onPreviewNode: (nodeId: string) => void;
    onHoverNode: (nodeId: string | null) => void;
    theme: CanvasTheme;
};

function useNodeFocus({ onFocusNode, onHoverNode }: CanvasNodesProps) {
    const focusTimerRef = useRef<number | null>(null);
    useEffect(() => () => { if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current); }, []);
    return (node: CanvasNodeData) => {
        if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
        const hasPreview = (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) && Boolean(node.metadata?.content);
        if (!hasPreview) {
            onFocusNode(node.id);
            return;
        }
        // Let the hover preview fade out before moving the canvas.
        onHoverNode(null);
        focusTimerRef.current = window.setTimeout(() => {
            focusTimerRef.current = null;
            onFocusNode(node.id);
        }, PRESS_FOCUS_DELAY);
    };
}

function useNodeExport(options: { nodes: CanvasNodeData[]; checked: Set<string>; exitSelect: () => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [exporting, setExporting] = useState(false);
    const handleExport = async () => {
        const targets = options.nodes.filter((node) => options.checked.has(node.id));
        if (!targets.length) return;
        setExporting(true);
        const hide = message.loading(t("canvas.sidePanel.exporting"), 0);
        try {
            await exportCanvasNodes(targets, t("canvas.sidePanel.exportName", { count: targets.length }));
            message.success(t("canvas.sidePanel.exported", { count: targets.length }));
            options.exitSelect();
        } catch (error) {
            console.error(error);
            message.error(t("canvas.sidePanel.exportFailed"));
        } finally {
            hide();
            setExporting(false);
        }
    };
    return { exporting, handleExport };
}

export function useCanvasNodesTab(props: CanvasNodesProps) {
    const { nodes } = props;
    const [keyword, setKeyword] = useState("");
    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [selectMode, setSelectMode] = useState(false);
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    const nodeViewMode = useCanvasSidePanelStore((state) => state.nodeViewMode);
    const setNodeViewMode = useCanvasSidePanelStore((state) => state.setNodeViewMode);
    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return nodes.filter((node) => (typeFilter === "all" || node.type === typeFilter) && (!query || [node.title, node.metadata?.content, node.metadata?.prompt].filter(Boolean).join(" ").toLowerCase().includes(query)));
    }, [nodes, keyword, typeFilter]);
    const treeRows = useMemo(() => buildCanvasNodeRows({ nodes, filtered, collapsedGroups }), [collapsedGroups, filtered, nodes]);
    const gridRows = useMemo(() => filtered.map((node) => ({ node, depth: 0, hasChildren: false })), [filtered]);
    const exitSelect = () => { setSelectMode(false); setChecked(new Set()); };
    const toggleChecked = (id: string) => setChecked((previous) => {
        const next = new Set(previous);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });
    const allChecked = useMemo(() => filtered.length > 0 && filtered.every((node) => checked.has(node.id)), [filtered, checked]);
    const toggleAll = () => setChecked(allChecked ? new Set() : new Set(filtered.map((node) => node.id)));
    const activateNode = useNodeFocus(props);
    const exporting = useNodeExport({ nodes, checked, exitSelect });
    return { ...props, ...exporting, keyword, setKeyword, typeFilter, setTypeFilter, selectMode, setSelectMode,
        checked, collapsedGroups, setCollapsedGroups, nodeViewMode, setNodeViewMode, filtered, treeRows, gridRows,
        exitSelect, toggleChecked, allChecked, toggleAll, activateNode };
}

export type CanvasNodesState = ReturnType<typeof useCanvasNodesTab>;
