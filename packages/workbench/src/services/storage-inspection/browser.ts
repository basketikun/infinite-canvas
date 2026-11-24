import { appDatabase, openDatabase, pluginDataDatabase, pluginFilesDatabase } from "@workbench/utils/indexed-db";
import localforage from "localforage";
import { collectStringValues } from "@infinite-canvas/shared/resource-references";
import { StorageError } from "@infinite-canvas/shared/storage-data";
import { storageCategoryInfo, type StorageCategoryUsage, type StorageEntry } from "@infinite-canvas/shared/storage-inspection";
import type { StorageInspectionAdapter } from "./runtime";
import { browserStores as stores, localforageBlobProbe, pluginVideoTaskStore } from "../storage/browser-stores";
import { browserResourceReferences } from "../storage/browser-references";

const unreferencedStores = ["images", "previews", "media", "promptCache"];

export function createBrowserStorageInspection(): StorageInspectionAdapter {
    return {
        async usage() {
            const [application, plugins, pluginFiles, estimate] = await Promise.all([
                readDatabaseUsage(appDatabase), readDatabaseUsage(pluginDataDatabase), readDatabaseUsage(pluginFilesDatabase), navigator.storage?.estimate?.().catch(() => null),
            ]);
            const categories: StorageCategoryUsage[] = [];
            for (const [contents, pluginData] of [[application, false], [plugins, true], [pluginFiles, true]] as const) {
                for (const store of contents) {
                    const id = pluginData ? "pluginData" : Object.keys(stores).find((key) => stores[key] === store.name) ?? (["channels", "workspace_config", pluginVideoTaskStore].includes(store.name) ? "private" : "other");
                    let category = categories.find((item) => item.id === id);
                    if (!category) {
                        category = { id, ...storageCategoryInfo[id as keyof typeof storageCategoryInfo], bytes: 0, records: 0 };
                        categories.push(category);
                    }
                    category.bytes += store.bytes;
                    category.records += store.records;
                }
            }
            return {
                scope: "browser", categories, contentBytes: categories.reduce((sum, category) => sum + category.bytes, 0),
                usedBytes: estimate?.usage ?? null, totalBytes: estimate?.quota ?? null,
                availableBytes: estimate?.quota !== undefined && estimate.usage !== undefined ? Math.max(0, estimate.quota - estimate.usage) : null,
            };
        },
        async entries(category) {
            const store = stores[category];
            if (!store) throw new StorageError("STORAGE_INVALID");
            const database = await openDatabase(appDatabase);
            if (!database) return [];
            try {
                return database.objectStoreNames.contains(store) ? await scanStore(database.transaction(store, "readonly").objectStore(store)) : [];
            } finally {
                database.close();
            }
        },
        references: browserResourceReferences,
        async read(category, key) {
            const store = stores[category];
            if (!store) throw new StorageError("STORAGE_INVALID");
            const value = await open(appDatabase, store).getItem<unknown>(key);
            if (value === null) throw new StorageError("STORAGE_UNAVAILABLE");
            return category === "state" && typeof value === "string" ? JSON.parse(value) : value;
        },
        preview: (key) => open(appDatabase, stores.previews).getItem<Blob>(key),
        async cleanup() {
            const used = new Set<string>();
            for (const id of Object.keys(stores).filter((id) => !unreferencedStores.includes(id))) {
                await open(appDatabase, stores[id]).iterate<unknown, void>((value) => { collectStringValues(id === "state" && typeof value === "string" ? JSON.parse(value) : value, used); });
            }
            for (const name of await storeNames(pluginDataDatabase)) {
                await open(pluginDataDatabase, name).iterate<unknown, void>((value) => { collectStringValues(value, used); });
            }
            for (const task of await readTasks()) collectStringValues(task, used);
            const result = { files: 0, bytes: 0 };
            async function sweep(database: string, name: string, pairedPreviews = false) {
                const store = open(database, name), previews = open(appDatabase, stores.previews);
                for (const key of await store.keys()) {
                    if (used.has(key)) continue;
                    result.bytes += (await store.getItem<Blob>(key))?.size ?? 0;
                    await store.removeItem(key);
                    result.files += 1;
                    if (!pairedPreviews) continue;
                    result.bytes += (await previews.getItem<Blob>(key))?.size ?? 0;
                    await previews.removeItem(key);
                }
            }
            await sweep(appDatabase, stores.images, true);
            await sweep(appDatabase, stores.media);
            for (const name of await storeNames(pluginFilesDatabase)) await sweep(pluginFilesDatabase, name);
            return result;
        },
    };
}

function open(database: string, storeName: string) {
    return localforage.createInstance({ name: database, storeName, driver: localforage.INDEXEDDB });
}

async function storeNames(name: string) {
    const database = await openDatabase(name);
    if (!database) return [];
    try { return Array.from(database.objectStoreNames).filter((store) => store !== localforageBlobProbe); }
    finally { database.close(); }
}

async function readTasks() {
    const database = await openDatabase(appDatabase);
    if (!database || !database.objectStoreNames.contains(pluginVideoTaskStore)) return [];
    try {
        return await new Promise<unknown[]>((resolve, reject) => {
            const request = database.transaction(pluginVideoTaskStore).objectStore(pluginVideoTaskStore).getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } finally { database.close(); }
}

async function readDatabaseUsage(name: string) {
    const database = await openDatabase(name);
    if (!database) return [];
    try {
        const names = Array.from(database.objectStoreNames).filter(store => store !== localforageBlobProbe);
        if (!names.length) return [];
        const transaction = database.transaction(names, "readonly");
        return await Promise.all(names.map(async (name) => {
            const entries = await scanStore(transaction.objectStore(name));
            return { name, records: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0) };
        }));
    } finally {
        database.close();
    }
}

function scanStore(store: IDBObjectStore) {
    return new Promise<StorageEntry[]>((resolve, reject) => {
        const entries: StorageEntry[] = [];
        const request = store.openCursor();
        store.transaction.addEventListener("abort", () => reject(store.transaction.error), { once: true });
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return resolve(entries);
            const value = cursor.value;
            entries.push({ key: cursor.key as string, name: value instanceof File ? value.name : cursor.key as string, bytes: valueBytes(value), mimeType: value instanceof Blob ? value.type : null });
            cursor.continue();
        };
    });
}

function valueBytes(value: unknown): number {
    if (value instanceof Blob) return value.size;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength;
}
