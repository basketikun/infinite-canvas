import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_PORT = 17371;
export const CONFIG_DIR = path.join(os.homedir(), ".infinite-canvas");
export const CONFIG_FILE = path.join(CONFIG_DIR, "canvas-mcp.json");
export const VERSION = readPackageVersion();
export const AGENT_PROMPT = fs.readFileSync(new URL("../agent-instructions.md", import.meta.url), "utf8");

export type ServerConfig = { url: string; mcp?: { command: string; args: string[] } };

/** 读取本地 本地服务配置，不存在时生成默认配置。 */
export function loadConfig(create = false): ServerConfig {
    try {
        const { url } = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as ServerConfig;
        return { url };
    } catch {
        const config = { url: `http://127.0.0.1:${Number(process.env.PORT) || DEFAULT_PORT}` };
        if (create) saveConfig(config);
        return config;
    }
}

/** 将 本地服务配置写入用户配置目录。 */
export function saveConfig(config: ServerConfig) {
    writeConfigFile(CONFIG_DIR, CONFIG_FILE, config);
}

/** 写入配置并强制目录 0700、文件 0600，包括纠正已有宽松权限。 */
export function writeConfigFile(dir: string, file: string, config: ServerConfig) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
    fs.chmodSync(dir, 0o700);
    fs.chmodSync(file, 0o600);
}

/** 从当前包信息中读取 本地服务版本号。 */
function readPackageVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
        return pkg.version || "0.0.0";
    } catch {
        return "0.0.0";
    }
}
