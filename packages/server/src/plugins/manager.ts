import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { unpackTar } from "modern-tar";
import npa from "npm-package-arg";
import { createPluginPackage, fetchPluginIndex, fetchPluginTarball, pluginArchiveFiles, pluginIdFromName, pluginMetaSchema, readPluginArchive, readPluginClientFiles, DEFAULT_PLUGIN_REGISTRY, PLUGIN_PACKAGE_MAX_BYTES, PluginError, pluginRegistrySchema, type InstalledPlugin, type PluginAdapter, type PluginInstall, type PluginPackageInfo, type PluginRegistryConfig } from "@infinite-canvas/shared/plugins";
import type { FsStorage } from "../storage/fs-storage.js";
import { readDiskJson } from "../storage/records.js";
import { logger } from "../utils/logger.js";

type Install = { registry: string; uploaded?: boolean; installedAt: string };
type ManagerState = { config: PluginRegistryConfig; installs: Record<string, Install>; enabled: Record<string, boolean> };

function isPluginFolder(name: string) {
    try { return pluginIdFromName(name) === name; }
    catch { return false; }
}

async function fetchResource(url: string, signal?: AbortSignal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new PluginError("PLUGIN_DOWNLOAD_FAILED");
    return response;
}

function unpackFiles(bytes: Uint8Array) {
    if (bytes.byteLength > PLUGIN_PACKAGE_MAX_BYTES) throw new PluginError("PLUGIN_PACKAGE_TOO_LARGE");
    return Promise.resolve().then(() => unpackTar(gunzipSync(bytes))).then(pluginArchiveFiles, (error) => { throw new PluginError("PLUGIN_PACKAGE_INVALID", { cause: error }); });
}

/**
 * 命令行与网页共用的本地插件管理。每个插件是工作区 plugins/<插件id>/ 目录，靠扫描目录发现：
 * npm 包解压到这里，手写的插件直接放 client.js。安装先解压到临时目录，通过校验后再整体替换。
 */
export class PluginManager implements PluginAdapter {
    private queue: Promise<unknown> = Promise.resolve();
    private recoveryAllowed = new Set<string>();
    private controller = new AbortController();
    private recovered?: Promise<void>;
    constructor(private storage: FsStorage, private skipThirdPartyPlugins = false) {}

    private get root() { return path.join(this.storage.directory, "plugins"); }

    private async state(): Promise<ManagerState> {
        const saved = (await this.storage.read<ManagerState>("privateConfig", "plugin-manager"))?.value;
        return { config: saved?.config ?? { registry: DEFAULT_PLUGIN_REGISTRY }, installs: saved?.installs ?? {}, enabled: saved?.enabled ?? {} };
    }

    private mutate(change: (state: ManagerState) => ManagerState) {
        if (this.controller.signal.aborted) return Promise.reject(new PluginError("PLUGIN_INACTIVE"));
        const result = this.queue.then(async () => {
            await this.storage.save("privateConfig", "plugin-manager", change(await this.state()), "plugin-manager");
        });
        this.queue = result.catch(() => {});
        return result;
    }

    async localDirectoryPath() {
        await mkdir(this.root, { recursive: true });
        return this.root;
    }

    /** 读取插件目录并生成记录；没有入口文件的目录不是插件。 */
    private async describe(state: ManagerState, id: string, directory = path.join(this.root, id)): Promise<InstalledPlugin | null> {
        const manifest = await readDiskJson<{ name?: string; version?: string; description?: string; author?: string }>(path.join(directory, "package.json")) ?? {};
        const meta = await readDiskJson<unknown>(path.join(directory, "plugin.json"));
        const present = new Set<string>();
        for (const file of ["dist/client.js", "client.js", "icon.svg", "icon.png", "icon.webp", "GUIDE.md", "README.md"]) {
            if (await stat(path.join(directory, file)).then((item) => item.isFile(), () => false)) present.add(file);
        }
        if (!present.has("dist/client.js") && !present.has("client.js")) return null;
        const pkg = createPluginPackage({ name: manifest.name ?? id, version: manifest.version, description: manifest.description, author: manifest.author }, (file) => present.has(file), id, meta === null ? undefined : pluginMetaSchema.parse(meta));
        const entry = pkg.infiniteCanvas.client;
        const index = await readDiskJson<unknown>(path.join(directory, `${entry}.files.json`)) ?? undefined;
        const files = (index as { files?: string[] } | undefined)?.files ?? [entry];
        const digest = createHash("sha256");
        for (const file of files) {
            const info = await stat(path.join(directory, file));
            digest.update(`${file}:${info.size}:${info.mtimeMs};`);
        }
        const install = state.installs[id];
        return {
            package: pkg, registry: install?.registry ?? "", enabled: state.enabled[id] === true,
            installedAt: install?.installedAt ?? (await stat(path.join(directory, entry))).mtime.toISOString(), ...(install?.uploaded && { uploaded: true }),
            clientFiles: readPluginClientFiles(pkg, digest.digest("hex").slice(0, 32), index),
        };
    }

