import localforage from "localforage";
import type { StorageAdapter, StorageCollection } from "@infinite-canvas/shared/storage";
import { canvasDocumentSchema, sameCanvasVideoRun, type CanvasDocument, type PluginStandaloneWork } from "@infinite-canvas/shared/canvas/schema/canvas";
import { pluginSyncStorageKey } from "@infinite-canvas/shared/sync-data";
import { applyAssetEdits, assetLibraryEditsSchema, assetLibraryKey } from "@infinite-canvas/shared/sync-records";
import { canCompareWorkSync, nextRecordUpdatedAt, sameWorkOwner, serializeStandaloneWork, storedWorkSyncRecord, StorageError, workSyncChangeSchema } from "@infinite-canvas/shared/storage-data";
import { appDatabase, browserStorageTransaction, pluginDataDatabase, pluginFilesDatabase, readIDBRequest } from "@workbench/utils/indexed-db";
import { createBrowserChats } from "./browser-chats";
import { browserStores, pluginOwnerStore, pluginVideoTaskStore, prepareBrowserStorage } from "./browser-stores";
import { readPluginVideoReceipt, savePluginVideoReceipt } from "./browser-plugin-video-tasks";
import { installBrowserArchive } from "./browser-archive";

type StoredWork = PluginStandaloneWork & { updatedAt?: string };
function businessWork({ updatedAt, ...work }: StoredWork): PluginStandaloneWork { return work; }

function removeCanvasTasks(key?: string) {
    return browserStorageTransaction([pluginVideoTaskStore], "readwrite", async (tx) => {
        tx.objectStore(pluginVideoTaskStore).delete(IDBKeyRange.bound(key === undefined ? ["canvas"] : ["canvas", key], key === undefined ? ["canvas", []] : ["canvas", key, []]));
    });
}

