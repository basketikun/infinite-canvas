import type { StorageAdapter } from "@infinite-canvas/shared/storage";

export let storage: StorageAdapter;

export function initializeStorage(adapter: StorageAdapter) {
    if (storage) throw new Error("STORAGE_ALREADY_INITIALIZED");
    storage = adapter;
}
