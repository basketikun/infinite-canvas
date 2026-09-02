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
        if (!get().token) {
            const discovered = await discoverBackendToken();
            if (discovered.ok && discovered.token) {
                setBackendConnection(getBackendUrl(), discovered.token);
                set({ token: discovered.token });
            }
        }
        const health = await backendHealth();
        if (health.ok) {
            set({ connected: true, checking: false, error: "" });
            if (!wasConnected) window.dispatchEvent(new Event("backend-connected"));
        } else {
            set({ connected: false, checking: false, error: `无法连接总后台 ${getBackendUrl()}` });
        }
    },

    reset: () => set({ connected: false, checking: false, error: "" }),
}));

/** 启动时自动检测总后台连接。连接成功后触发 IndexedDB 迁移。 */
export function initBackendConnection() {
    if (typeof window === "undefined") return;
    void useBackendStore.getState().checkConnection();
    // 周期性重连检测
    setInterval(() => {
        if (!useBackendStore.getState().connected) {
            void useBackendStore.getState().checkConnection();
        }
    }, 10_000);
    // 连接成功后触发一次性 IndexedDB 迁移
    useBackendStore.subscribe((state, prev) => {
        if (state.connected && !prev.connected) {
            import("@/lib/backend-migration").then(({ migrateIndexDBToBackend }) => {
                void migrateIndexDBToBackend().then((result) => {
                    if (result.success) {
                        console.info("[backend-migration] 迁移完成", result);
                    } else {
                        console.warn("[backend-migration] 迁移失败", result.error);
                    }
                });
            });
        }
    });
}