    /** 清理崩溃残留：未完成的暂存目录直接删除，替换中断留下的旧版本备份在目标缺失时还原。 */
    private async recover() {
        for (const name of await readdir(this.root).catch(() => [])) {
            const file = path.join(this.root, name);
            if (name.startsWith(".install-")) await rm(file, { recursive: true, force: true });
            else if (name.startsWith(".backup-")) await rename(file, path.join(this.root, name.slice(".backup-".length))).catch(() => rm(file, { recursive: true, force: true }));
        }
    }

    async list() {
        await (this.recovered ??= this.recover());
        const state = await this.state();
        const names = await readdir(this.root).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
        const records = await Promise.all(names.filter(isPluginFolder).map((id) => this.describe(state, id).catch((error) => { logger.error("读取插件目录失败", { id, error }); return null; })));
        return records.filter((record) => record !== null).map((record) => this.skipThirdPartyPlugins && !this.recoveryAllowed.has(record.package.infiniteCanvas.id) ? { ...record, startupSkipped: true } : record);
    }

    async index() { return fetchPluginIndex(fetchResource, (await this.state()).config.registry, this.controller.signal); }

    async config() { return { ...(await this.state()).config, skipThirdPartyPlugins: this.skipThirdPartyPlugins }; }

    configure(config: PluginRegistryConfig) {
        const parsed = pluginRegistrySchema.parse(config);
        return this.mutate((state) => ({ ...state, config: parsed }));
    }

    async inspectPackage(bytes: Uint8Array): Promise<PluginPackageInfo> {
        const pkg = readPluginArchive(await unpackFiles(bytes));
        return { id: pkg.infiniteCanvas.id, name: pkg.name, version: pkg.version };
    }

