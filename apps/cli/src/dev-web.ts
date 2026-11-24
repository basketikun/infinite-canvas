import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import type { WebHost } from "@infinite-canvas/server";

export async function createDevWeb(http: Server): Promise<WebHost> {
    const { createServer } = await import("vite");
    const vite = await createServer({
        configFile: fileURLToPath(new URL("../ui/vite.config.ts", import.meta.url)),
        server: { middlewareMode: true, hmr: { server: http } },
        appType: "spa",
    });
    return { middleware: vite.middlewares, close: () => vite.close() };
}
