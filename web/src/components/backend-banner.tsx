import i18n from "@/i18n";
import { useBackendStore } from "@/stores/use-backend-store";

/** 总后台未连接时显示黄色提示横幅。 */
export function BackendBanner() {
    const connected = useBackendStore((s) => s.connected);
    const checking = useBackendStore((s) => s.checking);
    const error = useBackendStore((s) => s.error);

    // 连接中显示 loading 横幅，已连接不显示
    if (checking && !connected) {
        return (
            <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                {i18n.t("backend.connecting")}
            </div>
        );
    }

    // 已连接不显示
    if (connected) return null;

    // 未连接时显示不可写提示
    return (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
            <span>{i18n.t("backend.disconnected")}</span>
            {error && <span className="text-xs opacity-70">({error})</span>}
        </div>
    );
}
