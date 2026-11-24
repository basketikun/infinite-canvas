import { StorageError } from "@infinite-canvas/shared/storage-data";

export async function requestStorage(path: string, init?: RequestInit, allowNotFound = false) {
    try {
        const response = await fetch(path, init);
        if (!response.ok && !(allowNotFound && response.status === 404)) {
            if (response.status === 400) {
                const body = await response.json().catch(() => null);
                const code = body?.error?.code;
                if (code === "STORAGE_FILE_EXISTS" || code === "STORAGE_INVALID" || code === "STORAGE_WORK_TIME_MISSING" || code === "STORAGE_CHAT_PROJECT_MISSING" || code === "STORAGE_CHAT_DELETED") throw new StorageError(code);
            }
            throw new StorageError("STORAGE_UNAVAILABLE");
        }
        return response;
    } catch (error) {
        init?.signal?.throwIfAborted();
        throw error instanceof StorageError ? error : new StorageError("STORAGE_UNAVAILABLE");
    }
}
