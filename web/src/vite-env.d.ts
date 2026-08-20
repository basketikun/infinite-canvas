/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_RELEASES__: import("@/lib/release").ReleaseInfo[];

interface ImportMetaEnv {
    // Force-enable/disable the local /ai-proxy/ third-party API proxy ("true" | "false"); defaults to localhost + VITE_API_PROXY_HOSTS.
    readonly VITE_API_PROXY?: string;
    // Comma-separated additional hosts (LAN IPs, custom domains) that should use the /ai-proxy/ proxy.
    readonly VITE_API_PROXY_HOSTS?: string;
    // Comma-separated local development plugin URLs, refetched on every startup without caching or persistence.
    readonly VITE_DEV_PLUGINS?: string;
    // Optional build-time analytics configuration, with one independent variable per provider.
    // GA4 measurement ID (G-XXXX)
    readonly VITE_ANALYTICS_GA4_ID?: string;
    // Baidu Analytics site ID
    readonly VITE_ANALYTICS_BAIDU_ID?: string;
}
