import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";

const optimizeDepsInclude = [
    "react",
    "react-dom",
    "react-dom/client",
    "react-router",
    "react-router-dom",
    "antd",
    "antd/locale/zh_CN",
    "antd/locale/en_US",
    "@ant-design/icons",
    "@tanstack/react-query",
    "zustand",
    "axios",
    "dayjs",
    "lucide-react",
    "localforage",
    "clsx",
    "tailwind-merge",
    "nanoid",
];

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(localVersion),
    },
    optimizeDeps: {
        include: optimizeDepsInclude,
    },
    server: {
        warmup: {
            clientFiles: ["./src/main.tsx", "./src/router.tsx", "./src/pages/home/index.tsx", "./src/layouts/user-layout.tsx", "./src/components/layout/app-providers.tsx"],
        },
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes("node_modules")) {
                        if (id.includes("/pages/canvas/project")) return "canvas-project";
                        if (id.includes("/pages/image") || id.includes("/pages/video")) return "generation-pages";
                        return;
                    }
                    if (id.includes("antd") || id.includes("@ant-design")) return "antd";
                    if (id.includes("@codemirror") || id.includes("@uiw/react-codemirror")) return "codemirror";
                    if (id.includes("motion")) return "motion";
                    if (id.includes("localforage")) return "localforage";
                    return "vendor";
                },
            },
        },
    },
});
