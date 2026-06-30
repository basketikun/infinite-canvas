const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal"]);
const BLOCKED_IPV4_EXACT = new Set(["0.0.0.0", "127.0.0.1", "169.254.169.254"]);

export type WebdavTargetValidation = { ok: true; url: URL } | { ok: false; reason: string };

export function validateWebdavTarget(target: string): WebdavTargetValidation {
    let url: URL;
    try {
        url = new URL(target);
    } catch {
        return { ok: false, reason: "Invalid x-webdav-target" };
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { ok: false, reason: "Unsupported WebDAV target" };
    }

    if (url.username || url.password) {
        return { ok: false, reason: "Unsupported WebDAV target credentials" };
    }

    const hostname = normalizeHostname(url.hostname);
    if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith(".localhost")) {
        return { ok: false, reason: "Blocked WebDAV target host" };
    }

    if (isBlockedIpv4(hostname) || isBlockedIpv6(hostname)) {
        return { ok: false, reason: "Blocked WebDAV target address" };
    }

    return { ok: true, url };
}

export function sanitizeWebdavTargetForLog(url: URL) {
    return `${url.protocol}//${url.host}${url.pathname}`;
}

function normalizeHostname(hostname: string) {
    return hostname.toLowerCase().replace(/\.$/, "");
}

function isBlockedIpv4(hostname: string) {
    if (BLOCKED_IPV4_EXACT.has(hostname)) return true;
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return false;

    const parts = hostname.split(".").map((part) => Number(part));
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;

    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

function isBlockedIpv6(hostname: string) {
    const value = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!value.includes(":")) return false;
    if (value === "::" || value === "::1" || value.startsWith("::ffff:")) return true;

    const firstSegment = Number.parseInt(value.split(":")[0] || "0", 16);
    if (!Number.isInteger(firstSegment)) return false;
    return (firstSegment & 0xfe00) === 0xfc00 || (firstSegment & 0xffc0) === 0xfe80;
}
