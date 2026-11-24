import { createHash, randomUUID } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat, statfs, writeFile, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { tryLock } from "fs-native-extensions";
import { pipeline } from "node:stream/promises";
import { isDeepStrictEqual } from "node:util";
import { Readable } from "node:stream";
import { canvasDocumentSchema, type CanvasDocument, type PluginStandaloneWork } from "@infinite-canvas/shared/canvas/schema/canvas";
import {
    canCompareChatSync, canCompareWorkSync, chatSyncBaseline, nextRecordUpdatedAt, ordinaryChatWrite, projectDeletionSchema, sameChatSyncRecord, sameWorkOwner,
    serializeCanvasDocument, serializeStandaloneWork, serializeStorageData, storedChatSyncRecord, storedWorkSyncRecord, StorageError, workSyncBaseline,
    type ChatSyncRecord, type ProjectDeletion, type StorageChange, type StorageRecord, type WorkSyncRecord,
} from "@infinite-canvas/shared/storage-data";
import { storageCategoryInfo, type StorageCategoryUsage, type StorageEntry, type StorageUsage } from "@infinite-canvas/shared/storage-inspection";
import { collectStorageReferences, collectStringValues, referenceCollections, type StorageReference } from "@infinite-canvas/shared/resource-references";
import { logger } from "../utils/logger.js";
import { archiveResourceSchema, type ArchiveInstall, type ArchiveResource } from "@infinite-canvas/shared/work-archive";
import { applyAssetEdits, assetLibraryEditsSchema, type AssetLibraryEdits } from "@infinite-canvas/shared/sync-records";
import { readDiskJson, writeDiskJson } from "./records.js";
import { pluginSyncStorageKey, pluginSyncStoragePrefix, type PluginSyncDomainSnapshot } from "@infinite-canvas/shared/sync-data";
import { applyWorkspaceConfigMutation, defaultWorkspaceConfig, storedWorkspaceConfigSchema, type WorkspaceConfigMutation } from "@infinite-canvas/shared/workspace-config";

const directories: Record<string, string> = {
    projects: "projects", works: "works", library: "library", scripts: "scripts", state: "state", preferences: "preferences",
    imageRecords: "records/image", videoRecords: "records/video", audioRecords: "records/audio", agentRecords: "records/agent", chats: "chats",
    images: "assets/images", previews: "assets/previews", media: "assets/media", privateChannels: "private/channels", privateConfig: "private/config", task: "private/task",
};
export const publicStorageCollections = ["projects", "works", "library", "scripts", "state", "preferences", "imageRecords", "videoRecords", "audioRecords", "agentRecords", "chats", "images", "previews", "media"] as const;
const binaryDirectories = ["assets/images", "assets/previews", "assets/media"];
const recordDirectories = [...Object.values(directories).filter((directory) => !directory.startsWith("assets/") && !directory.startsWith("private/")), directories.task];
const pluginData = "plugins/data", pluginFiles = "plugins/files";
const extensions: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/svg+xml": "svg",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/webm": "weba",
};

/** 小写字母、数字、下划线和连字符组成的键直接作文件名，其余用哈希，避免非法字符、路径穿越和大小写不敏感文件系统上的冲突。 */
function safeName(key: string) {
    return /^[a-z0-9_-]{1,100}$/.test(key) ? key : createHash("sha256").update(key).digest("hex");
}

function binaryFile(base: string, mime: string) {
    return `${base}.${extensions[mime] ?? "bin"}`;
}

function isBinary(collection: string) {
    return collection === "images" || collection === "previews" || collection === "media" || collection.startsWith("plugin-files:");
}

async function readNames(directory: string) {
    return readdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
    });
}

/** 读取目录中的 .json 记录；二进制集合的 .json 是元数据，同名文件按 mime 后缀保存原件。 */
async function readRows(directory: string) {
    const names = (await readNames(directory)).filter((name) => name.endsWith(".json"));
    return Promise.all(names.map(async (name) => ({ base: path.join(directory, name.slice(0, -5)), row: JSON.parse(await readFile(path.join(directory, name), "utf8")) as StorageRecord })));
}

export class FsStorage {
    private queue: Promise<unknown> = Promise.resolve();
    private listeners = new Set<(event: StorageChange) => void>();
    private closing = false;
    private constructor(readonly directory: string, private readonly lock: FileHandle) {}

