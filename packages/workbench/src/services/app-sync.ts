import { z } from "zod";
import { SyncTransportError, type PluginSyncProgress, type SyncTransport } from "@infinite-canvas/plugin-sdk";
import { canvasDocumentSchema, type CanvasDocument } from "@infinite-canvas/shared/canvas/schema/canvas";
import { applyOps } from "@infinite-canvas/shared/canvas/ops/apply";
import { mapCanvasResources, mapWorkResources } from "@infinite-canvas/shared/canvas/ops/archive-resources";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { chatSyncRecordSchema, sameChatSyncRecord, sameWorkOwner, sameWorkSyncRecord, StorageError, workSyncRecordSchema, type ChatSyncRecord, type WorkSyncRecord } from "@infinite-canvas/shared/storage-data";
import { chatImageKeys } from "@infinite-canvas/shared/chat";
import { archiveResourceId, type ArchiveResource } from "@infinite-canvas/shared/work-archive";
import { serializeAsset } from "@workbench/lib/asset-utils";
import { assetResources, assetSchema, generationResources, portableGenerationRecord, type StoredGenerationRecord } from "@infinite-canvas/shared/sync-records";
import { cloneNodeForCopy } from "@workbench/lib/canvas/node-copy";
import { applySyncedWork, readWorkSyncRecords } from "@workbench/lib/plugins/standalone-works";
import { flushAssetWrites, readAssetsForSync, useAssetStore, type Asset } from "@workbench/stores/use-asset-store";
import { initialPreferences, useCanvasStore, type CanvasDeletedProject, type CanvasProject } from "@workbench/stores/canvas/use-canvas-store";
import { storage } from "./storage/runtime";
import { prepareSyncFiles, syncBatch, syncFileSchema, type FileSource } from "./sync-files";

export type AppSyncProgress = (event: PluginSyncProgress) => void;
type SyncEntry = { id: string; title: string };
const syncDomains: SyncEntry[] = [{ id: "builtin:canvas", title: "画布" }, { id: "builtin:assets", title: "我的资产" }, { id: "builtin:image-workbench", title: "图片创作" }, { id: "builtin:video-workbench", title: "视频创作" }, { id: "builtin:audio-workbench", title: "音频创作" }, { id: "builtin:works", title: "独立作品" }, { id: "builtin:chats", title: "画布聊天" }];
type Snapshot<T> = { records: T[]; deleted: CanvasDeletedProject[] };
type Domain<T extends { id: string }> = {
    field: "projects" | "assets" | "logs" | "records" | "works" | "threads";
    local(): Promise<Snapshot<T>>;
    portable(value: unknown): T;
    decode?(data: Record<string, unknown>): Snapshot<T>;
    time(record: T): number;
    same?(a: T, b: T): boolean;
    preferLocal?(local: T, remote: T): boolean;
    reconcile?(record: T): T;
    published?(records: T[], deleted: CanvasDeletedProject[]): void;
    count?(records: T[]): number;
    resources(record: T): ArchiveResource[];
    apply(records: T[], deleted: CanvasDeletedProject[], remoteIds: Set<string>, before: Snapshot<T>): Promise<void>;
    confirm?(): Promise<void>;
};
const manifestSchema = z.object({
    app: z.literal("infinite-canvas"), version: z.literal(2), domain: z.string(), exportedAt: z.string(),
    data: z.record(z.unknown()), files: z.array(syncFileSchema),
}).strict();
const deletionSchema = z.array(z.object({ id: z.string().min(1), deletedAt: z.string().refine((time) => Number.isFinite(Date.parse(time))) }).strict());

