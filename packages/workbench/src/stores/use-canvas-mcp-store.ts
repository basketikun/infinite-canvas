import { create } from "zustand";
import { storage } from "@workbench/services/storage/runtime";

export const canvasMcpClientId = crypto.randomUUID();

/** 只有本地服务提供的网页能被外部 Agent 操作，连接同源服务。 */
type CanvasMcpStore = {
    enabled: boolean;
    connected: boolean;
    error: string;
    setState: (patch: Partial<Pick<CanvasMcpStore, "connected" | "error">>) => void;
    connect: () => void;
    disconnect: () => void;
};

export const useCanvasMcpStore = create<CanvasMcpStore>()((set) => ({
    enabled: storage.kind === "server",
    connected: false,
    error: "",
    setState: (patch) => set(patch),
    connect: () => set({ enabled: true, connected: false, error: "" }),
    disconnect: () => set({ enabled: false, connected: false, error: "" }),
}));
