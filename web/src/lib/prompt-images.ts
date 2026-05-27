const promptImageRoute = "/api/prompt-images/";
const promptImageMarkdownPattern = /!\[[^\]]*]\(([^)]*)\)/g;
const promptImageHtmlDoubleSrcPattern = /(<img[^>]*\bsrc=")([^"]+)(")/gi;
const promptImageHtmlSingleSrcPattern = /(<img[^>]*\bsrc=')([^']+)(')/gi;

export function toPromptImageServerUrl(source: string) {
    source = normalizePromptImageSource(source);
    if (!source || isPromptImageServerUrl(source) || source.startsWith("data:") || source.startsWith("blob:")) return source;
    const normalized = normalizeGitHubBlobImageUrl(source);
    if (!isRemotePromptImageUrl(normalized)) return source;
    return `${promptImageRoute}${base64UrlEncode(normalized)}`;
}

export function rewritePromptImageLinks(value: string) {
    return value
        .replace(promptImageMarkdownPattern, (match, target: string) => match.replace(target, rewritePromptImageMarkdownTarget(target)))
        .replace(promptImageHtmlDoubleSrcPattern, (_, prefix: string, src: string, suffix: string) => `${prefix}${toPromptImageServerUrl(src)}${suffix}`)
        .replace(promptImageHtmlSingleSrcPattern, (_, prefix: string, src: string, suffix: string) => `${prefix}${toPromptImageServerUrl(src)}${suffix}`);
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
        const url = new URL(normalizePromptImageSource(source));
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

function normalizePromptImageSource(source: string) {
    return source.startsWith("//") ? `https:${source}` : source;
}

function rewritePromptImageMarkdownTarget(target: string) {
    const trimmed = target.trim();
    if (!trimmed) return target;
    const { url, suffix, angled } = splitPromptImageTarget(trimmed);
    const rewritten = toPromptImageServerUrl(url);
    if (rewritten === url) return target;
    return angled ? `<${rewritten}>${suffix}` : `${rewritten}${suffix}`;
}

function splitPromptImageTarget(value: string) {
    if (value.startsWith("<")) {
        const end = value.indexOf(">");
        if (end > 0) return { url: value.slice(1, end).trim(), suffix: value.slice(end + 1), angled: true };
    }
    const index = value.search(/\s/);
    if (index < 0) return { url: value, suffix: "", angled: false };
    return { url: value.slice(0, index).trim(), suffix: value.slice(index), angled: false };
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
