/**
 * Local API proxy: rewrites cross-origin third-party AI API URLs to the local
 * dev/preview server, which forwards the request server-side (see the
 * "ai-api-proxy" plugin in vite.config.ts). This avoids browser CORS blocks
 * when a user-configurable channel baseUrl points at a third-party service.
 *
 * The proxy is only active while serving locally (localhost / 127.0.0.1) or on
 * hosts listed in VITE_API_PROXY_HOSTS (e.g. a LAN IP served to co-workers),
 * where the Vite middleware exists. Deployed environments keep calling the
 * third-party APIs directly. Set VITE_API_PROXY=true|false to force the
 * behavior when self-hosting.
 */

const AI_PROXY_PATH = "/ai-proxy/";
const LOCAL_PROXY_HOSTS = ["localhost", "127.0.0.1", "::1", "0.0.0.0"];

export function isApiProxyEnabled(): boolean {
    const override = import.meta.env.VITE_API_PROXY;
    if (override === "true") return true;
    if (override === "false") return false;
    const host = window.location.hostname;
    if (LOCAL_PROXY_HOSTS.includes(host)) return true;
    // Extra hosts (LAN IPs, custom domains) configured via VITE_API_PROXY_HOSTS="ip1,ip2".
    const extraHosts = (import.meta.env.VITE_API_PROXY_HOSTS || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    return extraHosts.includes(host);
}

/**
 * Rewrite an absolute cross-origin URL into a same-origin proxy request.
 * Relative URLs, data: URLs and same-origin URLs pass through unchanged.
 */
export function proxyApiUrl(url: string): string {
    if (!isApiProxyEnabled()) return url;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return url;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return url;
    if (parsed.origin === window.location.origin) return url;
    return `${AI_PROXY_PATH}?target=${encodeURIComponent(parsed.href)}`;
}
