import { readdirSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { parseChangelog } from "./src/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");

// 暴露 /plugins/index.json:列出 public/plugins 下的本地插件文件,
// 供前端自动发现并加入插件列表(默认关闭)。dev 下实时读目录,构建时产出静态清单。
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

function isPrivateWebdavTarget(value: string) {
    try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol)) return false;
        if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1") return true;
        if (isIP(url.hostname) !== 4) return false;
        const [first, second] = url.hostname.split(".").map(Number);
        return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
    } catch {
        return false;
    }
}

function localWebdavProxy(): Plugin {
    return {
        name: "local-webdav-proxy",
        configureServer(server) {
            server.middlewares.use("/api-proxy/webdav", async (req, res) => {
                try {
                    const target = new URL(req.url || "", "http://localhost").searchParams.get("url") || "";
                    if (!isPrivateWebdavTarget(target)) {
                        res.statusCode = 403;
                        res.end("Only private-network WebDAV targets are allowed");
                        return;
                    }
                    const chunks: Buffer[] = [];
                    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                    const headers = new Headers();
                    for (const name of ["authorization", "content-type", "depth", "if-match", "if-none-match"]) {
                        const value = req.headers[name];
                        if (typeof value === "string") headers.set(name, value);
                    }
                    const body = chunks.length ? Buffer.concat(chunks) : undefined;
                    const upstream = await fetch(target, { method: req.method, headers, body, redirect: "manual" });
                    res.statusCode = upstream.status;
                    for (const name of ["content-type", "content-length", "etag", "last-modified", "location"]) {
                        const value = upstream.headers.get(name);
                        if (value) res.setHeader(name, value);
                    }
                    res.end(Buffer.from(await upstream.arrayBuffer()));
                } catch (error) {
                    res.statusCode = 502;
                    res.end(error instanceof Error ? error.message : "WebDAV proxy failed");
                }
            });
        },
    };
}

function isAllowedAiTarget(value: string) {
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || isIP(url.hostname) || url.hostname === "localhost" || url.hostname.endsWith(".local")) return false;
        return true;
    } catch {
        return false;
    }
}

function localAiProxy(): Plugin {
    return {
        name: "local-ai-proxy",
        configureServer(server) {
            server.middlewares.use("/api-proxy/ai", async (req, res) => {
                try {
                    const target = new URL(req.url || "", "http://localhost").searchParams.get("url") || "";
                    if (!isAllowedAiTarget(target)) {
                        res.statusCode = 403;
                        res.end("Only public HTTPS AI targets are allowed");
                        return;
                    }
                    const chunks: Buffer[] = [];
                    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                    const headers = new Headers();
                    for (const [name, value] of Object.entries(req.headers)) {
                        if (!value || ["host", "connection", "content-length", "origin", "referer"].includes(name)) continue;
                        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
                    }
                    const body = chunks.length ? Buffer.concat(chunks) : undefined;
                    const upstream = await fetch(target, { method: req.method, headers, body, redirect: "manual" });
                    res.statusCode = upstream.status;
                    for (const name of ["content-type", "content-length", "content-disposition", "cache-control", "etag", "last-modified", "location"]) {
                        const value = upstream.headers.get(name);
                        if (value) res.setHeader(name, value);
                    }
                    res.end(Buffer.from(await upstream.arrayBuffer()));
                } catch (error) {
                    res.statusCode = 502;
                    res.end(error instanceof Error ? error.message : "AI proxy failed");
                }
            });
        },
    };
}

export default defineConfig({
    base: process.env.VITE_BASE || "/",
    plugins: [react(), localPluginsManifest(), localWebdavProxy(), localAiProxy()],
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
