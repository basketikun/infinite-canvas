import type { NetworkAdapter } from "./runtime";

export function createLocalNetwork(origin: string): NetworkAdapter {
    return {
        kind: "server",
        url(url, mode) {
            if (!/^https?:\/\//i.test(url) || new URL(url).origin === origin) return url;
            return `/api/network${mode === "sync" ? "/sync" : ""}?url=${encodeURIComponent(url)}`;
        },
    };
}
