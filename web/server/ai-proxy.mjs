import { lookup } from "node:dns/promises";
import { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

export const AI_PROXY_PATH = "/api/ai-proxy";
export const AI_PROXY_TARGET_HEADER = "x-ai-proxy-target-base-url";

const HOP_BY_HOP_HEADERS = new Set([
    "connection",
    "content-length",
    "expect",
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
]);

const REQUEST_HEADERS_TO_DROP = new Set([
    ...HOP_BY_HOP_HEADERS,
    AI_PROXY_TARGET_HEADER,
    "accept-encoding",
    "origin",
    "referer",
]);

const RESPONSE_HEADERS_TO_DROP = new Set([
    ...HOP_BY_HOP_HEADERS,
    "content-encoding",
    "content-length",
]);

const ALLOWED_METHODS = new Set(["GET", "POST", "OPTIONS"]);

export function createAiProxyHandler(options = {}) {
    const proxyBasePath = options.proxyBasePath || AI_PROXY_PATH;
    const allowLocal = options.allowLocal ?? process.env.AI_PROXY_ALLOW_LOCAL === "true";

    return async function handleAiProxyRequest(req, res) {
        setCorsHeaders(req, res);

        if (req.method === "OPTIONS") {
            res.statusCode = 204;
            res.end();
            return;
        }

        if (!ALLOWED_METHODS.has(req.method || "")) {
            sendProxyJson(res, 405, { error: "Method not allowed" });
            return;
        }

        const targetBaseUrl = readHeader(req.headers, AI_PROXY_TARGET_HEADER);
        if (!targetBaseUrl) {
            sendProxyJson(res, 400, { error: `Missing ${AI_PROXY_TARGET_HEADER}` });
            return;
        }

        let targetUrl;
        try {
            const requestUrl = new URL(req.url || proxyBasePath, "http://infinite-canvas.local");
            targetUrl = resolveProxyTargetUrl(targetBaseUrl, requestUrl.pathname, proxyBasePath, requestUrl.search);
            await validateTargetUrl(targetUrl, { allowLocal });
        } catch (error) {
            sendProxyJson(res, 400, { error: error instanceof Error ? error.message : "Invalid proxy target" });
            return;
        }

        try {
            const upstream = await fetch(targetUrl, {
                method: req.method,
                headers: createForwardHeaders(req.headers),
                body: req.method === "GET" ? undefined : req,
                duplex: req.method === "GET" ? undefined : "half",
                redirect: "manual",
            });

            res.statusCode = upstream.status;
            res.statusMessage = upstream.statusText;
            copyResponseHeaders(upstream.headers, res);
            setCorsHeaders(req, res);

            if (!upstream.body) {
                res.end();
                return;
            }

            Readable.fromWeb(upstream.body).pipe(res);
        } catch (error) {
            if (res.headersSent) {
                res.destroy(error instanceof Error ? error : undefined);
                return;
            }
            sendProxyJson(res, 502, { error: error instanceof Error ? error.message : "Proxy request failed" });
        }
    };
}

export function resolveProxyTargetUrl(targetBaseUrl, requestPath, proxyBasePath = AI_PROXY_PATH, query = "") {
    const base = new URL(String(targetBaseUrl).trim());
    const normalizedProxyBase = proxyBasePath.replace(/\/+$/, "");
    const pathname = requestPath.split("?")[0];
    if (pathname !== normalizedProxyBase && !pathname.startsWith(`${normalizedProxyBase}/`)) {
        throw new Error("Proxy path does not match configured base path");
    }

    const proxyPath = pathname.slice(normalizedProxyBase.length).replace(/^\/+/, "");
    base.pathname = joinUrlPath(base.pathname, proxyPath);
    base.search = normalizeQuery(query || requestPath.split("?")[1] || "");
    base.hash = "";
    return base;
}

export async function validateTargetUrl(targetUrl, options = {}) {
    if (!["http:", "https:"].includes(targetUrl.protocol)) {
        throw new Error("Proxy target protocol must be http or https");
    }
    if (options.allowLocal) return;
    if (isLocalHostname(targetUrl.hostname)) {
        throw new Error("Proxy target cannot be private or local unless AI_PROXY_ALLOW_LOCAL=true");
    }

    const records = await lookup(targetUrl.hostname, { all: true, verbatim: true });
    if (records.some((record) => isPrivateAddress(record.address))) {
        throw new Error("Proxy target cannot resolve to a private or local address unless AI_PROXY_ALLOW_LOCAL=true");
    }
}

export function createForwardHeaders(headers) {
    const forwarded = {};
    for (const [rawName, rawValue] of Object.entries(headers)) {
        if (rawValue === undefined) continue;
        const name = rawName.toLowerCase();
        if (REQUEST_HEADERS_TO_DROP.has(name) || name.startsWith("sec-") || name.startsWith("proxy-")) continue;
        forwarded[name] = Array.isArray(rawValue) ? rawValue.join(", ") : String(rawValue);
    }
    return forwarded;
}

function copyResponseHeaders(headers, res) {
    headers.forEach((value, rawName) => {
        const name = rawName.toLowerCase();
        if (RESPONSE_HEADERS_TO_DROP.has(name)) return;
        res.setHeader(name, value);
    });
}

function setCorsHeaders(req, res) {
    res.setHeader("Access-Control-Allow-Origin", readHeader(req.headers, "origin") || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", `authorization,content-type,accept,${AI_PROXY_TARGET_HEADER}`);
    res.setHeader("Vary", "Origin");
}

function sendProxyJson(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
}

function readHeader(headers, name) {
    const value = headers[name.toLowerCase()];
    if (Array.isArray(value)) return value[0] || "";
    return typeof value === "string" ? value : "";
}

function joinUrlPath(basePath, proxyPath) {
    const left = (basePath || "/").replace(/\/+$/, "");
    const right = proxyPath.replace(/^\/+/, "");
    if (!right) return left || "/";
    return `${left || ""}/${right}`;
}

function normalizeQuery(query) {
    if (!query) return "";
    return query.startsWith("?") ? query : `?${query}`;
}

function isLocalHostname(hostname) {
    const value = hostname.toLowerCase();
    return value === "localhost" || value.endsWith(".localhost") || isPrivateAddress(value);
}

function isPrivateAddress(address) {
    if (address === "::1" || address === "0:0:0:0:0:0:0:1") return true;
    if (address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) return true;

    const parts = address.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
    const [a, b] = parts;
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 0;
}
