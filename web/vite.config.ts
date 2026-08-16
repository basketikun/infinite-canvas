import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from "vite";

import { parseChangelog } from "./src/lib/release";
import { eagleBridge } from "./eagle-bridge";
import { sharedStorage } from "./shared-storage-server";

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

function localExit(): Plugin {
    const attachExitHandler = (server: ViteDevServer | PreviewServer) => {
        server.middlewares.use("/api/app/exit", (req, res, _next) => {
            const address = req.socket.remoteAddress || "";
            const isLoopback = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
            if (!isLoopback) {
                res.statusCode = 403;
                return res.end(JSON.stringify({ status: "error", message: "Local exit is only available from this computer" }));
            }
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            if (req.method === "GET") {
                res.statusCode = 200;
                return res.end(JSON.stringify({ status: "success", available: true }));
            }
            if (req.method !== "POST") {
                res.statusCode = 405;
                res.setHeader("Allow", "GET, POST");
                return res.end(JSON.stringify({ status: "error", message: "Method not allowed" }));
            }
            res.statusCode = 200;
            res.end(JSON.stringify({ status: "success" }));
            setTimeout(() => process.exit(0), 100);
        });
    };
    return {
        name: "local-exit",
        configureServer: attachExitHandler,
        configurePreviewServer: attachExitHandler,
    };
}

export default defineConfig({
    base: process.env.VITE_BASE || "/",
    plugins: [react(), localPluginsManifest(), eagleBridge(), sharedStorage(resolve(webDir, "../data/infinite-canvas")), localExit()],
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
