import { StorageError, type StorageRecord } from "@infinite-canvas/shared/storage-data";
import { requestStorage } from "@workbench/lib/storage-request";
import type { StorageInspectionAdapter } from "./runtime";

export function createHttpStorageInspection(): StorageInspectionAdapter {
    return {
        async usage() { return (await requestStorage("/api/storage-inspection")).json(); },
        async entries(category) { return (await requestStorage(`/api/storage-inspection/${encodeURIComponent(category)}`)).json(); },
        async references(resource, signal) {
            const query = new URLSearchParams({ ...resource });
            const result = await (await requestStorage(`/api/storage-inspection/references?${query}`, { signal })).json();
            signal?.throwIfAborted();
            return result;
        },
        async read(category, key) {
            const binary = category === "images" || category === "media";
            const response = await requestStorage(`/api/${binary ? "assets" : "storage"}/${encodeURIComponent(category)}/${encodeURIComponent(key)}`);
            if (binary) return response.blob();
            const record = await response.json() as StorageRecord | null;
            if (!record || record.value === null) throw new StorageError("STORAGE_UNAVAILABLE");
            return record.value;
        },
        async preview(key) {
            const response = await requestStorage(`/api/storage-inspection/images/${encodeURIComponent(key)}/preview`, undefined, true);
            return response.status === 200 ? response.blob() : null;
        },
        async openFolder() { await requestStorage("/api/storage-inspection/open-folder", { method: "POST" }); },
        async cleanup() { return (await requestStorage("/api/storage-inspection/cleanup", { method: "POST" })).json(); },
    };
}
