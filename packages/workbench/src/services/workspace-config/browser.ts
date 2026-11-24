import localforage from "localforage";
import { applyWorkspaceConfigMutation, defaultWorkspaceConfig, storedWorkspaceConfigSchema, workspaceConfigMutationSchema, workspaceConfigSchema } from "@infinite-canvas/shared/workspace-config";
import { StorageError } from "@infinite-canvas/shared/storage-data";
import { appDatabase, openDatabase } from "@workbench/utils/indexed-db";
import type { WorkspaceConfigAdapter } from "./runtime";

export function createBrowserWorkspaceConfig(): WorkspaceConfigAdapter {
    const store = localforage.createInstance({ name: appDatabase, storeName: "workspace_config", driver: localforage.INDEXEDDB });
    return {
        async load() {
            const value = await store.getItem("config");
            return value === null ? null : storedWorkspaceConfigSchema.parse(value);
        },
        async save(config) { await store.setItem("config", workspaceConfigSchema.parse(config)); },
        async update(change) {
            const mutation = workspaceConfigMutationSchema.parse(change);
            await store.ready();
            const db = await openDatabase(appDatabase);
            if (!db) throw new StorageError("STORAGE_UNAVAILABLE");
            try {
                return await new Promise<boolean>((resolve, reject) => {
                    const tx = db.transaction("workspace_config", "readwrite");
                    const records = tx.objectStore("workspace_config");
                    const read = records.get("config");
                    let applied = false, invalid = false;
                    read.onsuccess = () => {
                        const current = storedWorkspaceConfigSchema.safeParse(read.result === undefined ? defaultWorkspaceConfig : read.result);
                        if (!current.success) { invalid = true; tx.abort(); return; }
                        const next = applyWorkspaceConfigMutation(current.data, mutation);
                        if (next) { records.put(next, "config"); applied = true; }
                    };
                    tx.oncomplete = () => resolve(applied);
                    tx.onabort = () => reject(new StorageError(invalid ? "STORAGE_INVALID" : "STORAGE_UNAVAILABLE"));
                });
            } finally { db.close(); }
        },
    };
}
