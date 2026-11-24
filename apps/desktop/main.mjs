import { app, BrowserWindow, dialog, shell } from "electron";
import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

let host;
let window;
let stopping = false;
let startupError;

app.on("window-all-closed", () => app.quit());
app.on("will-quit", (event) => {
    if (!host) return;
    event.preventDefault();
    stopping = true;
    if (host.connected) host.disconnect();
});

function openWorkbench(origin) {
    window = new BrowserWindow({
        title: "无限画布", width: 1280, height: 840, show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const contents = window.webContents;
    const local = (url) => URL.canParse(url) && new URL(url).origin === origin;
    for (const event of ["will-navigate", "will-redirect"]) {
        contents.on(event, (details) => { if (details.isMainFrame && !local(details.url)) details.preventDefault(); });
    }
    contents.setWindowOpenHandler(({ url }) => {
        if (URL.canParse(url) && ["https:", "http:"].includes(new URL(url).protocol) && !local(url)) {
            void shell.openExternal(url).catch(() => dialog.showErrorBox("无法打开链接", "请在浏览器中打开此链接。"));
        }
        return { action: "deny" };
    });
    contents.session.setPermissionRequestHandler((sender, permission, callback, details) => {
        callback(sender === contents && details.isMainFrame && local(details.requestingUrl) && window.isFocused() && ["clipboard-read", "clipboard-sanitized-write", "fullscreen"].includes(permission));
    });
    contents.on("will-prevent-unload", (event) => {
        const choice = dialog.showMessageBoxSync(window, {
            type: "warning", message: "工作台还有修改尚未保存。", detail: "可以返回工作台等待保存，或放弃未保存的修改。",
            buttons: ["返回工作台", "放弃修改并离开"], defaultId: 0, cancelId: 0,
        });
        if (choice === 1) event.preventDefault();
    });
    window.once("ready-to-show", () => window.show());
    window.once("closed", () => { window = undefined; });
    return window.loadURL(origin);
}

void app.whenReady().then(() => {
    const { values } = parseArgs({
        args: process.argv.slice(process.defaultApp ? 2 : 1), strict: false, allowPositionals: true,
        options: { "data-dir": { type: "string" }, port: { type: "string" }, "skip-plugins": { type: "boolean" } },
    });
    const args = ["serve"];
    for (const key of ["data-dir", "port"]) if (values[key] !== undefined) args.push(`--${key}`, values[key]);
    if (values["skip-plugins"]) args.push("--skip-plugins");
    const require = createRequire(import.meta.url);
    const cli = app.isPackaged ? join(app.getAppPath(), "cli") : dirname(require.resolve("@basketikun/infinite-canvas/package.json"));
    host = fork(join(cli, app.isPackaged ? "dist/index.js" : "src/dev.ts"), args, {
        execPath: process.execPath,
        execArgv: app.isPackaged ? [] : ["--import", pathToFileURL(createRequire(join(cli, "package.json")).resolve("tsx")).href],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", INFINITE_CANVAS_DESKTOP_HOST: "1" },
        stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    host.on("message", (message) => {
        if (stopping || !message) return;
        if (message.type === "failed") {
            startupError = {
                WORKSPACE_LOCKED: "这个工作区已被占用。请先退出正在使用它的 CLI 或桌面版，再重新打开。",
                EADDRINUSE: "启动端口已被占用。请先退出正在运行的工作台，或用 --port 选择其他端口。",
                INVALID_PORT: "端口必须是 1 到 65535 之间的整数。",
            }[message.code];
        } else if (!window && message.type === "ready" && /^http:\/\/127\.0\.0\.1:\d+$/.test(message.url)) {
            void openWorkbench(message.url).catch(() => {
                if (!stopping) { dialog.showErrorBox("无法打开无限画布", "工作台页面未能加载，请重新启动。"); app.quit(); }
            });
        }
    });
    const hostExited = () => {
        host = undefined;
        if (!stopping) dialog.showErrorBox("本地工作台已停止", startupError ?? "请检查工作区是否可用，然后重新启动。");
        if (stopping || !window) app.quit();
    };
    host.once("exit", hostExited);
    host.on("error", () => {
        startupError = "无法启动本地工作台，请检查应用是否完整。";
        if (!host?.pid) hostExited();
    });
}).catch(() => {
    dialog.showErrorBox("无法启动无限画布", "请检查启动参数和应用文件后重试。");
    app.quit();
});
