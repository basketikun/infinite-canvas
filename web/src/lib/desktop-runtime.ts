import axios from "axios";

const browserFetch = globalThis.fetch.bind(globalThis);
let initialized = false;

export function isDesktopApp() {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Route desktop HTTP(S) traffic through Tauri so local HTTP providers are not blocked by WebView CORS or mixed-content rules. */
export async function initializeDesktopRuntime() {
    if (!isDesktopApp() || initialized) return;
    initialized = true;
    localStorage.removeItem("canvas-agent-url");
    localStorage.removeItem("canvas-agent-token");
    const { fetch: nativeFetch } = await import("@tauri-apps/plugin-http");
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return /^https?:\/\//i.test(rawUrl) ? nativeFetch(input, init) : browserFetch(input, init);
    }) as typeof globalThis.fetch;
    axios.defaults.adapter = "fetch";
}
