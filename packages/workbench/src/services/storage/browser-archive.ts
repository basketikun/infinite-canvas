import type { StorageAdapter } from "@infinite-canvas/shared/storage";
import { nextRecordUpdatedAt, serializeCanvasDocument, StorageError } from "@infinite-canvas/shared/storage-data";
import type { ArchivePreferences } from "@infinite-canvas/shared/work-archive";

export async function saveArchivePreferences(preferences: LocalForage, id: string, value: ArchivePreferences) {
    if (await preferences.getItem(id) === null) await preferences.setItem(id, value);
}

/** 先写入原件，再写入画布、作品与聊天记录；已存在的目标直接跳过。 */
export function installBrowserArchive(stores: { projects: LocalForage; works: LocalForage; chats: LocalForage; preferences: LocalForage; images: LocalForage; media: LocalForage; pluginFiles: (owner: string) => LocalForage }): StorageAdapter["installArchive"] {
    return async ({ target, files }, preferences) => {
        const document = target.kind === "canvas" ? serializeCanvasDocument(target.document) : undefined;
        const deleted = document && (await stores.preferences.getItem<{ id: string }[]>("deletedProjects"))?.some((item) => item.id === document.id);
        const id = document ? document.id : target.kind === "work" ? target.work.workId : "";
        if (deleted) throw new StorageError("STORAGE_INVALID");
        if (await (document ? stores.projects : stores.works).getItem(id) !== null) return;
        for (const { resource, blob } of files) {
            const store = resource.collection === "plugin-files" ? stores.pluginFiles(resource.owner) : stores[resource.collection];
            await store.setItem(resource.key, blob);
        }
        if (target.kind === "work") {
            await stores.works.setItem(id, { ...target.work, updatedAt: nextRecordUpdatedAt() });
            return;
        }
        await stores.projects.setItem(id, document);
        for (const thread of target.threads) await stores.chats.setItem(thread.id, thread);
        if (preferences) await saveArchivePreferences(stores.preferences, id, preferences);
    };
}