export function createBrowserStorage(): StorageAdapter {
    const instances = new Map<string, LocalForage>();
    function open(name: string, storeName: string) {
        const id = name + "/" + storeName;
        if (!instances.has(id)) instances.set(id, localforage.createInstance({ name, storeName, driver: localforage.INDEXEDDB }));
        return instances.get(id)!;
    }
    const app = (name: string) => open(appDatabase, browserStores[name]);
    const pluginData = (owner: string) => open(pluginDataDatabase, pluginOwnerStore(owner));
    const pluginFiles = (owner: string) => open(pluginFilesDatabase, pluginOwnerStore(owner));
    const projects = app("projects"), works = app("works"), state = app("state"), preferences = app("preferences");
    const images = app("images"), media = app("media"), chats = app("chats");

    async function writeWork(key: string, value: unknown, operation: "create" | "save" | { expected: Parameters<typeof canCompareWorkSync>[1]; updatedAt: string }) {
        const work = serializeStandaloneWork(key, value);
        const existing = await works.getItem<StoredWork>(key);
        if (existing && operation === "create") return sameWorkOwner(existing, work) && existing.title === work.title;
        if (typeof operation === "object") {
            const current = existing ? storedWorkSyncRecord(key, businessWork(existing), existing.updatedAt) : null;
            if (!canCompareWorkSync(current, operation.expected, { id: key, work, updatedAt: operation.updatedAt })) return false;
        } else if (existing && !sameWorkOwner(existing, work)) throw new StorageError("STORAGE_INVALID");
        await works.setItem(key, { ...work, updatedAt: typeof operation === "object" ? operation.updatedAt : nextRecordUpdatedAt(existing?.updatedAt) });
        return true;
    }

    return {
        kind: "browser",
        pluginVideoTasks: { prepare: prepareBrowserStorage, read: readPluginVideoReceipt, save: savePluginVideoReceipt },
        async canvasVideoConnection(task, identity, originalFingerprint) {
            const key = ["canvas", task.projectId, task.nodeId, task.runId];
            const write = originalFingerprint !== undefined;
            return browserStorageTransaction(write ? [pluginVideoTaskStore, browserStores.projects] : [pluginVideoTaskStore], write ? "readwrite" : "readonly", async (tx) => {
                const proofs = tx.objectStore(pluginVideoTaskStore);
                const proof = await readIDBRequest(proofs.get(key));
                if (proof !== undefined) return proof.identity === identity && typeof proof.fingerprint === "string" && (!write || proof.fingerprint === originalFingerprint) ? proof.fingerprint : null;
                if (!write) return null;
                const doc: CanvasDocument | undefined = await readIDBRequest(tx.objectStore(browserStores.projects).get(task.projectId));
                const bound = doc?.nodes.find((node) => node.id === task.nodeId && node.type === "video")?.metadata?.webVideoTask;
                if (!bound || doc?.id !== task.projectId || !sameCanvasVideoRun(bound, task)) return null;
                proofs.add({ identity, fingerprint: originalFingerprint }, key);
                return originalFingerprint;
            });
        },
        state,
        async editAssetLibrary(edits) {
            const patch = assetLibraryEditsSchema.safeParse(structuredClone(edits));
            if (!patch.success) throw new StorageError("STORAGE_INVALID");
            const raw = await state.getItem<string>(assetLibraryKey);
            await state.setItem(assetLibraryKey, JSON.stringify(applyAssetEdits(raw === null ? null : JSON.parse(raw), patch.data)));
        },
        projects: {
            getItem: projects.getItem.bind(projects), iterate: projects.iterate.bind(projects),
            async setItem(key, value) {
                const parsed = canvasDocumentSchema.safeParse(value);
                if (!parsed.success || parsed.data.id !== key) throw new StorageError("STORAGE_INVALID");
                await projects.setItem(key, structuredClone(value));
                return value;
            },
            async removeItem(key) {
                await projects.removeItem(key);
                await removeCanvasTasks(key);
            },
            async clear() {
                await projects.clear();
                await removeCanvasTasks();
            },
        },
        works: {
            async getItem<T>(key: string) {
                const stored = await works.getItem<StoredWork>(key);
                return stored ? businessWork(stored) as T : null;
            },
            iterate<T, R>(iterator: (value: T, key: string, index: number) => R) {
                return works.iterate<StoredWork, R>((stored, key, index) => iterator(businessWork(stored) as T, key, index));
            },
            async syncRecords() {
                const rows: [string, StoredWork][] = [];
                await works.iterate<StoredWork, void>((row, key) => { rows.push([key, row]); });
                return rows.map(([key, row]) => storedWorkSyncRecord(key, businessWork(row), row.updatedAt));
            },
            async compareSync(expected, next) {
                const change = workSyncChangeSchema.safeParse({ expected, next });
                if (!change.success) throw new StorageError("STORAGE_INVALID");
                return writeWork(next.id, next.work, { expected: structuredClone(change.data.expected), updatedAt: next.updatedAt });
            },
            removeItem: (key) => works.removeItem(key),
            clear: () => works.clear(),
            create: (work) => writeWork(work.workId, work, "create"),
            async setItem(key, value) {
                await writeWork(key, value, "save");
                return value;
            },
        },
        preferences,
        images, previews: app("previews"), media,
        imageRecords: app("imageRecords"), videoRecords: app("videoRecords"), audioRecords: app("audioRecords"),
        agentRecords: app("agentRecords") as StorageCollection,
        chats: createBrowserChats(chats, projects),
        installArchive: installBrowserArchive({ projects, works, chats, preferences, images, media, pluginFiles }),
        pluginFiles,
        pluginData,
        async comparePluginSyncData(owner, domainId, expected, next) {
            if (!domainId.startsWith(owner + ":")) throw new StorageError("STORAGE_INVALID");
            const key = pluginSyncStorageKey(domainId), store = pluginData(owner);
            const current = await store.getItem<{ dataVersion?: unknown }>(key);
            if (JSON.stringify(current ?? null) !== JSON.stringify(expected)) return false;
            if (current && current.dataVersion !== next.dataVersion) throw new StorageError("STORAGE_INVALID");
            await store.setItem(key, structuredClone(next));
            return true;
        },
    };
}
