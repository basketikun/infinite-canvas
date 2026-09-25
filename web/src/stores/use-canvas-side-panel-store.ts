import { create } from "zustand";

export const CANVAS_SIDE_PANEL_MOTION_MS = 500;
export const CANVAS_SIDE_PANEL_MIN_WIDTH = 220;
export const CANVAS_SIDE_PANEL_MAX_WIDTH = 480;
export const CANVAS_SIDE_PANEL_DEFAULT_WIDTH = 280;

const WIDTH_KEY = "canvas-side-panel-width";
const OPEN_KEY = "canvas-side-panel-open";
const NODE_VIEW_KEY = "canvas-side-panel-node-view";

export type CanvasNodeViewMode = "list" | "grid";

function initialWidth() {
    if (typeof window === "undefined") return CANVAS_SIDE_PANEL_DEFAULT_WIDTH;
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    if (!stored) return CANVAS_SIDE_PANEL_DEFAULT_WIDTH;
    return Math.min(CANVAS_SIDE_PANEL_MAX_WIDTH, Math.max(CANVAS_SIDE_PANEL_MIN_WIDTH, stored));
}

function initialOpen() {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(OPEN_KEY) !== "0";
}

function initialNodeView(): CanvasNodeViewMode {
    if (typeof window === "undefined") return "list";
    return localStorage.getItem(NODE_VIEW_KEY) === "grid" ? "grid" : "list";
}

type CanvasSidePanelStore = {
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

export const useCanvasSidePanelStore = create<CanvasSidePanelStore>((set, get) => ({
    width: initialWidth(),
    panelOpen: initialOpen(),
    panelMounted: initialOpen(),
    panelClosing: false,
    nodeViewMode: initialNodeView(),
    setWidth: (width) => set({ width }),
    setNodeViewMode: (mode) => {
        if (typeof window !== "undefined") localStorage.setItem(NODE_VIEW_KEY, mode);
        set({ nodeViewMode: mode });
    },
    openPanel: () => {
        if (typeof window !== "undefined") localStorage.setItem(OPEN_KEY, "1");
        set({ panelOpen: true, panelMounted: true, panelClosing: false });
    },
    closePanel: () => {
        if (!get().panelMounted || get().panelClosing) return;
        if (typeof window !== "undefined") localStorage.setItem(OPEN_KEY, "0");
        set({ panelOpen: false, panelClosing: true });
        setTimeout(() => {
            if (get().panelClosing) set({ panelMounted: false, panelClosing: false });
        }, CANVAS_SIDE_PANEL_MOTION_MS);
    },
    togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),
}));