const canvas: Domain<CanvasDocument> = {
    field: "projects",
    async local() {
        const state = useCanvasStore.getState();
        if (state.loadError || Object.keys(state.projectDeletions).length) throw new StorageError("STORAGE_UNAVAILABLE");
        return { records: state.projects, deleted: state.deletedProjects };
    },
    portable(value) {
        const parsed = canvasDocumentSchema.safeParse(value);
        if (!parsed.success) throw new StorageError("STORAGE_INVALID");
        const { schemaVersion, id, title, createdAt, updatedAt, nodes, connections, pluginDomains } = value as CanvasDocument;
        const document = { schemaVersion, id, title, createdAt, updatedAt, nodes: nodes.map(cloneNodeForCopy), connections, ...(pluginDomains && { pluginDomains }) };
        applyOps({ nodes: [], connections: [] }, [{ type: "replace_graph", graph: document }]);
        return mapCanvasResources(document, (ref) => ref.key);
    },
    resources(document) {
        const refs: ArchiveResource[] = [];
        mapCanvasResources(document, (ref) => { refs.push(ref); return ref.key; });
        return refs;
    },
    time: (project) => Date.parse(project.updatedAt),
    async apply(records, deleted, remoteIds, before) {
        const state = useCanvasStore.getState();
        if (state.projects !== before.records || state.deletedProjects !== before.deleted) throw new PluginError("PLUGIN_CONFLICT");
        const projects = records.map((record) => {
            if (!remoteIds.has(record.id)) return record as CanvasProject;
            const { viewport, backgroundMode, showImageInfo } = state.openProject(record.id) ?? initialPreferences;
            return { ...record, viewport, backgroundMode, showImageInfo };
        });
        state.replaceProjects(projects, deleted);
    },
    confirm: () => useCanvasStore.getState().flush(),
};
const assets: Domain<Asset> = {
    field: "assets",
    async local() {
        return { records: await readAssetsForSync(), deleted: [] };
    },
    portable(value) {
        const parsed = assetSchema.safeParse(value);
        if (!parsed.success) throw new StorageError("STORAGE_INVALID");
        return serializeAsset(parsed.data);
    },
    time: (asset) => Date.parse(asset.updatedAt), resources: assetResources,
    async apply(records, _deleted, _remote, before) {
        if (useAssetStore.getState().assets !== before.records) throw new PluginError("PLUGIN_CONFLICT");
        await useAssetStore.getState().replaceAssets(records, true);
    },
    confirm: flushAssetWrites,
};

function works(signal: AbortSignal): Domain<WorkSyncRecord> {
    return {
        field: "works",
        async local() { return { records: await readWorkSyncRecords(), deleted: [] }; },
        portable: (value) => workSyncRecordSchema.parse(value),
        time: (record) => Date.parse(record.updatedAt),
        same: sameWorkSyncRecord,
        preferLocal(local, remote) {
            if (!sameWorkOwner(local.work, remote.work) ||
                (Date.parse(local.updatedAt) === Date.parse(remote.updatedAt) && !sameWorkSyncRecord(local, remote))) throw new PluginError("PLUGIN_CONFLICT");
            return Date.parse(local.updatedAt) >= Date.parse(remote.updatedAt);
        },
        resources(record) {
            const refs: ArchiveResource[] = [];
            mapWorkResources(record.work, (ref) => { refs.push(ref); return ref.key; });
            return refs;
        },
        async apply(records, _deleted, remoteIds, before) {
            const previous = new Map(before.records.map((record) => [record.id, record]));
            await syncBatch(records.filter((record) => remoteIds.has(record.id)), signal, (record) => applySyncedWork(previous.get(record.id) ?? null, record, signal));
        },
    };
}

