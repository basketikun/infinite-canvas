import { readPluginClientFiles, readPluginPackage, PluginError, type InstalledPlugin, type PluginInstall } from "@infinite-canvas/shared/plugins";
import { plugins } from "@workbench/services/plugins/runtime";
import { storage } from "@workbench/services/storage/runtime";
import { usePluginStore } from "@workbench/stores/use-plugin-store";
import { activatePlugin, deactivatePlugin, setPluginStatus } from "./runtime";
import { developmentFilesBase } from "./client-files";
import { APP_VERSION } from "@workbench/constant/env";

const development = new Map<string, InstalledPlugin>();
// 已交给运行时的插件及其版本；启用的插件启动即加载，版本或文件变化就重新加载。
const loaded = new Map<string, string>();
const loading = new Map<string, Promise<void>>();
const loads = new Map<string, AbortController>();
const stopping = new Map<string, Promise<void>>();
const resumed = new Set<string>();
let startup: Promise<void> | undefined;
let recovery = typeof location !== "undefined" && new URLSearchParams(location.search).has("skipPlugins");
let queue = Promise.resolve();
let preferences = Promise.resolve();

const idOf = (record: InstalledPlugin) => record.package.infiniteCanvas.id;
const versionOf = (record: InstalledPlugin) => `${record.package.version}:${record.clientFiles?.generation}`;
const wanted = (record: InstalledPlugin) => record.enabled && !record.startupSkipped;

export async function readPluginAsset(record: InstalledPlugin, kind: "icon" | "readme") {
    const manifest = record.package.infiniteCanvas;
    if (record.assets?.[kind] !== undefined) return record.assets[kind]!;
    if (!record.local) return plugins.asset(manifest.id, record.package.version, kind, record.clientFiles?.generation);
    const url = developmentFilesBase(record, "catalog") + manifest[kind]!.split("/").map(encodeURIComponent).join("/");
    if (kind === "icon") return url;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok || response.headers.get("content-type")?.includes("text/html")) throw new PluginError("PLUGIN_DOWNLOAD_FAILED");
    return response.text();
}

export async function readPluginSource(record: InstalledPlugin, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (record.clientFiles && record.clientFiles.files.length > 1) return record;
    if (!record.local) return plugins.source(idOf(record), record.package.version, record.clientFiles?.generation);
    const url = developmentFilesBase(record, "source") + record.package.infiniteCanvas.client.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(url, { cache: "no-store", signal });
    if (!response.ok) throw new PluginError("PLUGIN_DOWNLOAD_FAILED");
    return response.text();
}

function load(record: InstalledPlugin) {
    const id = idOf(record);
    loads.get(id)?.abort();
    const controller = new AbortController();
    loads.set(id, controller);
    const previous = [loading.get(id), stopping.get(id)];
    const promise = Promise.all(previous).then(() => readPluginSource(record, controller.signal)).then((source) => activatePlugin(record.package, source, controller.signal)).catch((error) => {
        if (!controller.signal.aborted && !(error instanceof PluginError && error.code === "PLUGIN_INACTIVE")) console.error(`[plugins] ${id} startup failed`, error);
    }).finally(() => {
        if (loading.get(id) === promise) loading.delete(id);
        if (loads.get(id) === controller) loads.delete(id);
    });
    loading.set(id, promise);
    setPluginStatus(id, "starting");
    return promise;
}

/** 立即停止已变化的插件（退出在后台等待，重新启用会排在它之后），再启动应启用的插件。 */
function reconcile(records: readonly InstalledPlugin[]) {
    for (const [id, version] of loaded) {
        const record = records.find((item) => idOf(item) === id);
        if (record && wanted(record) && versionOf(record) === version) continue;
        loaded.delete(id);
        loads.get(id)?.abort();
        const stop = deactivatePlugin(id).finally(() => { if (stopping.get(id) === stop) stopping.delete(id); });
        stopping.set(id, stop);
    }
    for (const record of records) {
        const id = idOf(record);
        if (!wanted(record)) { if (!loaded.has(id) && !stopping.has(id) && usePluginStore.getState().states[id]?.status !== "disabled") setPluginStatus(id, "disabled"); continue; }
        if (loaded.has(id)) continue;
        loaded.set(id, versionOf(record));
        void load(record);
    }
}

async function settle(id: string) {
    await loading.get(id);
    if (usePluginStore.getState().states[id]?.status === "failed") throw new PluginError("PLUGIN_LOAD_FAILED");
}

