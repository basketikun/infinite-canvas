import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AI_PROXY_PATH, createAiProxyHandler } from "./ai-proxy.mjs";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = resolve(rootDir, "dist");
const indexFile = resolve(distDir, "index.html");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const proxyHandler = createAiProxyHandler();

const contentTypes = new Map([
    [".css", "text/css; charset=utf-8"],
    [".gif", "image/gif"],
    [".html", "text/html; charset=utf-8"],
    [".ico", "image/x-icon"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".js", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".png", "image/png"],
    [".svg", "image/svg+xml"],
    [".txt", "text/plain; charset=utf-8"],
    [".webp", "image/webp"],
    [".woff", "font/woff"],
    [".woff2", "font/woff2"],
]);

const server = createServer(async (req, res) => {
    try {
        if (req.url?.startsWith(AI_PROXY_PATH)) {
            await proxyHandler(req, res);
            return;
        }
        await serveStatic(req, res);
    } catch (error) {
        if (res.headersSent) {
            res.destroy(error instanceof Error ? error : undefined);
            return;
        }
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(error instanceof Error ? error.message : "Internal server error");
    }
});

server.listen(port, host, () => {
    console.log(`Infinite Canvas server listening on http://${host}:${port}`);
});

async function serveStatic(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.statusCode = 405;
        res.end("Method not allowed");
        return;
    }

    const url = new URL(req.url || "/", "http://infinite-canvas.local");
    const pathname = decodeURIComponent(url.pathname);
    const candidate = resolve(distDir, `.${pathname}`);
    const safeCandidate = candidate.startsWith(distDir) ? candidate : indexFile;
    const file = await pickStaticFile(safeCandidate);

    res.statusCode = 200;
    res.setHeader("Content-Type", contentTypes.get(extname(file).toLowerCase()) || "application/octet-stream");
    if (req.method === "HEAD") {
        res.end();
        return;
    }
    createReadStream(file).pipe(res);
}

async function pickStaticFile(candidate) {
    try {
        const info = await stat(candidate);
        if (info.isFile()) return candidate;
        if (info.isDirectory()) {
            const nestedIndex = join(candidate, "index.html");
            if ((await stat(nestedIndex)).isFile()) return nestedIndex;
        }
    } catch {
        return indexFile;
    }
    return indexFile;
}
