import { readdir, readFile, realpath } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/postcss";
import mime from "mime";
import { tsImport } from "tsx/esm/api";

import { parseChangelog } from "./src/lib/release";

const workbenchDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(workbenchDir, "../../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(workbenchDir, "../../CHANGELOG.md"), "utf8");

// 开发模式从包清单发现预构建客户端；生产安装只使用 npm 软件源。
function localPluginsManifest(): Plugin {
    const pluginsDir = resolve(workbenchDir, "public/plugins");
    return {
        name: "local-plugins-manifest",
        async configureServer(server) {
            const { readPluginClientFiles, readPluginPackage } = await tsImport("@infinite-canvas/shared/plugins", import.meta.url) as typeof import("@infinite-canvas/shared/plugins");
            const base = server.config.base;
            server.middlewares.use(`${base}plugins/index.json`, async (_req, res, next) => {
                try {
                    const entries = await readdir(pluginsDir, { withFileTypes: true }).catch(error => { if (error.code === "ENOENT") return []; throw error; });
                    const packages = await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
                        try { return JSON.parse(await readFile(resolve(pluginsDir, entry.name, "development.json"), "utf8")); }
                        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
                    }));
                    res.setHeader("Content-Type", "application/json");
                    res.end(JSON.stringify(packages.filter(Boolean)));
                } catch (error) { next(error); }
            });
            server.middlewares.use(`${base}__plugin_dev__`, async (req, res) => {
                try {
                    const [id, generation, instance, ...parts] = new URL(req.url!, "http://localhost").pathname.slice(1).split("/").map(decodeURIComponent);
                    if (req.method !== "GET" || !/^[a-z0-9][a-z0-9-]*$/.test(id) || !/^[a-f0-9]{64}$/.test(generation) || !instance) throw new Error();
                    const pointer = JSON.parse(await readFile(resolve(pluginsDir, id, "development.json"), "utf8"));
                    const pkg = readPluginPackage(pointer.package);
                    const { files, styles } = pointer.clientFiles;
                    if (pkg.infiniteCanvas.id !== id || pointer.clientFiles.generation !== generation) throw new Error();
                    const index = readPluginClientFiles(pkg, generation, { files, styles });
                    const file = parts.join("/");
                    if (!index.files.includes(file) && file !== pkg.infiniteCanvas.icon && file !== pkg.infiniteCanvas.readme) throw new Error();
                    const root = await realpath(resolve(pluginsDir, id, generation));
                    const actual = await realpath(resolve(root, file)), path = relative(root, actual);
                    if (path.startsWith("..") || isAbsolute(path)) throw new Error();
                    const bytes = await readFile(actual);
                    res.setHeader("Content-Type", mime.getType(file) || "application/octet-stream");
                    res.setHeader("Cache-Control", "no-store");
                    res.end(bytes);
                } catch { res.statusCode = 404; res.end(); }
            });
        },
    };
}

export function workbenchViteConfig(rootUrl: URL) {
    const root = fileURLToPath(rootUrl);
    return defineConfig({
        root,
        publicDir: resolve(workbenchDir, "public"),
        css: { postcss: { plugins: [tailwindcss()] } },
        base: process.env.VITE_BASE || "/",
        // 按实际请求转换，避免停止服务时等待已被取消的后台预转换。
        server: { preTransformRequests: false },
        plugins: [react(), localPluginsManifest()],
        resolve: {
            dedupe: ["react", "react-dom"],
            alias: {
                "@": resolve(root, "src"),
                "@workbench": resolve(workbenchDir, "src"),
                "radix-ui": dirname(createRequire(import.meta.url).resolve("radix-ui/package.json")),
            },
        },
        define: {
            __APP_VERSION__: JSON.stringify(localVersion),
            __APP_RELEASES__: JSON.stringify(parseChangelog(localChangelog)),
        },
    });
}
