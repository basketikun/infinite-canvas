import { unpackTar } from "modern-tar";
import mime from "mime";
import { PLUGIN_PACKAGE_MAX_BYTES, assertPluginConflicts, type InstalledPlugin, readPluginClientFiles, DEFAULT_PLUGIN_REGISTRY, PluginError, fetchPluginIndex, fetchPluginTarball, pluginArchiveFiles, readPluginArchive, pluginRegistrySchema, type PluginAdapter, type PluginInstall, type PluginPackageInfo, type PluginRegistryConfig } from "@infinite-canvas/shared/plugins";
import { storage } from "@workbench/services/storage/runtime";
import { network } from "@workbench/services/network/runtime";

type BrowserPlugin = InstalledPlugin & { sourceId?: string };

function sourceKey(record: BrowserPlugin) {
    return `source:${record.package.infiniteCanvas.id}:${record.sourceId ?? record.package.version}`;
}

/**
 * 浏览器只读取 npm 包内预构建的客户端入口，不执行安装脚本或加载 Node 依赖。
 */
export function createBrowserPlugins(): PluginAdapter {
    const collection = storage.pluginData("plugin-manager");
    let pending: Promise<unknown> = Promise.resolve();
    const write = <T>(action: () => Promise<T>) => {
        const result = pending.then(action);
        pending = result.catch(() => {});
        return result;
    };
    const records = async () => (await collection.getItem<BrowserPlugin[]>("installed")) ?? [];
    const save = async (before: BrowserPlugin[], after: BrowserPlugin[]) => {
        await collection.setItem("installed", after);
        const retained = new Set(after.map(sourceKey));
        for (const item of before) {
            if (!retained.has(sourceKey(item))) {
                for (const key of [sourceKey(item), ...(item.clientFiles?.files ?? []).filter(file => file !== item.package.infiniteCanvas.client).map(file => `${sourceKey(item)}:${file}`)]) {
                    await collection.removeItem(key).catch((error) => console.error("[plugins] package file cleanup failed", error));
                }
            }
        }
    };
    const config = async () => (await collection.getItem<PluginRegistryConfig>("config")) ?? { registry: DEFAULT_PLUGIN_REGISTRY };
    const fetchResource = async (url: string, signal?: AbortSignal) => {
        const response = await fetch(network.url(url), { signal });
        if (!response.ok) throw new PluginError("PLUGIN_DOWNLOAD_FAILED");
        return response;
    };
    const readArchive = async (bytes: Uint8Array, signal?: AbortSignal) => {
        signal?.throwIfAborted();
        let files: Map<string, Uint8Array>;
        try {
            const tar = await new Response(new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
            files = pluginArchiveFiles(await unpackTar(tar));
        } catch (error) {
            throw error instanceof PluginError ? error : new PluginError("PLUGIN_PACKAGE_INVALID", { cause: error });
        }
        signal?.throwIfAborted();
        return { pkg: readPluginArchive(files), files };
    };
    const archiveRecord = async (bytes: Uint8Array, registry: string, signal?: AbortSignal, expectedName?: string) => {
        const { pkg, files: archive } = await readArchive(bytes, signal);
        if (expectedName && pkg.name !== expectedName) throw new PluginError("PLUGIN_INVALID");
        const token = crypto.randomUUID();
        const record: BrowserPlugin = { package: pkg, registry, enabled: true, installedAt: new Date().toISOString(), sourceId: token, uploaded: registry === "" };
        const files = new Map<string, Blob>();
        const entry = pkg.infiniteCanvas.client;
        const source = new TextDecoder().decode(archive.get(entry));
        const index = archive.get(`${entry}.files.json`);
        record.clientFiles = readPluginClientFiles(pkg, token, index && JSON.parse(new TextDecoder().decode(index)));
        for (const file of record.clientFiles.files) {
            if (file === entry) continue;
            const data = archive.get(file);
            if (!data) throw new PluginError("PLUGIN_INVALID");
            files.set(file, new Blob([new Uint8Array(data)], { type: mime.getType(file) || "application/octet-stream" }));
        }
        record.assets = {};
        for (const kind of ["icon", "readme"] as const) {
            const file = pkg.infiniteCanvas[kind];
            if (!file) continue;
            const asset = archive.get(file)!;
            record.assets[kind] = kind === "readme" ? new TextDecoder().decode(asset) : `data:${mime.getType(file)};base64,${btoa(Array.from(asset, (byte) => String.fromCharCode(byte)).join(""))}`;
        }
        return { record, files, source };
    };
    const commit = (record: BrowserPlugin, files: Map<string, Blob>, source: string, signal?: AbortSignal) => write(async () => {
        signal?.throwIfAborted();
        const latest = await records();
        assertPluginConflicts(latest, record);
        record.enabled = latest.find((item) => item.package.infiniteCanvas.id === record.package.infiniteCanvas.id)?.enabled ?? true;
        const after = [...latest.filter((item) => item.package.infiniteCanvas.id !== record.package.infiniteCanvas.id), record];
        const key = sourceKey(record);
        try {
            await collection.setItem(key, source);
            for (const [file, blob] of files) await collection.setItem(`${key}:${file}`, blob);
            signal?.throwIfAborted();
            await save(latest, after);
        } catch (error) {
            await Promise.allSettled([key, ...Array.from(files.keys(), file => `${key}:${file}`)].map(file => collection.removeItem(file)));
            throw error;
        }
        return record;
    });
    return {
        list: records,
        config,
        index: async () => fetchPluginIndex(fetchResource, (await config()).registry),
        configure: (value) => write(async () => { await collection.setItem("config", pluginRegistrySchema.parse(value)); }),
        install: async (request: PluginInstall, signal) => {
            try {
                const previous = (await records()).find((item) => item.package.name === request.name);
                const registry = previous?.registry || (await config()).registry;
                const { bytes } = await fetchPluginTarball(fetchResource, registry, request, signal);
                const { record, files, source } = await archiveRecord(bytes, registry, signal, request.name);
                return await commit(record, files, source, signal);
            } catch (error) {
                if (signal?.aborted) throw error;
                if (error instanceof PluginError && error.code === "PLUGIN_PACKAGE_INVALID") throw new PluginError("PLUGIN_INVALID");
                console.error("[plugins] npm installation failed", error);
                throw error instanceof PluginError ? error : new PluginError("PLUGIN_INSTALL_FAILED", { cause: error });
            }
        },
        inspectPackage: async (bytes: Uint8Array): Promise<PluginPackageInfo> => {
            if (bytes.byteLength > PLUGIN_PACKAGE_MAX_BYTES) throw new PluginError("PLUGIN_PACKAGE_TOO_LARGE");
            const { pkg } = await readArchive(bytes);
            return { id: pkg.infiniteCanvas.id, name: pkg.name, version: pkg.version };
        },
        installPackage: async (bytes, signal) => {
            try {
                if (bytes.byteLength > PLUGIN_PACKAGE_MAX_BYTES) throw new PluginError("PLUGIN_PACKAGE_TOO_LARGE");
                const { record, files, source } = await archiveRecord(bytes, "", signal);
                return await commit(record, files, source, signal);
            } catch (error) {
                if (signal?.aborted) throw error;
                console.error("[plugins] package installation failed", error);
                throw error instanceof PluginError ? error : new PluginError("PLUGIN_INSTALL_FAILED", { cause: error });
            }
        },
        remove: (id) => write(async () => {
            const before = await records();
            await save(before, before.filter((item) => item.package.infiniteCanvas.id !== id));
        }),
        enable: (id, enabled) => write(async () => {
            const before = await records();
            const current = before.find((item) => item.package.infiniteCanvas.id === id);
            if (!current) throw new PluginError("PLUGIN_NOT_FOUND");
            await save(before, before.map((item) => item === current ? { ...item, enabled } : item));
        }),
        source: async (id, version, generation) => {
            const record = (await records()).find((item) => item.package.infiniteCanvas.id === id);
            if (!record || record.package.version !== version || generation !== undefined && generation !== record.clientFiles?.generation) throw new PluginError("PLUGIN_NOT_FOUND");
            const source = await collection.getItem<string>(sourceKey(record));
            if (source === null) throw new PluginError("PLUGIN_NOT_FOUND");
            return source;
        },
        async clientFile(expected, path) {
            const pkg = expected.package;
            const record = (await records()).find(item => item.package.infiniteCanvas.id === pkg.infiniteCanvas.id);
            if (!record?.clientFiles || record.package.name !== pkg.name || record.package.version !== pkg.version || record.clientFiles.generation !== expected.clientFiles?.generation || !record.clientFiles.files.includes(path)) throw new PluginError("PLUGIN_NOT_FOUND");
            if (path === record.package.infiniteCanvas.client) {
                const source = await collection.getItem<string>(sourceKey(record));
                if (source === null) throw new PluginError("PLUGIN_NOT_FOUND");
                return new Blob([source], { type: "text/javascript" });
            }
            const file = await collection.getItem<Blob>(`${sourceKey(record)}:${path}`);
            if (!(file instanceof Blob)) throw new PluginError("PLUGIN_NOT_FOUND");
            return file;
        },
        asset: async (id, version, kind, generation) => {
            const record = (await records()).find((item) => item.package.infiniteCanvas.id === id);
            const asset = record?.assets?.[kind];
            if (!record || record.package.version !== version || generation !== undefined && generation !== record.clientFiles?.generation || asset === undefined) throw new PluginError("PLUGIN_NOT_FOUND");
            return asset;
        },
    };
}