    /** 同名插件替换旧版本并保留启用状态；失败时清理临时目录，旧版本不受影响。 */
    private async installFiles(files: Map<string, Uint8Array>, registry: string, uploaded: boolean, signal: AbortSignal) {
        const pkg = readPluginArchive(files);
        const id = pkg.infiniteCanvas.id;
        const staging = path.join(this.root, `.install-${randomUUID()}`);
        try {
            for (const [file, bytes] of files) {
                await mkdir(path.dirname(path.join(staging, file)), { recursive: true, mode: 0o700 });
                await writeFile(path.join(staging, file), bytes, { mode: 0o600 });
            }
            const state = await this.state();
            const current = await this.describe(state, id);
            if (current && current.package.name !== pkg.name) throw new PluginError("PLUGIN_CONFLICT");
            if (!await this.describe(state, id, staging)) throw new PluginError("PLUGIN_INVALID");
            signal.throwIfAborted();
            const target = path.join(this.root, id), backup = path.join(this.root, `.backup-${id}`);
            await rm(backup, { recursive: true, force: true });
            const replaced = await rename(target, backup).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; });
            try { await rename(staging, target); }
            catch (error) { if (replaced) await rename(backup, target); throw error; }
            if (replaced) await rm(backup, { recursive: true, force: true });
            this.recoveryAllowed.add(id);
            await this.mutate((latest) => ({ ...latest, installs: { ...latest.installs, [id]: { registry, uploaded, installedAt: new Date().toISOString() } }, enabled: { ...latest.enabled, [id]: latest.enabled[id] ?? true } }));
            return (await this.describe(await this.state(), id))!;
        } catch (error) {
            await rm(staging, { recursive: true, force: true });
            if (signal.aborted) throw signal.reason;
            logger.error("插件安装失败", { error });
            throw error instanceof PluginError ? error : new PluginError("PLUGIN_INSTALL_FAILED", { cause: error });
        }
    }

    async install(request: PluginInstall, signal?: AbortSignal) {
        const spec = npa.resolve(request.name, request.version);
        if (!spec.registry || spec.name !== request.name || !["version", "range", "tag"].includes(spec.type)) throw new PluginError("PLUGIN_INVALID");
        const cancellation = signal ? AbortSignal.any([this.controller.signal, signal]) : this.controller.signal;
        const state = await this.state();
        const registry = state.installs[pluginIdFromName(request.name)]?.registry || state.config.registry;
        try {
            const { bytes } = await fetchPluginTarball(fetchResource, registry, request, cancellation);
            const files = await unpackFiles(bytes);
            if (readPluginArchive(files).name !== request.name) throw new PluginError("PLUGIN_INVALID");
            return await this.installFiles(files, registry, false, cancellation);
        } catch (error) {
            if (cancellation.aborted) throw cancellation.reason;
            throw error instanceof PluginError ? error : new PluginError("PLUGIN_INSTALL_FAILED", { cause: error });
        }
    }

    async installPackage(bytes: Uint8Array, signal?: AbortSignal) {
        return this.installFiles(await unpackFiles(bytes), "", true, signal ? AbortSignal.any([this.controller.signal, signal]) : this.controller.signal);
    }

    private async record(id: string) {
        const record = isPluginFolder(id) ? await this.describe(await this.state(), id) : null;
        if (!record) throw new PluginError("PLUGIN_NOT_FOUND");
        return record;
    }

    async enable(id: string, enabled: boolean) {
        await this.record(id);
        this.recoveryAllowed.add(id);
        return this.mutate((state) => ({ ...state, enabled: { ...state.enabled, [id]: enabled } }));
    }

    async remove(id: string) {
        await this.record(id);
        await rm(path.join(this.root, id), { recursive: true, force: true });
        return this.mutate((state) => {
            const { [id]: install, ...installs } = state.installs;
            const { [id]: enabled, ...rest } = state.enabled;
            return { ...state, installs, enabled: rest };
        });
    }

    private async entry(record: InstalledPlugin, file: string) {
        const root = await realpath(path.join(this.root, record.package.infiniteCanvas.id));
        const target = await realpath(path.join(root, file));
        const relative = path.relative(root, target);
        if (relative.startsWith("..") || path.isAbsolute(relative)) throw new PluginError("PLUGIN_INVALID");
        return target;
    }

    private async packageRecord(id: string, version: string, generation?: string) {
        const record = await this.record(id);
        if (record.package.version !== version || (generation !== undefined && record.clientFiles?.generation !== generation)) throw new PluginError("PLUGIN_NOT_FOUND");
        return record;
    }

    async readClientFile(id: string, version: string, generation: string, file: string) {
        const record = await this.packageRecord(id, version, generation);
        if (!record.clientFiles?.files.includes(file)) throw new PluginError("PLUGIN_NOT_FOUND");
        return this.entry(record, file);
    }

    async source(id: string, version: string, generation?: string) {
        const record = await this.packageRecord(id, version, generation);
        return readFile(await this.entry(record, record.package.infiniteCanvas.client), "utf8");
    }

    async asset(id: string, version: string, kind: "icon" | "readme", generation?: string) {
        const record = await this.packageRecord(id, version, generation);
        const file = record.package.infiniteCanvas[kind];
        if (!file) throw new PluginError("PLUGIN_NOT_FOUND");
        const content = await readFile(await this.entry(record, file));
        if (kind === "readme") return content.toString("utf8");
        const extension = path.extname(file).slice(1).toLowerCase();
        return `data:${extension === "svg" ? "image/svg+xml" : `image/${extension}`};base64,${content.toString("base64")}`;
    }

    async close() {
        this.controller.abort(new PluginError("PLUGIN_INACTIVE"));
        await this.queue;
    }
}
