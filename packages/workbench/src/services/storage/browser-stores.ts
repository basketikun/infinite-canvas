import { appDatabase } from "@workbench/utils/indexed-db";
import { StorageError } from "@infinite-canvas/shared/storage-data";

export const pluginVideoTaskStore = "plugin_video_tasks";

export const browserStores: Record<string, string> = {
    state: "app_state", projects: "projects_v1", works: "works", preferences: "device_preferences",
    images: "image_files", previews: "image_previews", media: "media_files",
    imageRecords: "image_generation_logs", videoRecords: "video_generation_logs", audioRecords: "audio_generation_logs", agentRecords: "create_agent_records", chats: "agent_chat", promptCache: "prompt_cache",
};

export const localforageBlobProbe = "local-forage-detect-blob-support";

// 冒号不能出现在插件 ID 中；只有与 localforage 保留表同名的作者需要转义。
export function pluginOwnerStore(owner: string) {
    return owner === localforageBlobProbe ? `plugin:${owner}` : owner;
}

const fixedStores = [...Object.values(browserStores), "workspace_config", "channels", pluginVideoTaskStore, localforageBlobProbe];

/** 在 localforage 开始业务读取前完成结构升级，避免创建另一张表时关闭正在使用的连接。 */
export async function prepareBrowserStorage() {
    function open(version?: number) {
        return new Promise<number | undefined>((resolve, reject) => {
            const request = indexedDB.open(appDatabase, version);
            request.onupgradeneeded = () => {
                const db = request.result;
                for (const store of fixedStores) if (!db.objectStoreNames.contains(store)) {
                    db.createObjectStore(store);
                }
            };
            request.onerror = () => reject(new StorageError("STORAGE_UNAVAILABLE"));
            request.onsuccess = () => {
                const db = request.result;
                const missing = fixedStores.some((store) => !db.objectStoreNames.contains(store));
                db.close();
                resolve(missing ? db.version + 1 : undefined);
            };
        });
    }
    const next = await open();
    if (next !== undefined && await open(next) !== undefined) throw new StorageError("STORAGE_UNAVAILABLE");
}
