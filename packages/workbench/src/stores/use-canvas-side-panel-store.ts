import { create } from "zustand";
import { persist } from "zustand/middleware";

export const CANVAS_SIDE_PANEL_MOTION_MS = 500;
export const CANVAS_SIDE_PANEL_MIN_WIDTH = 220;
export const CANVAS_SIDE_PANEL_MAX_WIDTH = 480;
export const CANVAS_SIDE_PANEL_DEFAULT_WIDTH = 280;

export type CanvasNodeViewMode = "list" | "grid";

type CanvasSidePanelStore = {
    selectedTab: string;
    width: number;
    panelOpen: boolean;
    panelMounted: boolean;
    panelClosing: boolean;
    nodeViewMode: CanvasNodeViewMode;
    setWidth: (width: number) => void;
    setNodeViewMode: (mode: CanvasNodeViewMode) => void;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
};

export const useCanvasSidePanelStore = create<CanvasSidePanelStore>()(persist((set, get) => ({
    selectedTab: "builtin:canvas",
    width: CANVAS_SIDE_PANEL_DEFAULT_WIDTH,
    panelOpen: false,
    panelMounted: false,
    panelClosing: false,
    nodeViewMode: "list",
    setWidth: (width) => set({ width }),
    setNodeViewMode: (nodeViewMode) => set({ nodeViewMode }),
    openPanel: () => set({ panelOpen: true, panelMounted: true, panelClosing: false }),
    closePanel: () => {
        if (!get().panelMounted || get().panelClosing) return;
        set({ panelOpen: false, panelClosing: true });
        setTimeout(() => {
            if (get().panelClosing) set({ panelMounted: false, panelClosing: false });
        }, CANVAS_SIDE_PANEL_MOTION_MS);
    },
    togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),
}), {
    name: "infinite-canvas:canvas_side_panel_v2",
    partialize: ({ width, nodeViewMode }) => ({ width, nodeViewMode }),
}));