    static async open(directory: string) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const lock = await open(path.join(directory, ".canvas.lock"), "a+", 0o600);
        try {
            if (!tryLock(lock.fd)) throw new StorageError("WORKSPACE_LOCKED");
            const manifest = path.join(directory, "workspace.json");
            try {
                const data = JSON.parse(await readFile(manifest, "utf8"));
                if (data.schemaVersion !== 1) throw new StorageError("STORAGE_INVALID");
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                await writeFile(manifest, JSON.stringify({ schemaVersion: 1, id: randomUUID() }, null, 2), { mode: 0o600 });
            }
            return new FsStorage(directory, lock);
        } catch (error) {
            await lock.close();
            throw error;
        }
    }

    private collectionPath(collection: string) {
        const relative = collection.startsWith("plugin:") ? `${pluginData}/${safeName(collection.slice("plugin:".length))}` : collection.startsWith("plugin-files:") ? `${pluginFiles}/${safeName(collection.slice("plugin-files:".length))}` : directories[collection];
        if (!relative) throw new StorageError("STORAGE_INVALID");
        return path.join(this.directory, relative);
    }

    private recordPath(collection: string, key: string) {
        if (collection === "projects" && !/^[\w-]+$/.test(key)) throw new StorageError("STORAGE_INVALID");
        return path.join(this.collectionPath(collection), `${collection === "projects" ? key : safeName(key)}.json`);
    }

    private binaryPath(collection: string, key: string, mime: string) {
        return binaryFile(this.recordPath(collection, key).slice(0, -5), mime);
    }

    read<T = unknown>(collection: string, key: string) {
        return readDiskJson<StorageRecord<T>>(this.recordPath(collection, key));
    }

    async list(collection: string) {
        return (await readRows(this.collectionPath(collection))).map(({ row }) => row);
    }

    async inspectEntries(collection: string) {
        if (!publicStorageCollections.some((name) => name === collection)) throw new StorageError("STORAGE_INVALID");
        const records = (await this.list(collection)).filter((record) => record.value !== null);
        return Promise.all(records.map(async (record): Promise<StorageEntry> => {
            const binary = isBinary(collection);
            const file = binary ? this.binaryPath(collection, record.key, (record.value as { mime: string }).mime) : this.recordPath(collection, record.key);
            return { key: record.key, name: record.key, bytes: (await stat(file)).size, mimeType: binary ? (record.value as { mime: string }).mime : null };
        }));
    }

    inspectImagePreview(key: string) {
        return this.openAsset("previews", key);
    }

    /** 插件设置的正文不参与盘点，只解析以同步域信封开头的记录。 */
    private async listSyncDomains(collection: string) {
        const directory = this.collectionPath(collection), header = `{\n  "key": "${pluginSyncStoragePrefix}`;
        const texts = await Promise.all((await readNames(directory)).filter((name) => name.endsWith(".json")).map((name) => readFile(path.join(directory, name), "utf8")));
        return texts.filter((text) => text.startsWith(header)).map((text) => {
            try { return JSON.parse(text) as StorageRecord; }
            catch { throw new StorageError("STORAGE_INVALID"); }
        });
    }

    async inspectReferences(resource: ArchiveResource, signal?: AbortSignal) {
        if (!archiveResourceSchema.safeParse(resource).success) throw new StorageError("STORAGE_INVALID");
        const references: StorageReference[] = [];
        for (const collection of referenceCollections(resource)) {
            signal?.throwIfAborted();
            const rows = collection === "library" ? [await this.read("library", "state")] : collection.startsWith("plugin:") ? await this.listSyncDomains(collection) : await this.list(collection);
            for (const row of rows) if (row) references.push(...collectStorageReferences(resource, collection, row.key, row.value));
        }
        signal?.throwIfAborted();
        return references;
    }

    async inspectUsage(): Promise<StorageUsage> {
        const [files, disk] = await Promise.all([readFileSizes(this.directory), statfs(this.directory)]);
        const categories: StorageCategoryUsage[] = [];
        const takeFiles = (prefix: string) => {
            let bytes = 0;
            let records = 0;
            for (const [name, size] of files) {
                if (!name.startsWith(`${prefix}/`)) continue;
                bytes += size;
                records += 1;
                files.delete(name);
            }
            return { bytes, records };
        };
        for (const id of publicStorageCollections) {
            const records = (await this.list(id)).filter((record) => record.value !== null);
            categories.push({ id, ...storageCategoryInfo[id], bytes: takeFiles(directories[id]).bytes, records: records.length });
        }
        const pluginDataUsage = [takeFiles(pluginData), takeFiles(pluginFiles)];
        categories.push({ id: "pluginData", ...storageCategoryInfo.pluginData, bytes: pluginDataUsage[0].bytes + pluginDataUsage[1].bytes, records: pluginDataUsage[0].records + pluginDataUsage[1].records });
        for (const [id, directory] of [["private", "private"], ["pluginPackages", "plugins"]] as const) {
            categories.push({ id, ...storageCategoryInfo[id], ...takeFiles(directory) });
        }
        categories.push({ id: "other", ...storageCategoryInfo.other, bytes: [...files.values()].reduce((sum, size) => sum + size, 0), records: files.size });
        return {
            scope: "workspace", categories, contentBytes: categories.reduce((sum, category) => sum + category.bytes, 0),
            usedBytes: (disk.blocks - disk.bfree) * disk.bsize, totalBytes: disk.blocks * disk.bsize, availableBytes: disk.bavail * disk.bsize,
        };
    }

    /** 删除没有被任何记录引用的原件及缩略图，返回删除的文件数与字节数。 */
    cleanup() {
        return this.commit(async () => {
            const subdirectories = async (parent: string) => (await readNames(path.join(this.directory, parent))).map((name) => path.join(parent, name));
            const [dataDirectories, fileDirectories] = await Promise.all([subdirectories(pluginData), subdirectories(pluginFiles)]);
            const used = new Set<string>();
            for (const directory of [...recordDirectories, ...dataDirectories]) {
                for (const { row } of await readRows(path.join(this.directory, directory))) collectStringValues(row.value, used);
            }
            let files = 0, bytes = 0;
            for (const directory of [...binaryDirectories, ...fileDirectories]) {
                for (const { base, row } of await readRows(path.join(this.directory, directory))) {
                    if (used.has(row.key)) continue;
                    const file = binaryFile(base, (row.value as { mime: string }).mime);
                    bytes += (await stat(file)).size;
                    files += 1;
                    await rm(`${base}.json`);
                    await rm(file);
                }
            }
            return { files, bytes };
        });
    }

    private commit<T>(operation: () => Promise<T>) {
        if (this.closing) return Promise.reject(new StorageError("STORAGE_UNAVAILABLE"));
        const pending = this.queue.then(operation);
        this.queue = pending.catch(() => undefined);
        return pending;
    }

    private async replace(collection: string, record: StorageRecord, clientId: string) {
        await writeDiskJson(this.recordPath(collection, record.key), record);
        this.notify(collection, record.key, clientId);
        return record;
    }

    private notify(collection: string, key: string, clientId: string) {
        const event = { collection, key, clientId };
        for (const listener of this.listeners) {
            try { listener(event); }
            catch (error) { logger.error("存储变更通知失败", { collection, key, error }); }
        }
    }

    installArchive(install: ArchiveInstall, clientId: string) {
        return this.commit(async () => {
            const { target } = install;
            const [collection, key] = target.kind === "canvas" ? ["projects", target.document.id] : ["works", target.work.workId];
            if ((await this.read(collection, key))?.value) return;
            for (const { resource, blob } of install.files) {
                const owner = resource.collection === "plugin-files" ? `plugin-files:${resource.owner}` : resource.collection;
                await this.writeAsset(owner, resource.key, Readable.from(Buffer.from(await blob.arrayBuffer())), blob.type, clientId);
            }
            if (target.kind === "canvas") {
                for (const thread of target.threads) await this.replace("chats", { key: thread.id, value: thread }, clientId);
                await this.replace(collection, { key, value: serializeCanvasDocument(target.document) }, clientId);
            } else await this.replace(collection, { key, value: serializeStandaloneWork(key, target.work), updatedAt: nextRecordUpdatedAt() }, clientId);
        });
    }

    createWork(key: string, value: unknown, clientId: string) {
        const work = serializeStandaloneWork(key, value);
        return this.commit(async () => {
            const previous = (await this.read<PluginStandaloneWork>("works", key))?.value;
            if (previous) return sameWorkOwner(previous, work) && previous.title === work.title;
            await this.replace("works", { key, value: work, updatedAt: nextRecordUpdatedAt() }, clientId);
            return true;
        });
    }

    compareWorkSync(key: string, expected: string | null, next: WorkSyncRecord, clientId: string) {
        if (key !== next.id) throw new StorageError("STORAGE_INVALID");
        return this.commit(async () => {
            const record = await this.read<PluginStandaloneWork>("works", key);
            const current = record?.value == null ? null : storedWorkSyncRecord(key, record.value, record.updatedAt);
            const digest = current && createHash("sha256").update(workSyncBaseline(current)).digest("hex");
            if (digest !== expected || !canCompareWorkSync(current, current, next)) return false;
            await this.replace("works", { key, value: next.work, updatedAt: next.updatedAt }, clientId);
            return true;
        });
    }

    writeChat(key: string, next: ChatSyncRecord | null, clientId: string, expected?: string | null) {
        if (next && next.id !== key) throw new StorageError("STORAGE_INVALID");
        return this.commit(async () => {
            const raw = await this.read("chats", key);
            const current = raw && storedChatSyncRecord(raw);
            let record = next;
            if (expected !== undefined) {
                const digest = current && createHash("sha256").update(chatSyncBaseline(current)).digest("hex");
                if (!next || expected !== digest || !canCompareChatSync(current, current, next)) return false;
                if (next.thread && (await this.read<CanvasDocument>("projects", next.projectId))?.value?.id !== next.projectId) return false;
            } else record = ordinaryChatWrite(current, next);
            if (record && (!current || !sameChatSyncRecord(current, record))) {
                return this.replace("chats", { key, value: record.thread, ...(!record.thread && { projectId: record.projectId, deletedAt: record.updatedAt }) }, clientId);
            }
            return raw ?? { key, value: null };
        });
    }

    updateWorkspaceConfig(change: WorkspaceConfigMutation, clientId: string) {
        return this.commit(async () => {
            const previous = await this.read("privateConfig", "workspace");
            const parsed = storedWorkspaceConfigSchema.safeParse(previous?.value ?? defaultWorkspaceConfig);
            if (!parsed.success) throw new StorageError("STORAGE_INVALID");
            const next = applyWorkspaceConfigMutation(parsed.data, change);
            if (!next) return false;
            await this.replace("privateConfig", { key: "workspace", value: next }, clientId);
            return true;
        });
    }

    comparePluginSyncData(owner: string, domainId: string, expected: string | null, next: PluginSyncDomainSnapshot, clientId: string) {
        return this.commit(async () => {
            if (!domainId.startsWith(owner + ":")) throw new StorageError("STORAGE_INVALID");
            const collection = "plugin:" + owner, key = pluginSyncStorageKey(domainId);
            const current = (await this.read<PluginSyncDomainSnapshot>(collection, key))?.value;
            const digest = current == null ? null : createHash("sha256").update(JSON.stringify(current)).digest("hex");
            if (digest !== expected) return false;
            if (current && current.dataVersion !== next.dataVersion) throw new StorageError("STORAGE_INVALID");
            await this.replace(collection, { key, value: next }, clientId);
            return true;
        });
    }

    deleteProject(key: string, deletion: ProjectDeletion, clientId: string) {
        return this.commit(async () => {
            if (!projectDeletionSchema.safeParse(deletion).success || (deletion.expectedDocument && deletion.expectedDocument.id !== key)) throw new StorageError("STORAGE_INVALID");
            const current = await this.read<CanvasDocument>("projects", key);
            if (deletion.deletedAt !== undefined) {
                if (current && (current.deletedAt === deletion.deletedAt || Date.parse(current.value?.updatedAt ?? current.deletedAt!) > Date.parse(deletion.deletedAt))) return current;
            } else if (current && (current.value === null || (deletion.expectedDocument !== undefined && !isDeepStrictEqual(deletion.expectedDocument, current.value)))) {
                return current;
            }
            return this.replace("projects", { key, value: null, deletedAt: deletion.deletedAt ?? new Date().toISOString() }, clientId);
        });
    }

    save(collection: string, key: string, value: unknown, clientId: string) {
        if (isBinary(collection)) return Promise.reject(new StorageError("STORAGE_INVALID"));
        if (collection === "projects" && value === null) return this.deleteProject(key, {}, clientId);
        if (collection === "chats") return this.writeChat(key, value === null ? null : storedChatSyncRecord({ key, value: structuredClone(value) }), clientId).then((record) => {
            if (!record) throw new StorageError("STORAGE_INVALID");
            return record;
        });
        return this.commit(async () => {
            let updatedAt: string | undefined;
            if (collection === "projects" && value !== null) {
                const result = canvasDocumentSchema.safeParse(value);
                if (!result.success || result.data.id !== key) throw new StorageError("STORAGE_INVALID");
                value = serializeCanvasDocument(value as CanvasDocument);
            } else if (collection === "works" && value !== null) {
                const work = serializeStandaloneWork(key, value);
                const previous = await this.read<PluginStandaloneWork>(collection, key);
                if (previous?.value && !sameWorkOwner(previous.value, work)) throw new StorageError("STORAGE_INVALID");
                value = work;
                updatedAt = nextRecordUpdatedAt(previous?.updatedAt);
            } else if (collection !== "library" && !collection.startsWith("plugin:") && !(collection === "privateConfig" && key === "workspace")) value = serializeStorageData(value);
            return this.replace(collection, { key, value, ...(updatedAt && { updatedAt }), ...(value === null && { deletedAt: new Date().toISOString() }) }, clientId);
        });
    }

    editAssetLibrary(edits: AssetLibraryEdits, clientId: string) {
        const change = assetLibraryEditsSchema.safeParse(structuredClone(edits));
        if (!change.success) return Promise.reject(new StorageError("STORAGE_INVALID"));
        return this.commit(async () => {
            const current = await this.read("library", "state");
            await this.replace("library", { key: "state", value: applyAssetEdits(current?.value ?? null, change.data) }, clientId);
        });
    }

    private async writeAsset(collection: string, key: string, source: Readable, mime: string, clientId: string) {
        if (!isBinary(collection)) throw new StorageError("STORAGE_INVALID");
        const target = this.binaryPath(collection, key, mime), temporary = `${target}.${randomUUID()}.tmp`;
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        try {
            await pipeline(source, createWriteStream(temporary, { mode: 0o600 }));
            await rename(temporary, target);
        } finally { await rm(temporary, { force: true }); }
        await writeDiskJson(this.recordPath(collection, key), { key, value: { mime } });
        this.notify(collection, key, clientId);
    }

    saveAsset(collection: string, key: string, source: Readable, mime: string, clientId: string) {
        return this.commit(() => this.writeAsset(collection, key, source, mime, clientId));
    }

    removeAsset(collection: string, key: string, clientId: string) {
        return this.commit(async () => {
            if (!isBinary(collection)) throw new StorageError("STORAGE_INVALID");
            const record = await this.read<{ mime: string }>(collection, key);
            await rm(this.recordPath(collection, key), { force: true });
            if (record?.value) await rm(this.binaryPath(collection, key, record.value.mime), { force: true });
            this.notify(collection, key, clientId);
        });
    }

    async openAsset(collection: string, key: string) {
        if (!isBinary(collection)) throw new StorageError("STORAGE_INVALID");
        const record = await this.read<{ mime: string }>(collection, key);
        if (!record?.value) return null;
        return { handle: await open(this.binaryPath(collection, key, record.value.mime), constants.O_RDONLY | constants.O_NOFOLLOW), mime: record.value.mime };
    }

    subscribe(listener: (event: StorageChange) => void) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    async close() {
        this.closing = true;
        try {
            await this.queue;
        } finally {
            this.listeners.clear();
            await this.lock.close();
        }
    }
}

async function readFileSizes(directory: string, prefix = ""): Promise<Map<string, number>> {
    const files = new Map<string, number>();
    for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            for (const [file, size] of await readFileSizes(directory, name)) files.set(file, size);
        } else if (entry.isFile()) {
            files.set(name, (await stat(path.join(directory, name))).size);
        }
    }
    return files;
}
