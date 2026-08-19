import { readdirSync, readFileSync } from "node:fs";
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Connect, type Plugin } from "vite";

import { parseChangelog } from "./src/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");

// Expose /plugins/index.json with local plugin files from public/plugins.
// The frontend can discover and list them when enabled; development reads the directory live, while builds emit a static registry.
function localPluginsManifest(): Plugin {
    const pluginsDir = resolve(webDir, "public/plugins");
    const listLocalPlugins = () => {
        try {
            return readdirSync(pluginsDir)
                .filter((file) => file.endsWith(".js"))
                .sort()
                .map((file) => `/plugins/${file}`);
        } catch {
            return [];
        }
    };
    return {
        name: "local-plugins-manifest",
        configureServer(server) {
            server.middlewares.use("/plugins/index.json", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(listLocalPlugins()));
            });
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: "plugins/index.json", source: JSON.stringify(listLocalPlugins()) });
        },
    };
}

const AI_PROXY_PREFIX = "/ai-proxy/";
const MAX_PROXY_REDIRECTS = 5;
const PROXY_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const HOP_BY_HOP_HEADERS = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"];

/**
 * Dynamic API proxy for locally served frontends: the browser calls
 * /ai-proxy/?target=<encoded third-party URL> on the same origin, and this
 * middleware forwards the request (headers + body) to the target server-side,
 * streaming the response back. This keeps user-configured channel baseUrls
 * free of browser CORS restrictions without a fixed proxy table.
 */
function aiApiProxy(): Plugin {
    return {
        name: "ai-api-proxy",
        configureServer(server) {
            server.middlewares.use(aiProxyHandler);
        },
        configurePreviewServer(server) {
            server.middlewares.use(aiProxyHandler);
        },
    };
}

const aiProxyHandler: Connect.NextHandleFunction = (req, res, next) => {
    if (!req.url?.startsWith(AI_PROXY_PREFIX)) return next();
    const target = parseProxyTarget(req.url);
    if (!target) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "invalid or missing target" }));
        return;
    }
    forwardProxyRequest(req, res, target, 0);
};

function parseProxyTarget(url: string): URL | null {
    let requestUrl: URL;
    let target: URL;
    try {
        requestUrl = new URL(url, "http://localhost");
        target = new URL(requestUrl.searchParams.get("target") || "");
    } catch {
        return null;
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") return null;
    return target;
}

function forwardProxyRequest(req: IncomingMessage, res: ServerResponse, target: URL, redirects: number) {
    const headers = { ...req.headers };
    for (const name of HOP_BY_HOP_HEADERS) delete headers[name];
    delete headers.host;

    let upstreamRequest;
    try {
        upstreamRequest = (target.protocol === "https:" ? httpsRequest : httpRequest)(
            target,
            { method: req.method, headers },
            (upstreamRes) => {
                const status = upstreamRes.statusCode || 502;
                const location = upstreamRes.headers.location;
                // Follow redirects server-side for GET/HEAD (media downloads and presigned URLs);
                // other methods would require replaying the request body, so pass 3xx through.
                if (location && status >= 300 && status < 400 && redirects < MAX_PROXY_REDIRECTS && (req.method === "GET" || req.method === "HEAD")) {
                    upstreamRes.resume();
                    const nextTarget = parseProxyTarget(`?target=${encodeURIComponent(new URL(location, target).href)}`);
                    if (nextTarget) {
                        forwardProxyRequest(req, res, nextTarget, redirects + 1);
                        return;
                    }
                }
                try {
                    res.writeHead(status, upstreamRes.headers);
                    upstreamRes.pipe(res);
                } catch {
                    res.destroy();
                }
            },
        );
    } catch {
        writeProxyError(res, "failed to reach the target");
        return;
    }

    upstreamRequest.setTimeout(PROXY_IDLE_TIMEOUT_MS, () => upstreamRequest.destroy(new Error("upstream idle timeout")));
    upstreamRequest.on("error", (error) => {
        if (!res.headersSent) writeProxyError(res, error.message);
        else res.destroy();
    });
    req.on("aborted", () => upstreamRequest.destroy());
    req.on("error", () => upstreamRequest.destroy());
    res.on("close", () => {
        if (!res.writableFinished) upstreamRequest.destroy();
    });
    req.pipe(upstreamRequest);
}

function writeProxyError(res: ServerResponse, message: string) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: `api proxy error: ${message}` }));
}

export default defineConfig({
    base: process.env.VITE_BASE || "/",
    plugins: [react(), localPluginsManifest(), aiApiProxy()],
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(localVersion),
        __APP_RELEASES__: JSON.stringify(parseChangelog(localChangelog)),
    },
});
