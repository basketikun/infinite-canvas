import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

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

function arkDevProxy(): Plugin {
    return {
        name: "ark-dev-proxy",
        apply: "serve",
        configureServer(server) {
            server.middlewares.use("/__ark_proxy", async (req, res, next) => {
                try {
                    const requestUrl = new URL(req.url || "/", "http://localhost");
                    const target = requestUrl.searchParams.get("target");
                    const path = requestUrl.searchParams.get("path");
                    if (!target || !path || !/^https:\/\/([a-z0-9-]+\.)*volces\.com(?::\d+)?$/i.test(new URL(target).origin)) {
                        res.statusCode = 400;
                        res.end("Invalid Ark proxy target");
                        return;
                    }
                    const body = await readRequestBody(req);
                    const upstream = await fetch(`${target.replace(/\/$/, "")}${path}`, {
                        method: req.method,
                        headers: forwardedHeaders(req.headers),
                        body: body.length ? body : undefined,
                    });
                    res.statusCode = upstream.status;
                    upstream.headers.forEach((value, key) => {
                        if (!["content-encoding", "content-length", "transfer-encoding"].includes(key.toLowerCase())) res.setHeader(key, value);
                    });
                    if (upstream.body) Readable.fromWeb(upstream.body as never).pipe(res);
                    else res.end();
                } catch (error) {
                    next(error);
                }
            });
        },
    };
}

function readRequestBody(req: import("node:http").IncomingMessage) {
    return new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

function forwardedHeaders(headers: import("node:http").IncomingHttpHeaders) {
    return Object.fromEntries(Object.entries(headers).filter(([key]) => !["host", "origin", "referer", "content-length", "accept-encoding"].includes(key.toLowerCase())) as Array<[string, string]>);
}

export default defineConfig({
    base: process.env.VITE_BASE || "/",
    plugins: [react(), localPluginsManifest(), arkDevProxy()],
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
