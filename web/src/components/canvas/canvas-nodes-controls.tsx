import { Input, Select } from "antd";
import { Download, LayoutGrid, ListChecks, Rows3, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodesState } from "./use-canvas-nodes-tab";

type Props = { state: CanvasNodesState; theme: CanvasTheme };
const NODE_FILTER_VALUES = ["all", CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Text, CanvasNodeType.Audio, CanvasNodeType.Config, CanvasNodeType.Group];

export function CanvasNodesControls({ state, theme }: Props) {
    const { t } = useTranslation();
    const { filtered, selectMode, exitSelect, setSelectMode, typeFilter, setTypeFilter, nodeViewMode, setNodeViewMode, keyword, setKeyword } = state;
    return (
        <>
            <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
                <span className="min-w-0 truncate text-xs font-medium opacity-60">{t("canvas.sidePanel.elements")}</span>
                {filtered.length ? <span className="shrink-0 text-xs opacity-35">{filtered.length}</span> : null}
                <button
                    type="button"
                    onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                    className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                    style={selectMode ? { color: theme.toolbar.activeText, opacity: 1 } : undefined}
                >
                    <ListChecks className="size-3.5" />
                    {selectMode ? t("common.cancel") : t("canvas.sidePanel.select")}
                </button>
                {selectMode ? null : <Select size="small" variant="borderless" className="w-20" value={typeFilter} onChange={setTypeFilter} options={NODE_FILTER_VALUES.map((value) => ({ value, label: value === "all" ? t("common.all") : t(`canvas.sidePanel.filter.${value}`) }))} />}
                <button
                    type="button"
                    onClick={() => setNodeViewMode(nodeViewMode === "grid" ? "list" : "grid")}
                    className="flex shrink-0 items-center rounded-md px-1.5 py-1 opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                    title={nodeViewMode === "grid" ? t("canvas.sidePanel.viewList") : t("canvas.sidePanel.viewGrid")}
                    aria-label={nodeViewMode === "grid" ? t("canvas.sidePanel.viewList") : t("canvas.sidePanel.viewGrid")}
                >
                    {nodeViewMode === "grid" ? <Rows3 className="size-3.5" /> : <LayoutGrid className="size-3.5" />}
                </button>
            </div>
            <div className="px-3 pb-2.5">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder={t("canvas.sidePanel.searchNodes")} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
        </>
    );
}

export function CanvasNodesSelection({ state, theme }: Props) {
    const { t } = useTranslation();
    const { toggleAll, allChecked, checked, handleExport, exporting } = state;
    return (
        <div className="flex items-center gap-2 border-t px-3 py-2.5" style={{ borderColor: theme.toolbar.border }}>
            <button type="button" onClick={toggleAll} className="rounded-md px-2 py-1 text-xs font-medium opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10">
                {allChecked ? t("canvas.sidePanel.clearAll") : t("workbench.selectAll")}
            </button>
            <span className="text-xs opacity-45">{t("canvas.sidePanel.selected", { count: checked.size })}</span>
            <button
                type="button"
                onClick={() => void handleExport()}
                disabled={!checked.size || exporting}
                className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
                style={{ color: theme.node.text }}
            >
                <Download className="size-3.5" />
                {t("canvas.exportSelected")}
            </button>
        </div>
    );
}
