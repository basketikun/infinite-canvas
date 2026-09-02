import { create } from "zustand";
import { backendHealth, discoverBackendToken, getBackendToken, getBackendUrl, setBackendConnection } from "@/services/backend-api";

type BackendStore = {
    url: string;
    token: string;
    connected: boolean;
    checking: boolean;
    error: string;
    setConnection: (url: string, token?: string) => void;
    checkConnection: () => Promise<void>;
    reset: () => void;
};

/** 总后台连接状态 store。自动在启动时检测连通性。 */
export const useBackendStore = create<BackendStore>((set, get) => ({
    url: getBackendUrl(),
    token: getBackendToken(),
    connected: false,
    checking: true,
    error: "",

    setConnection: (url, token) => {
        const cleanUrl = url.replace(/\/$/, "");
        setBackendConnection(cleanUrl, token || get().token);
        set({ url: cleanUrl, token: token || get().token, error: "" });
        void get().checkConnection();
    },

    checkConnection: async () => {
        set({ checking: true });
        const wasConnected = get().connected;
        const health = await backendHealth();
        if (!health.ok) {
            set({ connected: false, checking: false, error: `无法连接总后台 ${getBackendUrl()}` });
            return;
        }
        // 后端 /config 是 token 权威来源，连接时以后端为准刷新，避免缓存旧 token 导致 401。
        const discovered = await discoverBackendToken();
        if (discovered.ok && discovered.token && discovered.token !== get().token) {
            setBackendConnection(getBackendUrl(), discovered.token);
            set({ token: discovered.token, checking: true });
            await get().checkConnection();
            return;
        }
        if (!wasConnected) {
            const { migrateIndexDBToBackend } = await import("@/lib/backend-migration");
            const migration = await migrateIndexDBToBackend();
            if (!migration.success) {
                const error = `Backend 数据迁移失败：${migration.error || "未知错误"}`;
                console.warn("[backend-migration]", error);
                set({ connected: false, checking: false, error });
                return;
            }
        }
        set({ connected: true, checking: false, error: "" });
        if (!wasConnected) window.dispatchEvent(new Event("backend-connected"));
    },

    reset: () => set({ connected: false, checking: false, error: "" }),
}));

/** 启动时自动检测总后台连接。首次连接时先完成一次性 IndexedDB 迁移。 */
export function initBackendConnection() {
    if (typeof window === "undefined") return;
    void useBackendStore.getState().checkConnection();
    // 周期性重连检测
    setInterval(() => {
        if (!useBackendStore.getState().connected) {
            void useBackendStore.getState().checkConnection();
        }
    }, 10_000);
}
