import type { PluginScope } from "@infinite-canvas/plugin-sdk/scope";
import { PluginError, type InstalledPlugin } from "@infinite-canvas/shared/plugins";
import { plugins } from "@workbench/services/plugins/runtime";

const mounts = new Map<string, { record: InstalledPlugin; scope: PluginScope }>();
let registration: Promise<void> | undefined;

function workerReady(base: URL, signal: AbortSignal) {
    if (!navigator.serviceWorker) throw new PluginError("PLUGIN_LOAD_FAILED");
    const workers = navigator.serviceWorker;
    const script = new URL("plugin-files-sw.js", base).href;
    registration ??= (async () => {
        const current = await workers.getRegistration(location.href);
        if ([workers.controller, current?.active, current?.waiting, current?.installing].some(worker => worker && worker.scriptURL !== script)) throw new PluginError("PLUGIN_LOAD_FAILED");
        const owned = await workers.register(script, { scope: base.href });
        const worker = owned.installing ?? owned.waiting ?? owned.active;
        if (!worker || worker.scriptURL !== script) throw new PluginError("PLUGIN_LOAD_FAILED");
        await new Promise<void>((resolve, reject) => {
            const check = () => {
                if (!workers.controller && worker.state !== "redundant") return;
                worker.removeEventListener("statechange", check);
                workers.removeEventListener("controllerchange", check);
                if (workers.controller?.scriptURL === script) resolve();
                else reject(new PluginError("PLUGIN_LOAD_FAILED"));
            };
            worker.addEventListener("statechange", check);
            workers.addEventListener("controllerchange", check);
            check();
        });
    })().catch(error => { registration = undefined; throw error; });
    return new Promise<void>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.throwIfAborted();
        signal.addEventListener("abort", abort, { once: true });
        registration!.then(() => { if (workers.controller?.scriptURL === script) resolve(); else reject(new PluginError("PLUGIN_LOAD_FAILED")); }, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}

function serve(event: MessageEvent) {
    if (event.source !== navigator.serviceWorker.controller || event.data?.type !== "plugin-module" || typeof event.data.url !== "string") return;
    const port = event.ports[0];
    if (!port) return;
    const reply = async () => {
        for (const [base, { record, scope }] of mounts) {
            if (!event.data.url.startsWith(base)) continue;
            const path = decodeURIComponent(event.data.url.slice(base.length));
            if (!record.clientFiles!.files.includes(path)) return null;
            return scope.track(async () => {
                const file = await plugins.clientFile!(record, path);
                scope.assertActive();
                return file;
            });
        }
        return null;
    };
    void reply().then(file => port.postMessage(file), () => port.postMessage(null)).finally(() => port.close());
}

// 关闭最后一个实例及重载工作台后，旧资源请求仍须明确结束。
if (typeof navigator !== "undefined") navigator.serviceWorker?.addEventListener("message", serve);

const filePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
export function developmentFilesBase(record: InstalledPlugin, instance: string) {
    return `${import.meta.env?.BASE_URL ?? "/"}__plugin_dev__/${encodeURIComponent(record.package.infiniteCanvas.id)}/${encodeURIComponent(record.clientFiles!.generation)}/${instance}/`;
}

export async function openClientFiles(record: InstalledPlugin, scope: PluginScope) {
    const instance = crypto.randomUUID();
    let base: string;
    if (record.local) base = developmentFilesBase(record, instance);
    else if (plugins.clientBase) base = plugins.clientBase(record, instance);
    else {
        const app = new URL(import.meta.env.BASE_URL, location.origin);
        await workerReady(app, scope.signal);
        scope.assertActive();
        base = new URL(`__plugin_modules__/${encodeURIComponent(record.package.infiniteCanvas.id)}/${encodeURIComponent(record.package.version)}/${record.clientFiles!.generation}/${instance}/`, app).href;
        mounts.set(base, { record, scope });
        scope.signal.addEventListener("abort", () => {
            mounts.delete(base);
        }, { once: true });
    }
    scope.assertActive();
    const styles = record.clientFiles!.styles.map(path => new Promise<void>((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.dataset.canvasPlugin = record.package.infiniteCanvas.id;
        link.href = base + filePath(path);
        link.onload = () => resolve();
        link.onerror = () => reject(new PluginError("PLUGIN_LOAD_FAILED"));
        scope.signal.addEventListener("abort", () => { link.remove(); reject(scope.signal.reason); }, { once: true });
        document.head.appendChild(link);
    }));
    await Promise.all(styles);
    scope.assertActive();
    return base + filePath(record.package.infiniteCanvas.client!);
}
