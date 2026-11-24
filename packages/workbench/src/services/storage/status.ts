import { StorageError } from "@infinite-canvas/shared/storage-data";

let error: StorageError | null = null;
const listeners = new Set<() => void>();
export function reportStorageError(reason: unknown) {
    error = reason instanceof StorageError ? reason : new StorageError("STORAGE_UNAVAILABLE");
    listeners.forEach((listener) => listener());
}
export function getStorageError() { return error; }
export function subscribeStorageError(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