async function chats(parents: ReadonlyMap<string, string | null>, signal: AbortSignal): Promise<Domain<ChatSyncRecord>> {
    const { applySyncedChat, portableAgentThread, readChatSyncRecords } = await import("@workbench/stores/use-agent-chat-store");
    const usedParents = new Set<string>();
    function parentDeletion(id: string, tombstone: boolean) {
        const state = useCanvasStore.getState(), published = parents.get(id);
        if (state.loadError || state.projectDeletions[id]) throw new PluginError("PLUGIN_CONFLICT");
        if (published === undefined) {
            if (!tombstone || state.openProject(id) || state.deletedProjects.some((item) => item.id === id)) throw new PluginError("PLUGIN_CONFLICT");
            return null;
        }
        if (published === null) {
            if (!state.openProject(id)) throw new PluginError("PLUGIN_CONFLICT");
        } else {
            const current = state.deletedProjects.find((item) => item.id === id);
            if (!current || Date.parse(current.deletedAt) !== Date.parse(published)) throw new PluginError("PLUGIN_CONFLICT");
        }
        return published;
    }
    function portable(value: unknown): ChatSyncRecord {
        const record = chatSyncRecordSchema.parse(value);
        return record.thread ? { ...record, thread: portableAgentThread(record.thread) } : record;
    }
    return {
        field: "threads", portable, same: sameChatSyncRecord,
        async local() {
            const records = await readChatSyncRecords();
            for (const id of usedParents) parentDeletion(id, true);
            return { records, deleted: [] };
        },
        time: (record) => Date.parse(record.updatedAt),
        preferLocal(local, remote) {
            if (local.projectId !== remote.projectId) throw new PluginError("PLUGIN_CONFLICT");
            const time = Date.parse(local.updatedAt) - Date.parse(remote.updatedAt);
            if (time !== 0) return time > 0;
            if (!local.thread) return true;
            if (!remote.thread) return false;
            if (parents.get(local.projectId)) return true;
            if (!sameChatSyncRecord(portable(local), remote)) throw new PluginError("PLUGIN_CONFLICT");
            return true;
        },
        reconcile(row) {
            usedParents.add(row.projectId);
            const deletedAt = parentDeletion(row.projectId, !row.thread);
            if (!deletedAt || (!row.thread && Date.parse(row.updatedAt) >= Date.parse(deletedAt))) return row;
            return { id: row.id, projectId: row.projectId, updatedAt: Date.parse(row.updatedAt) > Date.parse(deletedAt) ? row.updatedAt : deletedAt, thread: null };
        },
        resources({ thread }) {
            return thread ? Array.from(chatImageKeys(thread), (key) => ({ collection: "images" as const, key })) : [];
        },
        async apply(records, _deleted, remoteIds, before) {
            const previous = new Map(before.records.map((row) => [row.id, row]));
            await syncBatch(records.filter((row) => remoteIds.has(row.id)), signal, async (row) => {
                parentDeletion(row.projectId, !row.thread);
                await applySyncedChat(previous.get(row.id) ?? null, row, signal);
            });
        },
        count: (records) => records.filter((row) => row.thread !== null).length,
    };
}

function generations(kind: "image" | "video" | "audio", signal: AbortSignal): Domain<StoredGenerationRecord> {
    const store = kind === "image" ? storage.imageRecords : kind === "video" ? storage.videoRecords : storage.audioRecords;
    return {
        field: "logs",
        async local() {
            const records: StoredGenerationRecord[] = [];
            await store.iterate<StoredGenerationRecord, void>((record) => { records.push(record); });
            return { records, deleted: [] };
        },
        portable: (value) => portableGenerationRecord(kind, value), time: (log) => log.createdAt, resources: (log) => generationResources(kind, log),
        async apply(records, _deleted, remoteIds) {
            await syncBatch(records.filter((record) => remoteIds.has(record.id)), signal, async (record) => {
                await store.setItem(record.id, record);
            });
        },
    };
}

