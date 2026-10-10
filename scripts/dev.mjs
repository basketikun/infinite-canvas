// 本地一键启动：前端（Vite :3000）+ 转发代理（canvas-proxy :23210），加 --agent 同时启动 Canvas Agent。
// 用法：node scripts/dev.mjs [--agent]，Ctrl+C 一起退出。
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "web");
const proxyUrl = "http://127.0.0.1:23210";
const withAgent = process.argv.includes("--agent");

if (!existsSync(join(web, "node_modules"))) {
    console.error("缺少前端依赖，请先执行：cd web && bun install（或 npm install）");
    process.exit(1);
}

// 能连上说明端口已有服务在监听
const inUse = (port) =>
    new Promise((resolve) => {
        const socket = connect(port, "127.0.0.1");
        socket.once("connect", () => (socket.destroy(), resolve(true)));
        socket.once("error", () => resolve(false));
    });

if (await inUse(3000)) {
    console.error("3000 端口已被占用，请先关闭占用它的进程再启动");
    process.exit(1);
}

const tasks = [
    // VITE_PROXY_URL 让前端默认开启本地代理
    { name: "web", color: 36, cmd: process.execPath, args: [join(web, "node_modules/vite/bin/vite.js"), "--host", "0.0.0.0", "--port", "3000"], cwd: web, env: { VITE_PROXY_URL: proxyUrl } },
];
// 23210 已有代理在跑（例如之前 npx 起的）就直接复用
if (await inUse(23210)) console.log(`[proxy] ${proxyUrl} 已在监听，复用现有代理`);
else tasks.push({ name: "proxy", color: 33, cmd: process.execPath, args: [join(root, "canvas-proxy/index.js"), "--host", "127.0.0.1", "--port", "23210"], cwd: root });
if (withAgent) tasks.push({ name: "agent", color: 35, cmd: "npx", args: ["-y", "@basketikun/canvas-agent@latest"], cwd: root, shell: true });

const children = [];
let stopping = false;

function stopAll(code = 0) {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
        if (child.exitCode !== null) continue;
        // Windows 上 shell 启动的子进程要连同进程树一起结束
        if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        else child.kill("SIGTERM");
    }
    process.exit(code);
}

for (const task of tasks) {
    const label = `\x1b[${task.color}m[${task.name}]\x1b[0m `;
    const child = spawn(task.cmd, task.args, { cwd: task.cwd, env: { ...process.env, ...task.env }, shell: task.shell ?? false });
    const pipe = (stream, out) => {
        let rest = "";
        stream.on("data", (chunk) => {
            const lines = (rest + chunk).split(/\r?\n/);
            rest = lines.pop();
            for (const line of lines) out.write(label + line + "\n");
        });
    };
    pipe(child.stdout, process.stdout);
    pipe(child.stderr, process.stderr);
    child.on("exit", (code) => {
        if (stopping) return;
        console.error(`${label}已退出（code ${code}），停止全部进程`);
        stopAll(code ?? 1);
    });
    children.push(child);
}

console.log(`前端 http://localhost:3000 · 代理 ${proxyUrl}${withAgent ? " · Canvas Agent 启动中" : "（加 --agent 同时启动 Canvas Agent）"}`);
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
