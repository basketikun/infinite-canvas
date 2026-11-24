import { normalizeLocalProxyUrl, useConfigStore } from "@workbench/stores/use-config-store";
import type { NetworkAdapter } from "./runtime";

export function createBrowserNetwork(): NetworkAdapter {
    return {
        kind: "browser",
        url(url, mode) {
            const { proxyEnabled, proxyUrl } = useConfigStore.getState().config;
            if (!proxyEnabled || !/^https?:\/\//i.test(url)) return url;
            const base = normalizeLocalProxyUrl(proxyUrl);
            if (!base || url.startsWith(`${base}/`)) return url;
            return mode === "sync" ? `${base}/_sync/${encodeURIComponent(url)}` : `${base}/${url}`;
        },
    };
}
