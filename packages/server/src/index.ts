import { ModelTasks } from "./models/tasks.js";
import { PluginManager } from "./plugins/manager.js";
import { access } from "node:fs/promises";
import path from "node:path";
import { createServer, type Server } from "node:http";
import type { RequestHandler } from "express";
import { FsStorage } from "./storage/fs-storage.js";
import { CanvasSession } from "./canvas/session.js";
import { createCanvasHttpApp, mountEventSockets } from "./server/http.js";
import { createStaticWeb } from "./server/web.js";
import type { ServerConfig } from "./config.js";
import { logger } from "./utils/logger.js";

export type WebHost = { middleware: RequestHandler; close: () => Promise<void> };
export type LocalWeb = { directory: string } | { create: (http: Server) => Promise<WebHost> };

export async function startLocalServer(options: { dataDirectory: string; web: LocalWeb; port: number; skipThirdPartyPlugins?: boolean; mcp?: ServerConfig["mcp"] }) {
    if ("directory" in options.web) await access(path.join(options.web.directory, "index.html"));
    const storage = await FsStorage.open(options.dataDirectory);
    const plugins = new PluginManager(storage, options.skipThirdPartyPlugins);
    let tasks: ModelTasks | undefined;
    const config: ServerConfig = { url: `http://127.0.0.1:${options.port}`, mcp: options.mcp };
    const http = createServer();
    let web: WebHost | undefined;
    let stopping: Promise<void> | undefined;
    const close = () => stopping ??= (async () => {
        const closed = new Promise<void>((resolve) => http.close(() => resolve()));
        try {
            try {
                await tasks?.close();
            } finally {
                try {
                    await plugins.close();
                } finally {
                    const results = await Promise.allSettled([storage.close(), web?.close()]);
                    for (const result of results) if (result.status === "rejected") throw result.reason;
                }
            }
        } finally {
            http.closeAllConnections();
            await closed;
        }
    })();
    try {
        tasks = new ModelTasks(storage);
        await tasks.ready;
        const middleware = "directory" in options.web ? createStaticWeb(options.web.directory) : (web = await options.web.create(http)).middleware;
        const session = new CanvasSession();
        http.on("request", createCanvasHttpApp(config, session, { storage, web: middleware, plugins, tasks }));
        mountEventSockets(http, session, storage);
        await new Promise<void>((resolve, reject) => {
            http.once("error", reject);
            http.listen(options.port, "127.0.0.1", () => { http.off("error", reject); resolve(); });
        });
        config.url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
    } catch (error) {
        try { await close(); } finally { throw error; }
    }
    return { url: config.url, close };
}
