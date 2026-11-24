import { appDatabase } from "@workbench/utils/indexed-db";
import { requestStorage } from "@workbench/lib/storage-request";
import localforage from "localforage";
import type { StorageAdapter, StorageCollection } from "@infinite-canvas/shared/storage";
import { encodeArchiveInstall } from "@infinite-canvas/shared/work-archive";
import { sha256 } from "@infinite-canvas/shared/utils/sha256";
import type { CanvasDocument } from "@infinite-canvas/shared/canvas/schema/canvas";
import { chatSyncBaseline, serializeCanvasDocument, serializeStandaloneWork, serializeStorageData, storedChatSyncRecord, storedWorkSyncRecord, StorageError, workSyncBaseline, type ChatSyncRecord, type StorageChange, type StorageRecord, type StorageWrite, type WorkSyncRecord } from "@infinite-canvas/shared/storage-data";
import { reportStorageError } from "./status";
import { saveArchivePreferences } from "./browser-archive";
import { assetLibraryKey } from "@infinite-canvas/shared/sync-records";
import { openLocalSocket } from "@workbench/lib/local-socket";

export function createHttpStorage(): StorageAdapter {
    const clientId = crypto.randomUUID();
    const listeners = new Map<string, Set<(key: string | null) => void>>();
    const collections = new Map<string, StorageCollection>();
    const writes = new Map<string, Promise<unknown>>();
    const closeSocket = openLocalSocket("/api/storage/events", (type, data) => {
        if (type === "ready") return listeners.forEach((callbacks) => callbacks.forEach((listener) => listener(null)));
        const change = data as StorageChange;
        if (change.clientId === clientId) return;
        listeners.get(change.collection)?.forEach((listener) => listener(change.key));
    }, () => reportStorageError(new StorageError("STORAGE_UNAVAILABLE")));
    window.addEventListener("pagehide", closeSocket, { once: true });

    async function request(path: string, init?: RequestInit) {
        try {
            return await requestStorage(path, init);
        } catch (error) {
            const reason = error instanceof StorageError ? error : new StorageError("STORAGE_UNAVAILABLE");
            if (reason.code !== "STORAGE_FILE_EXISTS" && !path.startsWith("/api/storage/projects")) reportStorageError(reason);
            throw reason;
        }
    }

    function writeInOrder<T>(target: string | string[], action: () => Promise<T>): Promise<T> {
        const names = typeof target === "string" ? [target] : target;
        const pending = Promise.all(names.map((name) => writes.get(name))).then(action);
        const settled = pending.catch(() => undefined);
        for (const name of names) writes.set(name, settled);
        return pending;
    }

    function compareSync<T extends WorkSyncRecord | ChatSyncRecord>(name: "works" | "chats", expected: T | null, next: T, baseline: (record: T) => string) {
        if (expected && expected.id !== next.id) return Promise.reject(new StorageError("STORAGE_INVALID"));
        const path = `/api/storage/${name}/${encodeURIComponent(next.id)}/sync`;
        const before = expected && baseline(expected), snapshot = structuredClone(next);
        return writeInOrder(name, async () => {
            const digest = before === null ? null : await sha256(new TextEncoder().encode(before).buffer);
            return (await request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected: digest, next: snapshot, clientId }) })).json() as Promise<boolean>;
        });
    }

    function collection(name: string): StorageCollection {
        if (collections.has(name)) return collections.get(name)!;
        const endpoint = `/api/storage/${encodeURIComponent(name)}`;
        const binary = name === "images" || name === "previews" || name === "media" || name.startsWith("plugin-files:");
        const callbacks = new Set<(key: string | null) => void>();
        listeners.set(name, callbacks);
        async function read(key: string) {
            const record = await (await request(`${endpoint}/${encodeURIComponent(key)}`)).json() as StorageRecord | null;
            return record;
        }
        async function list() {
            const records = await (await request(endpoint)).json() as StorageRecord[];
            return records;
        }
        function write(key: string, value: unknown) {
            let snapshot = value;
            if (name === "works" && value !== null) snapshot = serializeStandaloneWork(key, value);
            else if (name === "library" || name.startsWith("plugin:")) snapshot = structuredClone(value);
            else if (!binary) snapshot = name === "projects" && value !== null ? serializeCanvasDocument(value as CanvasDocument) : serializeStorageData(value);
            return writeInOrder(name, async () => {
                if (binary) {
                    const path = `/api/assets/${encodeURIComponent(name)}/${encodeURIComponent(key)}`;
                    await request(path, snapshot === null ? { method: "DELETE", headers: { "x-canvas-client-id": clientId } }
                        : { method: "PUT", headers: { "x-canvas-client-id": clientId, "content-type": (snapshot as Blob).type }, body: snapshot as Blob });
                } else {
                    await request(`${endpoint}/${encodeURIComponent(key)}`, {
                        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: snapshot, clientId } satisfies StorageWrite),
                    });
                }
            });
        }
        const result: StorageCollection = {
            async getItem<T>(key: string) {
                if (binary) {
                    const response = await requestStorage(`/api/assets/${encodeURIComponent(name)}/${encodeURIComponent(key)}`, undefined, true);
                    return (response.status === 200 ? await response.blob() : null) as T | null;
                }
                const record = await read(key);
                return record && record.value !== null ? record.value as T : null;
            },
            async setItem<T>(key: string, value: T) { await write(key, value); return value; },
            async removeItem(key) { await write(key, null); },
            async clear() {
                const records = await list();
                for (const record of records) if (record.value !== null) await write(record.key, null);
            },
            async iterate<T, R>(iterator: (value: T, key: string, index: number) => R) {
                const records = await list();
                let index = 0;
                for (const record of records) {
                    if (record.value === null) continue;
                    const value = binary ? await (await request(`/api/assets/${encodeURIComponent(name)}/${encodeURIComponent(record.key)}`)).blob() : record.value;
                    const returned = iterator(value as T, record.key, ++index);
                    if (returned !== undefined) return returned;
                }
            },
            async tombstones() { return (await list()).filter((record) => record.value === null).map((record) => ({ key: record.key, deletedAt: record.deletedAt! })); },
            subscribe(listener) { callbacks.add(listener); return () => { callbacks.delete(listener); }; },
        };
        collections.set(name, result);
        return result;
    }
    const stateCollections: Record<string, string> = { [assetLibraryKey]: "library", "infinite-canvas:call_scripts": "scripts" };
    const state: StorageCollection = {
        async getItem<T>(key: string) {
            const value = await collection(stateCollections[key]).getItem("state");
            return value === null ? null : JSON.stringify(value) as T;
        },
        async setItem<T>(key: string, value: T) {
            await collection(stateCollections[key]).setItem("state", JSON.parse(value as string));
            return value;
        },
        async removeItem(key) { await collection(stateCollections[key]).removeItem("state"); },
        async clear() { for (const name of Object.values(stateCollections)) await collection(name).clear(); },
        async iterate<T, R>(iterator: (value: T, key: string, index: number) => R) {
            let index = 0;
            for (const key of Object.keys(stateCollections)) {
                const value = await state.getItem<T>(key);
                if (value !== null) { const result = iterator(value, key, ++index); if (result !== undefined) return result; }
            }
        },
    };
    const preferences = localforage.createInstance({ name: appDatabase, storeName: "device_preferences", driver: localforage.INDEXEDDB });
    return {
        editAssetLibrary(edits) {
            const body = JSON.stringify(edits);
            return writeInOrder("library", async () => {
                const response = await request("/api/storage/library/state", { method: "PATCH", headers: { "x-canvas-client-id": clientId, "content-type": "application/json" }, body });
                if (response.status !== 204) throw new StorageError("STORAGE_UNAVAILABLE");
            });
        },
        kind: "server", state, projects: {
            ...collection("projects"),
            deleteProject(key, deletion) {
                return writeInOrder("projects", async () => (await request(`/api/storage/projects/${encodeURIComponent(key)}`, {
                    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: null, clientId, deletion }),
                })).json() as Promise<StorageRecord<CanvasDocument>>);
            },
        },
        works: {
            ...collection("works"),
            async syncRecords() {
                const rows = await (await request("/api/storage/works")).json() as StorageRecord[];
                return rows.filter(({ value }) => value !== null).map(({ key, value, updatedAt }) => storedWorkSyncRecord(key, value, updatedAt));
            },
            compareSync: (expected, next) => compareSync("works", expected, next, workSyncBaseline),
            async create(work) {
                const snapshot = serializeStandaloneWork(work.workId, work);
                return writeInOrder("works", async () => (await request(`/api/storage/works/${encodeURIComponent(snapshot.workId)}`, {
                    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: snapshot, clientId } satisfies StorageWrite),
                })).json() as Promise<boolean>);
            },
        },
        preferences,
        images: collection("images"), previews: collection("previews"), media: collection("media"),
        agentRecords: collection("agentRecords"),
        imageRecords: collection("imageRecords"), videoRecords: collection("videoRecords"), audioRecords: collection("audioRecords"),
        chats: {
            ...collection("chats"),
            async setItem<T>(id: string, value: T) {
                const thread = structuredClone(storedChatSyncRecord({ key: id, value }).thread!);
                return writeInOrder("chats", async () => {
                    const response = await request(`/api/storage/chats/${encodeURIComponent(id)}`, {
                        method: "PUT", headers: { "content-type": "application/json", prefer: "return=minimal" },
                        body: JSON.stringify({ value: thread, clientId } satisfies StorageWrite),
                    });
                    const updatedAt = response.headers.get("x-canvas-updated-at");
                    if (!updatedAt) throw new StorageError("STORAGE_UNAVAILABLE");
                    return { ...thread, updatedAt } as T;
                });
            },
            async syncRecords() {
                const rows = await (await request("/api/storage/chats")).json() as StorageRecord[];
                return rows.map(storedChatSyncRecord);
            },
            compareSync: (expected, next) => compareSync("chats", expected, next, chatSyncBaseline),
            deleteThread(id, projectId, updatedAt) {
                return writeInOrder("chats", async () => {
                    await requestStorage(`/api/storage/chats/${encodeURIComponent(id)}/delete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, next: { id, projectId, updatedAt, thread: null } }) });
                });
            },
        },
        async installArchive(input, devicePreferences) {
            const [install, view] = structuredClone([input, devicePreferences] as const);
            const body = await encodeArchiveInstall(install, view);
            await request("/api/archive/install", {
                method: "POST", headers: { "content-type": "application/zip", "x-canvas-client-id": clientId }, body,
            });
            if (view && install.target.kind === "canvas") await saveArchivePreferences(preferences, install.target.document.id, view);
        },
        pluginFiles: (id) => collection(`plugin-files:${id}`),
        pluginData: (id) => collection(`plugin:${id}`),
        comparePluginSyncData(owner, domainId, expected, next) {
            const name = `plugin:${owner}`;
            const before = expected === null ? null : JSON.stringify(expected), snapshot = structuredClone(next);
            return writeInOrder(name, async () => {
                const digest = before === null ? null : await sha256(new TextEncoder().encode(before).buffer);
                const response = await request(`/api/storage/${encodeURIComponent(name)}/${encodeURIComponent(domainId)}/sync`, {
                    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected: digest, next: snapshot, clientId }),
                });
                return await response.json() as boolean;
            });
        },
    };
}