async function syncDomain<T extends { id: string }>(entry: SyncEntry, domain: Domain<T>, transport: SyncTransport, signal: AbortSignal, progress?: AppSyncProgress) {
    const wireId = entry.id.slice("builtin:".length);
    const root = wireId;
    const hasDeletions = domain.field === "projects";
    const conditionalRecords = domain.field === "works" || domain.field === "threads";
    const same = domain.same ?? ((a: T, b: T) => JSON.stringify(a) === JSON.stringify(b));
    function sameRecords(a: T[], b: T[]) {
        const byId = new Map(b.map((row) => [row.id, row]));
        return a.length === b.length && a.every((row) => byId.has(row.id) && same(row, byId.get(row.id)!));
    }
    const report = (stage: string, status: PluginSyncProgress["status"], current?: number, total?: number) => progress?.({ domain: entry.id, label: entry.title, stage, status, current, total });
    try {
        const path = `${root}/manifest.json`;
        signal.throwIfAborted();
        report("读取远端清单", "active");
        const downloaded = await transport.readManifest(path, signal);
        signal.throwIfAborted();
        const revision = downloaded?.revision;
        if (downloaded !== null && (typeof revision !== "string" || !revision.length || typeof downloaded?.blob?.text !== "function")) throw new SyncTransportError("REVISION_UNAVAILABLE");
        let remoteRecords: T[] = [];
        const remoteResources = new Set<string>();
        let remoteFiles: z.infer<typeof syncFileSchema>[] = [], remoteDeleted: CanvasDeletedProject[] = [];
        if (downloaded) {
            const bytes = await downloaded.blob.text();
            signal.throwIfAborted();
            try {
                const manifest = manifestSchema.parse(JSON.parse(bytes));
                if (manifest.domain !== wireId) throw new StorageError("STORAGE_INVALID");
                if (domain.decode) {
                    const snapshot = domain.decode(manifest.data);
                    remoteRecords = snapshot.records;
                    remoteDeleted = snapshot.deleted;
                } else {
                    const rows = manifest.data[domain.field];
                    if (!Array.isArray(rows) || Object.keys(manifest.data).length !== (hasDeletions ? 2 : 1)) throw new StorageError("STORAGE_INVALID");
                    if (hasDeletions) remoteDeleted = deletionSchema.parse(manifest.data.deleted);
                    remoteRecords = rows.map(domain.portable);
                }
                for (const row of remoteRecords) for (const ref of domain.resources(row)) remoteResources.add(archiveResourceId(ref));
                remoteFiles = manifest.files;
                if (remoteFiles.length !== remoteResources.size || remoteFiles.some(({ resource }) => !remoteResources.delete(archiveResourceId(resource)))) throw new StorageError("STORAGE_INVALID");
            } catch (error) { throw error instanceof PluginError ? error : new StorageError("STORAGE_INVALID"); }
        }
        report("读取本地数据", "active");
        const local = await domain.local();
        signal.throwIfAborted();
        const deleted = new Map<string, string>();
        for (const { id, deletedAt } of [...remoteDeleted, ...local.deleted]) {
            if (!deleted.has(id) || Date.parse(deletedAt) > Date.parse(deleted.get(id)!)) deleted.set(id, deletedAt);
        }
        const winners = new Map<string, { row: T; remote: boolean }>();
        for (const [records, remote] of [[remoteRecords, true], [local.records, false]] as const) {
            const ids = new Set<string>();
            for (const row of records) {
                const time = domain.time(row);
                if (!row.id || !Number.isFinite(time) || ids.has(row.id)) throw new StorageError("STORAGE_INVALID");
                ids.add(row.id);
                const previous = winners.get(row.id);
                if (!previous || (domain.preferLocal?.(row, previous.row) ?? (time >= domain.time(previous.row)))) winners.set(row.id, { row, remote });
            }
        }
        if (domain.reconcile) for (const winner of winners.values()) {
            const row = domain.reconcile(winner.row);
            if (row !== winner.row) {
                winner.row = row;
                winner.remote = true;
            }
        }
        const kept = [...winners.values()].filter(({ row }) => {
            const tombstone = deleted.get(row.id);
            if (!tombstone) return true;
            if (Date.parse(tombstone) >= domain.time(row)) return false;
            deleted.delete(row.id);
            return true;
        }).sort((a, b) => domain.time(b.row) - domain.time(a.row));
        const deletions = [...deleted].map(([id, deletedAt]) => ({ id, deletedAt }));
        const sources = new Map<string, FileSource>();
        const remoteById = new Map(remoteRecords.map((record) => [record.id, record]));
        const immutableFiles = conditionalRecords ? new Set(remoteFiles.map(({ resource }) => archiveResourceId(resource))) : undefined;
        const outgoing = kept.map(({ row, remote }) => {
            const portable = remote ? row : domain.portable(row);
            const previous = remoteById.get(row.id);
            const sameVersion = remote || (previous !== undefined && same(portable, previous));
            for (const ref of domain.resources(portable)) {
                const id = archiveResourceId(ref);
                const source = sources.get(id) ?? { resource: ref, local: false, remote: false, canRestore: true };
                if (remote) source.remote = true; else source.local = true;
                // 作品与会话的附件键指向不可变文件，两端都有同键时核对原件。
                if (immutableFiles?.has(id)) source.remote = true;
                if (!sameVersion) source.canRestore = false;
                sources.set(id, source);
            }
            return portable;
        });
        const prepared = await prepareSyncFiles(root, sources, remoteFiles, transport, signal, (count) => report("核对并同步文件", "active", count, sources.size));
        await prepared.install();
        const latest = await domain.local();
        signal.throwIfAborted();
        const unchanged = conditionalRecords ? sameRecords(latest.records, local.records) : JSON.stringify(latest) === JSON.stringify(local);
        if (!unchanged) throw new PluginError("PLUGIN_CONFLICT");
        if (downloaded || domain.reconcile) {
            const remoteIds = new Set(kept.filter((item) => item.remote).map(({ row }) => row.id));
            if (remoteIds.size || kept.length !== local.records.length || JSON.stringify(deletions) !== JSON.stringify(local.deleted)) {
                report("写入本地合并结果", "active");
                signal.throwIfAborted();
                await domain.apply(kept.map(({ row }) => row), deletions, remoteIds, latest);
            }
        }
        // 之前失败的写入可能已更新内存；即使本轮本地赢，也需等到原件及文档保存确认。
        await domain.confirm?.();
        async function confirmSnapshot() {
            const confirmed = await domain.local();
            signal.throwIfAborted();
            if (!sameRecords(confirmed.records.map(domain.portable), outgoing) ||
                JSON.stringify(confirmed.deleted) !== JSON.stringify(deletions)) throw new PluginError("PLUGIN_CONFLICT");
        }
        await confirmSnapshot();
        const data = { [domain.field]: outgoing, ...(hasDeletions && { deleted: deletions }) };
        const manifest = { app: "infinite-canvas", version: 2, domain: wireId, exportedAt: new Date().toISOString(), data, files: prepared.files };
        const file = new Blob([JSON.stringify(manifest)], { type: "application/json" });
        report("上传清单", "active");
        signal.throwIfAborted();
        await transport.publishManifest(path, file, revision ?? null, signal);
        signal.throwIfAborted();
        if (conditionalRecords) {
            await confirmSnapshot();
            signal.throwIfAborted();
        }
        domain.published?.(outgoing, deletions);
        report("完成", "success", 1, 1);
        return { id: entry.id, title: entry.title, count: domain.count?.(outgoing) ?? outgoing.length };
    } catch (error) {
        if (!signal.aborted) report("同步失败", "exception");
        throw error;
    }
}

