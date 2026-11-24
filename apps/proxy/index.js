#!/usr/bin/env node
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { Readable } from "node:stream";

const pkg = createRequire(import.meta.url)("./package.json");

const CORS_HEADERS = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "*",
    "access-control-allow-headers": "*",
    "access-control-expose-headers": "*",
    "access-control-max-age": "86400",
};

/** Headers that describe the hop to this proxy rather than the upstream request. */
const SKIP_REQUEST_HEADERS = new Set(["host", "connection", "content-length", "accept-encoding", "origin", "referer", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site"]);
/** fetch() already decoded and re-framed the body, so the upstream framing headers no longer apply. */
const SKIP_RESPONSE_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]);

function readArg(args, name, fallback) {
    const index = args.indexOf(`--${name}`);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

function readTarget(url, scoped) {
    const raw = url.slice(1);
    if (scoped) {
        try {
            const target = decodeURIComponent(url.slice("/_sync/".length));
            return /^https?:\/\/[^/]/i.test(target) ? target : "";
        } catch { return ""; }
    }
    // decodeURI undoes the escaping browsers apply to the path while keeping intentional encodeURIComponent escapes.
    let target = raw;
    try {
        target = decodeURI(raw);
    } catch {
        // Malformed escape sequence: forward the raw form instead of failing.
    }
    // Some clients collapse the "//" in the embedded target URL, so restore it before parsing.
    target = target.replace(/^(https?:)\/*/i, "$1//");
    return /^https?:\/\/[^/]/i.test(target) ? target : "";
}

function requestHeaders(req, scoped) {
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
        if (SKIP_REQUEST_HEADERS.has(key) || value === undefined || (scoped && ["cookie", "cookie2", "proxy-authorization", "x-canvas-token", "x-canvas-client-id", "x-canvas-project-id", "x-canvas-sync-proxy"].includes(key))) continue;
        headers[key] = Array.isArray(value) ? value.join(", ") : value;
    }
    return headers;
}

function responseHeaders(upstream, scoped) {
    const headers = { ...CORS_HEADERS };
    upstream.headers.forEach((value, key) => {
        if (SKIP_RESPONSE_HEADERS.has(key) || key.startsWith("access-control-") || key === "x-canvas-sync-proxy") return;
        if (scoped && (key === "set-cookie" || key === "set-cookie2")) return;
        headers[key] = value;
    });
    return headers;
}

function sendJson(res, status, payload) {
    res.writeHead(status, { ...CORS_HEADERS, "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
}

function logForward(method, target, outcome, startedAt) {
    console.log(`${new Date().toLocaleTimeString()} ${method} ${target} -> ${outcome} ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

async function forward(req, res, target, scoped) {
    const controller = new AbortController();
    if (scoped) {
        req.once("aborted", () => controller.abort());
        res.once("close", () => { if (!res.writableEnded) controller.abort(); });
    }
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const upstream = await fetch(target, { method: req.method, headers: requestHeaders(req, scoped), body, redirect: scoped ? "error" : "follow", signal: controller.signal });
    // Logged as soon as the status line arrives, so a long SSE stream still shows up immediately.
    res.writeHead(upstream.status, responseHeaders(upstream, scoped));
    if (!upstream.body) {
        res.end();
        return upstream.status;
    }
    // Streamed so that SSE responses (text generation) reach the browser chunk by chunk.
    const stream = Readable.fromWeb(upstream.body);
    stream.once("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
    return upstream.status;
}

export function createProxyServer() {
    return createServer((req, res) => {
        const scoped = req.url?.startsWith("/_sync/");
        if (scoped) res.setHeader("x-canvas-sync-proxy", "1");
        if (req.method === "OPTIONS" && (!scoped || req.headers["access-control-request-method"])) {
            const requested = req.headers["access-control-request-headers"];
            res.writeHead(204, scoped && requested ? { ...CORS_HEADERS, "access-control-allow-headers": requested, vary: "Access-Control-Request-Headers" } : CORS_HEADERS);
            res.end();
            return;
        }
        const target = readTarget(req.url || "/", scoped);
        if (!target) {
            if (scoped) return sendJson(res, 400, { error: "同步地址无效。" });
            sendJson(res, 200, { app: "infinite-canvas", proxy: pkg.name, version: pkg.version, usage: "/<full-target-url>" });
            return;
        }
        const startedAt = Date.now();
        const method = req.method || "GET";
        forward(req, res, target, scoped)
            .then((status) => logForward(method, target, status, startedAt))
            .catch((error) => {
                const reason = error instanceof Error ? error.message : String(error);
                logForward(method, target, `failed (${reason})`, startedAt);
                if (res.headersSent) {
                    res.destroy();
                    return;
                }
                sendJson(res, 502, { error: scoped ? "同步请求未完成，请检查连接后重试。" : reason });
            });
    });
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
    console.log(`${pkg.name} v${pkg.version}\n\nUsage: npx ${pkg.name}@latest [--port 23210] [--host 127.0.0.1]\n\nForwards http://<host>:<port>/<full-target-url> to <full-target-url> with permissive CORS headers.`);
    process.exit(0);
}

const port = Number(readArg(args, "port", process.env.PORT || 23210));
const host = readArg(args, "host", process.env.HOST || "127.0.0.1");

const server = createProxyServer();
server.listen(port, host, () => {
    const address = `http://${host}:${server.address().port}`;
    console.log(`${pkg.name} v${pkg.version} listening on ${address}`);
    console.log(`Fill this address into Infinite Canvas → 配置 → 本地代理: ${address}`);
});
