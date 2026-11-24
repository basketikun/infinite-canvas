import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AgentChatItem } from "./use-agent-chat-store";

import type { CanvasAgentOp } from "@infinite-canvas/shared/canvas/tools/types";
import type { CanvasAgentSnapshot } from "@workbench/lib/canvas/canvas-agent-ops";

export type AgentCanvasContext = { signal: AbortSignal; snapshot: CanvasAgentSnapshot; applyOps: (ops?: CanvasAgentOp[]) => Promise<CanvasAgentSnapshot> };
type AgentStore = {
    width: number;
    panelOpen: boolean;
    panelClosing: boolean;
    activeTab: "chat" | "history" | "mcp";
    canvasContext: AgentCanvasContext | null;
    runningThreadId: string;
    controller: AbortController | null;
    liveItems: AgentChatItem[];
    compacting: boolean;
    setAgentState: (patch: Partial<Pick<AgentStore, "width" | "activeTab" | "runningThreadId" | "controller" | "liveItems" | "compacting">>) => void;
    setCanvasContext: (context: AgentCanvasContext | null) => void;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
};

export const CANVAS_AGENT_PANEL_MOTION_MS = 500;
export const useAgentStore = create<AgentStore>()(persist((set, get) => ({
    width: 440,
    panelOpen: false,
    panelClosing: false,
    activeTab: "chat",
    canvasContext: null,
    runningThreadId: "",
    controller: null,
    liveItems: [],
    compacting: false,
    setAgentState: (patch) => set(patch),
    setCanvasContext: (canvasContext) => set({ canvasContext }),
    openPanel: () => set({ panelOpen: true, panelClosing: false }),
    closePanel: () => {
        set({ panelOpen: false, panelClosing: true });
        setTimeout(() => { if (get().panelClosing) set({ panelClosing: false }); }, CANVAS_AGENT_PANEL_MOTION_MS);
    },
    togglePanel: () => get().panelOpen ? get().closePanel() : get().openPanel(),
}), { name: "infinite-canvas:agent_panel", partialize: ({ width }) => ({ width }) }));
