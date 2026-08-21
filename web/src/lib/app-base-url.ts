const embeddedBaseUrl = "/dsh-freecanvas/";

const embedded = typeof window !== "undefined" && (window.location.pathname === "/dsh-freecanvas" || window.location.pathname.startsWith(embeddedBaseUrl));

export const appBaseUrl = embedded ? embeddedBaseUrl : import.meta.env.BASE_URL;

export function appAssetUrl(relativePath: string) {
    return `${appBaseUrl}${relativePath.replace(/^\/+/, "")}`;
}
