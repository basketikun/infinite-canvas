import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { parseChangelog } from "./src/lib/release";
import { AI_PROXY_PATH, createAiProxyHandler } from "./server/ai-proxy.mjs";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");
const aiProxyHandler = createAiProxyHandler();

function aiProxyPlugin(): Plugin {
    return {
        name: "infinite-canvas-ai-proxy",
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (!req.url?.startsWith(AI_PROXY_PATH)) {
                    next();
                    return;
                }
                void aiProxyHandler(req, res).catch(next);
            });
        },
    };
}

export default defineConfig({
    plugins: [aiProxyPlugin(), react()],
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
