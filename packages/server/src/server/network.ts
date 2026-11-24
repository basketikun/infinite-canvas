import type { Express } from "express";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import axios from "axios";

const requestHeaders = new Set(["accept", "accept-language", "authorization", "content-type", "depth", "range", "if-none-match", "if-modified-since", "if-match", "if-unmodified-since", "x-amz-date", "x-amz-content-sha256", "x-amz-security-token"]);
const responseHeaders = ["content-type", "content-range", "accept-ranges", "etag", "last-modified"];
const failure = { error: { code: "NETWORK_REQUEST_FAILED", message: "请求未完成，请检查目标地址、登录信息或网络连接后重试。" } };

export function mountNetwork(app: Express) {
    app.all(["/api/network", "/api/network/sync"], async (req, res) => {
        const scoped = /^\/api\/network\/sync\/?$/i.test(req.path);
        if (scoped) res.setHeader("x-canvas-sync-proxy", "1");
        if (typeof req.query.url !== "string" || !URL.canParse(req.query.url)) return void res.status(400).json(failure);
        const target = new URL(req.query.url);
        if (!["http:", "https:"].includes(target.protocol) || target.username || target.password || target.origin === `http://${req.headers.host}`) return void res.status(400).json(failure);
        const controller = new AbortController();
        req.on("aborted", () => controller.abort());
        res.on("close", () => { if (!res.writableEnded) controller.abort(); });
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(req.headers)) {
            if ((requestHeaders.has(name) || scoped && name === "cache-control") && typeof value === "string") headers[name] = value;
        }
        try {
            const upstream = await axios.request<Readable>({
                url: target.href, method: req.method, headers,
                ...(scoped && { maxRedirects: 0 }),
                data: req.headers["content-length"] || req.headers["transfer-encoding"] ? req : undefined,
                responseType: "stream", validateStatus: () => true, signal: controller.signal,
            });
            res.status(upstream.status);
            res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
            if (upstream.status >= 400) {
                upstream.data.destroy();
                return void res.json(failure);
            }
            for (const name of responseHeaders) {
                const value = upstream.headers[name];
                if (typeof value === "string") res.setHeader(name, value);
            }
            await pipeline(upstream.data, res, { signal: controller.signal });
        } catch {
            if (controller.signal.aborted) return;
            if (res.headersSent) res.destroy();
            else res.status(502).json(failure);
        }
    });
}