export function refreshPlugins() {
    const run = queue.then(async () => {
        const installed = await plugins.list();
        const records = [...installed, ...[...development.values()].filter((item) => !installed.some((record) => idOf(record) === idOf(item)))].map((record) => recovery && !resumed.has(idOf(record)) ? { ...record, startupSkipped: true } : record);
        usePluginStore.setState({ plugins: records });
        reconcile(records);
    });
    queue = run.catch(() => {});
    return run;
}

function developmentPackage(value: { package: unknown; clientFiles: { generation: string; files: string[]; styles: string[] } }) {
    const pkg = readPluginPackage(value.package);
    const { generation, files, styles } = value.clientFiles;
    return { package: pkg, clientFiles: readPluginClientFiles(pkg, generation, { files, styles }) };
}

export async function reloadDevelopmentPlugin(record: InstalledPlugin) {
    if (!import.meta.env?.DEV || !record.local) throw new PluginError("PLUGIN_DEVELOPMENT_ONLY");
    const id = idOf(record);
    const response = await fetch(`${import.meta.env.BASE_URL}plugins/${id}/development.json`, { cache: "no-store" });
    if (!response.ok) throw new PluginError("PLUGIN_DOWNLOAD_FAILED");
    const pkg = developmentPackage(await response.json());
    if (pkg.package.infiniteCanvas.id !== id) throw new PluginError("PLUGIN_INVALID");
    development.set(id, { ...record, ...pkg });
    await refreshPlugins();
    await settle(id);
}

export function ensurePluginsLoaded() {
    return startup ??= (async () => {
        const config = await plugins.config();
        recovery = recovery || config.skipThirdPartyPlugins === true;
        if (import.meta.env?.DEV) {
            try {
                const response = await fetch(`${import.meta.env.BASE_URL}plugins/index.json`, { cache: "no-store" });
                if (response.ok && response.headers.get("content-type")?.includes("json")) {
                    const packages: Parameters<typeof developmentPackage>[0][] = await response.json();
                    const enabled = await storage.pluginData("plugin-manager").getItem<Record<string, boolean>>("development");
                    for (const value of packages) {
                        try {
                            const pkg = developmentPackage(value), id = pkg.package.infiniteCanvas.id;
                            development.set(id, { ...pkg, registry: "", local: true, enabled: enabled?.[id] === true, installedAt: "" });
                        } catch (error) { console.error("[plugins] invalid development plugin", error); }
                    }
                }
            } catch (error) { console.error("[plugins] development discovery failed", error); }
        }
        await refreshPlugins();
    })().catch((error) => { startup = undefined; throw error; });
}

const installations = new Map<string, AbortController>();

/** 同名插件再次安装即更新；卸载会取消尚未完成的安装，新版本启动失败直接报错。 */
async function installFrom(name: string, signal: AbortSignal | undefined, install: (signal: AbortSignal) => Promise<InstalledPlugin>) {
    installations.get(name)?.abort(new PluginError("PLUGIN_INACTIVE"));
    const controller = new AbortController();
    installations.set(name, controller);
    const cancel = () => controller.abort(signal!.reason);
    signal?.addEventListener("abort", cancel, { once: true });
    try {
        const record = await install(controller.signal).catch((error) => { throw controller.signal.aborted ? controller.signal.reason : error; });
        controller.signal.throwIfAborted();
        resumed.add(idOf(record));
        await refreshPlugins();
        await settle(idOf(record));
        return record;
    } finally {
        signal?.removeEventListener("abort", cancel);
        if (installations.get(name) === controller) installations.delete(name);
    }
}

export function installPlugin(request: Omit<PluginInstall, "host">, signal?: AbortSignal) {
    return installFrom(request.name, signal, (active) => plugins.install({ ...request, host: APP_VERSION }, active));
}

export async function installPluginPackage(bytes: Uint8Array, signal?: AbortSignal) {
    const { name } = await plugins.inspectPackage(bytes);
    return installFrom(name, signal, (active) => plugins.installPackage(bytes, active));
}

export async function setPluginEnabled(record: InstalledPlugin, enabled: boolean) {
    const id = idOf(record);
    resumed.add(id);
    if (record.local) {
        const save = preferences.then(async () => {
            const collection = storage.pluginData("plugin-manager");
            await collection.setItem("development", { ...await collection.getItem<Record<string, boolean>>("development"), [id]: enabled });
            development.set(id, { ...record, enabled, startupSkipped: false });
        });
        preferences = save.catch(() => {});
        await save;
    } else await plugins.enable(id, enabled);
    await refreshPlugins();
    if (enabled) await settle(id);
}

export async function uninstallPlugin(id: string) {
    const name = usePluginStore.getState().plugins.find((item) => idOf(item) === id)?.package.name;
    if (name) installations.get(name)?.abort(new PluginError("PLUGIN_INACTIVE"));
    await plugins.remove(id);
    await refreshPlugins();
}
