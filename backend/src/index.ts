#!/usr/bin/env node
import { loadConfig, saveConfig, ensureDataDirs } from "./config.js";
import { BackendDatabase } from "./db.js";
import { startServer } from "./server.js";
import { createLogger } from "./logger.js";

const logger = createLogger("main");

const config = loadConfig(true);
saveConfig(config);
ensureDataDirs();

const db = new BackendDatabase();
startServer(config, db);

logger.info(`总后台 v${readVersion()} 初始化完成`, {
    url: config.url,
    port: config.port,
});

function readVersion() {
    try {
        const fs = require("node:fs");
        const path = require("node:path");
        const pkgPath = path.join(import.meta.dirname || ".", "..", "package.json");
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        return pkg.version || "0.0.0";
    } catch {
        return "0.0.0";
    }
}
