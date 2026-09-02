#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import { loadConfig, saveConfig, ensureDataDirs } from "./config.js";
import { BackendDatabase } from "./db.js";
import { startServer } from "./server.js";
import { createLogger } from "./logger.js";
import { createStores } from "./stores/index.js";
import { ComfyUiBackend } from "./comfyui/bridge.js";
import { registerComfyRoutes } from "./server/comfy-routes.js";

const logger = createLogger("main");

const config = loadConfig(true);
saveConfig(config);
ensureDataDirs();

const db = new BackendDatabase();
const stores = createStores(db);
const comfy = new ComfyUiBackend({ tasks: stores.tasks, settings: stores.settings });

const { app } = startServer(db, config, { comfy });
registerComfyRoutes({ app, stores, config }, comfy);

const server = app.listen(config.port, "127.0.0.1", () => {
    logger.info(`总后台已启动 http://127.0.0.1:${config.port}`, { pid: process.pid, version: readVersion() });
});

const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down…`);
    server.close(() => {
        db.close();
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

function readVersion() {
    try {
        const pkgPath = path.join(import.meta.dirname || ".", "..", "package.json");
        return String(JSON.parse(fs.readFileSync(pkgPath, "utf8")).version || "0.0.0");
    } catch {
        return "0.0.0";
    }
}
