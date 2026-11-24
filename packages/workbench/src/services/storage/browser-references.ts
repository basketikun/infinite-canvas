import { appDatabase, pluginDataDatabase } from "@workbench/utils/indexed-db";
import { collectStorageReferences, referenceCollections, type StorageReference } from "@infinite-canvas/shared/resource-references";
import { chatSyncRecordSchema, StorageError } from "@infinite-canvas/shared/storage-data";
import { pluginSyncStoragePrefix } from "@infinite-canvas/shared/sync-data";
import { assetLibraryKey } from "@infinite-canvas/shared/sync-records";
import type { ArchiveResource } from "@infinite-canvas/shared/work-archive";
import localforage from "localforage";
import { browserStores, pluginOwnerStore } from "./browser-stores";

function open(database: string, storeName: string) {
    return localforage.createInstance({ name: database, storeName, driver: localforage.INDEXEDDB });
}

async function scan(resource: ArchiveResource, id: string, store: LocalForage, signal?: AbortSignal) {
    const rows: StorageReference[] = [];
    await store.iterate<unknown, void>((stored, key) => {
        signal?.throwIfAborted();
        let value = stored;
        if (id === "library") {
            if (key !== assetLibraryKey) return;
            value = JSON.parse(stored as string);
        } else if (id.startsWith("plugin:") && !key.startsWith(pluginSyncStoragePrefix)) return;
        if (value == null) throw new StorageError("STORAGE_INVALID");
        if (id === "works") {
            const { updatedAt, ...work } = value as { updatedAt?: string };
            value = work;
        }
        if (id === "chats" && (value as { thread?: unknown }).thread === null) {
            if (!chatSyncRecordSchema.safeParse(value).success) throw new StorageError("STORAGE_INVALID");
            return;
        }
        rows.push(...collectStorageReferences(resource, id, id === "library" ? "state" : key, value));
    });
    return rows;
}

export async function browserResourceReferences(resource: ArchiveResource, signal?: AbortSignal): Promise<StorageReference[]> {
    const rows: StorageReference[] = [];
    for (const id of referenceCollections(resource)) {
        signal?.throwIfAborted();
        const store = id.startsWith("plugin:") ? open(pluginDataDatabase, pluginOwnerStore(id.slice(7))) : open(appDatabase, browserStores[id === "library" ? "state" : id]);
        rows.push(...await scan(resource, id, store, signal));
    }
    return rows;
}
