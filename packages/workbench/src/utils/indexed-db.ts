import { StorageError } from "@infinite-canvas/shared/storage-data";

/** 1.0 起使用独立库名，不读取 0.x 版本留下的浏览器数据。 */
export const appDatabase = "infinite-canvas-v1";
export const pluginDataDatabase = "infinite-canvas-v1-plugins";
export const pluginFilesDatabase = "infinite-canvas-v1-plugin-files";

/** 只打开已经建立的数据库，避免读取操作创建空库。 */
export function openDatabase(name: string) {
    return new Promise<IDBDatabase | null>((resolve, reject) => {
        let missing = false;
        const request = indexedDB.open(name);
        request.onupgradeneeded = () => { missing = true; request.transaction!.abort(); };
        request.onerror = () => missing ? resolve(null) : reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

export function readIDBRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/** action 只等待本事务内的 IndexedDB 请求；以真实完成或回滚事件为回执。 */
export async function browserStorageTransaction<T>(stores: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction) => Promise<T>, options?: IDBTransactionOptions): Promise<T> {
    const db = await openDatabase(appDatabase).catch(() => null);
    if (!db) throw new StorageError("STORAGE_UNAVAILABLE");
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction(stores, mode, options);
            let value: T, failure: unknown;
            tx.oncomplete = () => failure ? reject(failure) : resolve(value);
            tx.onabort = () => reject(failure ?? new StorageError("STORAGE_UNAVAILABLE"));
            action(tx).then((result) => { value = result; }, (cause) => {
                failure = cause instanceof StorageError ? cause : new StorageError("STORAGE_UNAVAILABLE");
                try { tx.abort(); } catch { /* 已开始结束的事务仍由上述事件回执。 */ }
            });
        });
    } catch (error) {
        throw error instanceof StorageError ? error : new StorageError("STORAGE_UNAVAILABLE");
    } finally { db.close(); }
}