export async function syncWorkspaceData(transport: SyncTransport, signal: AbortSignal, onProgress?: AppSyncProgress) {
    signal.throwIfAborted();
    if (typeof transport?.readManifest !== "function" || typeof transport.publishManifest !== "function") throw new SyncTransportError("REVISION_UNAVAILABLE");
    const entries = syncDomains;
    onProgress?.({ stage: "等待本地数据加载" });
    const parents = new Map<string, string | null>();
    const canvasEntry = entries.find((entry) => entry.id === "builtin:canvas");
    const canvasReceipt = canvasEntry && runEntry(canvasEntry);
    const operations = entries.map((entry) => entry === canvasEntry ? canvasReceipt! : runEntry(entry));
    async function runEntry(entry: SyncEntry) {
        const active = signal;
        const run = <T extends { id: string }>(domain: Domain<T>) => syncDomain(entry, domain, transport, active, onProgress);
        switch (entry.id) {
            case "builtin:canvas":
                await waitForHydration(useCanvasStore, active);
                return run({ ...canvas, published(records, deleted) {
                    for (const project of records) parents.set(project.id, null);
                    for (const project of deleted) parents.set(project.id, project.deletedAt);
                } });
            case "builtin:chats":
                if (!canvasReceipt) throw new PluginError("PLUGIN_CONTRACT_MISMATCH");
                await canvasReceipt;
                active.throwIfAborted();
                return run(await chats(parents, active));
            case "builtin:assets": await waitForHydration(useAssetStore, active); return run(assets);
            case "builtin:image-workbench": return run(generations("image", active));
            case "builtin:video-workbench": return run(generations("video", active));
            case "builtin:audio-workbench": return run(generations("audio", active));
            default: return run(works(active));
        }
    }
    const results = await Promise.allSettled(operations);
    signal.throwIfAborted();
    const domains = results.map((result) => { if (result.status === "rejected") throw result.reason; return result.value; });
    onProgress?.({ stage: "同步完成", status: "success" });
    return { syncedAt: new Date().toISOString(), domains };
}

function waitForHydration<T extends { hydrated: boolean; loadError: string }>(store: { getState: () => T; subscribe: (listener: (state: T) => void) => () => void }, signal: AbortSignal) {
    signal.throwIfAborted();
    const state = store.getState();
    if (state.loadError) return Promise.reject(new StorageError("STORAGE_UNAVAILABLE"));
    if (state.hydrated) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
        const abort = () => { unsubscribe(); reject(signal.reason); };
        const unsubscribe = store.subscribe((state) => {
            if (!state.hydrated && !state.loadError) return;
            unsubscribe();
            signal.removeEventListener("abort", abort);
            if (state.loadError) reject(new StorageError("STORAGE_UNAVAILABLE")); else resolve();
        });
        signal.addEventListener("abort", abort, { once: true });
    });
}
