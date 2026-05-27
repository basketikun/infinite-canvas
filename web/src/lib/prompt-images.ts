const promptImageRoute = "/api/prompt-images/";
const promptImageUrlPattern = /https?:\/\/[^\s"'<>）)]+/g;

export function toPromptImageServerUrl(source: string) {
    source = source.trim();
    if (!source || isPromptImageServerUrl(source) || source.startsWith("data:") || source.startsWith("blob:")) return source;
    const normalized = normalizeGitHubBlobImageUrl(source);
    if (!isRemotePromptImageUrl(normalized)) return source;
    return `${promptImageRoute}${base64UrlEncode(normalized)}`;
}

export function rewritePromptImageLinks(value: string) {
    return value.replace(promptImageUrlPattern, toPromptImageServerUrl);
}

function isPromptImageServerUrl(value: string) {
    if (value.startsWith(promptImageRoute)) return true;
    try {
        return new URL(value, "http://local").pathname.startsWith(promptImageRoute);
    } catch {
        return false;
    }
}

function isRemotePromptImageUrl(source: string) {
    try {
        const url = new URL(source);
        if (url.protocol !== "http:" && url.protocol !== "https:") return false;
        const host = url.hostname.toLowerCase();
        return host === "github.com" || host === "raw.githubusercontent.com" || host.endsWith(".githubusercontent.com");
    } catch {
        return false;
    }
}

function normalizeGitHubBlobImageUrl(source: string) {
    try {
        const url = new URL(source);
        if (url.hostname.toLowerCase() !== "github.com") return source;
        const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
        if (parts.length < 5 || parts[2] !== "blob") return source;
        return `https://raw.githubusercontent.com/${[parts[0], parts[1], parts[3], ...parts.slice(4)].join("/")}`;
    } catch {
        return source;
    }
}

function base64UrlEncode(value: string) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
