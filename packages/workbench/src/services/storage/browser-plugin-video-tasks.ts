import { finishPluginVideoReceipt, ModelExecutionError, storedPluginVideoReceipt, type PluginTaskTarget, type WebPluginVideoReceipt } from "@infinite-canvas/shared/model-http";
import { StorageError } from "@infinite-canvas/shared/storage-data";
import type { VideoTaskIdentity } from "@infinite-canvas/shared/model-execution";
import { appDatabase, openDatabase } from "@workbench/utils/indexed-db";
import { browserStores, pluginVideoTaskStore } from "./browser-stores";

export async function readPluginVideoReceipt(id: string, target: PluginTaskTarget) {
    const db = await openDatabase(appDatabase);
    if (!db) throw new ModelExecutionError("MODEL_TASK_MISSING");
    try {
        if (!db.objectStoreNames.contains(pluginVideoTaskStore)) throw new ModelExecutionError("MODEL_TASK_MISSING");
        const value = await new Promise<unknown>((resolve, reject) => {
            const tx = db.transaction(pluginVideoTaskStore, "readonly");
            const read = tx.objectStore(pluginVideoTaskStore).get(id);
            tx.oncomplete = () => resolve(read.result);
            tx.onabort = () => reject(new StorageError("STORAGE_UNAVAILABLE"));
        });
        return storedPluginVideoReceipt(value, id, target);
    } finally { db.close(); }
}

/** 新受理的任务只创建。完成时比较原远端任务，在同一事务发表结果和原片，迟到的查询复用赢家。 */
export async function savePluginVideoReceipt(next: WebPluginVideoReceipt, previous?: VideoTaskIdentity, blob?: Blob) {
    const receipt = storedPluginVideoReceipt(next, next.id, next.target);
    if (!previous && receipt.state.status !== "pending") throw new ModelExecutionError("MODEL_TASK_CONFLICT");
    const db = await openDatabase(appDatabase);
    if (!db) throw new StorageError("STORAGE_UNAVAILABLE");
    try {
        return await new Promise<WebPluginVideoReceipt>((resolve, reject) => {
            const mediaKey = receipt.state.status === "completed" ? receipt.state.result.storageKey : undefined;
            const tx = db.transaction(mediaKey ? [pluginVideoTaskStore, browserStores.media] : pluginVideoTaskStore, "readwrite");
            const records = tx.objectStore(pluginVideoTaskStore);
            let result = receipt, failure: unknown;
            const fail = (error: unknown) => { failure = error; tx.abort(); };
            tx.oncomplete = () => resolve(result);
            tx.onabort = () => reject(failure ?? new StorageError("STORAGE_UNAVAILABLE"));
            if (!previous) {
                records.add(receipt, receipt.id);
                return;
            }
            const read = records.get(receipt.id);
            read.onsuccess = () => {
                try {
                    result = finishPluginVideoReceipt(read.result, receipt, previous);
                    if (result !== receipt) return;
                    if (mediaKey) {
                        const files = tx.objectStore(browserStores.media);
                        if (blob) files.add(blob, mediaKey);
                        else {
                            const file = files.getKey(mediaKey);
                            file.onsuccess = () => { if (file.result === undefined) fail(new StorageError("STORAGE_INVALID")); };
                        }
                    }
                    records.put(receipt, receipt.id);
                } catch (error) { fail(error); }
            };
        });
    } finally { db.close(); }
}
