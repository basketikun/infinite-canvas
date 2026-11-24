import type { StorageAdapter } from "@infinite-canvas/shared/storage";
import { canCompareChatSync, chatSyncRecordSchema, ordinaryChatWrite, sameChatSyncRecord, storedChatSyncRecord, StorageError, type ChatSyncRecord } from "@infinite-canvas/shared/storage-data";
import type { ArchiveThread } from "@infinite-canvas/shared/chat";

type StoredChat = ArchiveThread | (ChatSyncRecord & { thread: null });

function readChat(id: string, stored: StoredChat): ChatSyncRecord {
    if (stored && "thread" in stored && stored.thread === null) {
        const parsed = chatSyncRecordSchema.safeParse(stored);
        if (!parsed.success || parsed.data.id !== id) throw new StorageError("STORAGE_INVALID");
        return parsed.data;
    }
    return storedChatSyncRecord({ key: id, value: stored });
}

export function createBrowserChats(rows: LocalForage, projects: LocalForage): StorageAdapter["chats"] {
    async function write(id: string, next: ChatSyncRecord | null, expected?: ChatSyncRecord | null) {
        if (next && (next.id !== id || !chatSyncRecordSchema.safeParse(next).success)) throw new StorageError("STORAGE_INVALID");
        const stored = await rows.getItem<StoredChat>(id);
        const current = stored ? readChat(id, stored) : null;
        let accepted: ChatSyncRecord | null | false = false;
        if (expected === undefined) accepted = ordinaryChatWrite(current, next);
        else if (next && (!next.thread || (await projects.getItem<{ id: string }>(next.projectId))?.id === next.projectId) && canCompareChatSync(current, expected, next)) accepted = next;
        if (accepted && (!current || !sameChatSyncRecord(current, accepted))) await rows.setItem(id, accepted.thread ?? accepted);
        return accepted;
    }
    async function syncRecords() {
        const entries: [string, StoredChat][] = [];
        await rows.iterate<StoredChat, void>((value, key) => { entries.push([key, value]); });
        return entries.map(([key, value]) => readChat(key, value));
    }
    return {
        async getItem<T>(id: string) {
            const row = await rows.getItem<StoredChat>(id);
            return row ? readChat(id, row).thread as T | null : null;
        },
        async setItem<T>(id: string, value: T) {
            const saved = await write(id, storedChatSyncRecord({ key: id, value }));
            if (!saved || !saved.thread) throw new StorageError("STORAGE_INVALID");
            return saved.thread as T;
        },
        async iterate<T, R>(iterator: (value: T, key: string, index: number) => R) {
            let index = 0;
            for (const { id, thread } of await syncRecords()) if (thread) {
                const result = iterator(thread as T, id, ++index);
                if (result !== undefined) return result;
            }
        },
        async removeItem(id) { await write(id, null); },
        async clear() {
            for (const { id, thread, projectId, updatedAt } of await syncRecords()) if (thread) {
                await write(id, ordinaryChatWrite({ id, thread, projectId, updatedAt }, null));
            }
        },
        syncRecords,
        async compareSync(expected, next) { return Boolean(await write(next.id, next, expected)); },
        async deleteThread(id, projectId, updatedAt) { await write(id, { id, projectId, updatedAt, thread: null }); },
    };
}
