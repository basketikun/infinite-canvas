import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_PORT = 17370;
export const DATA_DIR = path.join(os.homedir(), ".infinite-canvas");
export const CONFIG_FILE = path.join(DATA_DIR, "backend.json");
export const DB_FILE = path.join(DATA_DIR, "runtime.sqlite");
export const MEDIA_DIR = path.join(DATA_DIR, "runtime-media");
export const LOGS_DIR = path.join(DATA_DIR, "logs");
export const WORKERS_DIR = path.join(DATA_DIR, "workers");

export type BackendConfig = {
    url: string;
    token: string;
    origins?: string[];
    port?: number;
};

export type ResolvedConfig = Required<Pick<BackendConfig, "url" | "token">> & { port: number; origins: string[] };

/** 读取 backend.json，不存在时生成默认配置。 */
export function loadConfig(create = false): ResolvedConfig {
    let raw: Partial<BackendConfig> = {};
    try {
        raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as Partial<BackendConfig>;
    } catch { /* first run */ }
    const port = Number(process.env.PORT) || raw.port || DEFAULT_PORT;
    const url = raw.url || `http://127.0.0.1:${port}`;
    const token = raw.token || crypto.randomBytes(18).toString("hex");
    const config: ResolvedConfig = { url, token, port, origins: raw.origins ?? ["*"] };
    if (create) saveConfig(config);
    return config;
}

/** 写入 backend.json，目录 0700 文件 0600。 */
export function saveConfig(config: ResolvedConfig) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ url: config.url, token: config.token, port: config.port, origins: config.origins }, null, 2), { mode: 0o600 });
    fs.chmodSync(DATA_DIR, 0o700);
    fs.chmodSync(CONFIG_FILE, 0o600);
}

/** 确保所有数据目录存在。 */
export function ensureDataDirs() {
    for (const dir of [DATA_DIR, MEDIA_DIR, LOGS_DIR, WORKERS_DIR]) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
}
