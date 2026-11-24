import type { StorageAdapter, StorageCollection } from "@infinite-canvas/shared/storage";
import { canCompareChatSync, canCompareWorkSync, nextRecordUpdatedAt, ordinaryChatWrite, sameWorkOwner, serializeCanvasDocument, serializeStandaloneWork, storedChatSyncRecord, storedWorkSyncRecord, StorageError, type ChatSyncRecord } from "@infinite-canvas/shared/storage-data";
import { canvasDocumentSchema, sameCanvasVideoRun, type CanvasDocument, type PluginStandaloneWork } from "@infinite-canvas/shared/canvas/schema/canvas";
import { finishPluginVideoReceipt, ModelExecutionError, storedPluginVideoReceipt, type WebPluginVideoReceipt } from "@infinite-canvas/shared/model-http";
import { pluginSyncStorageKey } from "@infinite-canvas/shared/sync-data";
import { applyAssetEdits, assetLibraryKey } from "@infinite-canvas/shared/sync-records";
import { applyWorkspaceConfigMutation, defaultWorkspaceConfig, type WorkspaceConfig } from "@infinite-canvas/shared/workspace-config";
import type { WorkspaceConfigAdapter } from "../../src/services/workspace-config/runtime";

export function createMemoryWorkspaceConfig(): WorkspaceConfigAdapter {
    let config: WorkspaceConfig = structuredClone(defaultWorkspaceConfig);
    return {
        async load() { return structuredClone(config); },
        async save(value) { config = structuredClone(value); },
        async update(change) {
            const next = applyWorkspaceConfigMutation(config, change);
            if (!next) return false;
            config = structuredClone(next);
            return true;
        },
    };
}

export function createMemoryCollection(values = new Map<string, unknown>()): StorageCollection {
    return {
        async getItem<T>(key: string) { return values.has(key) ? values.get(key) as T : null; },
        async setItem<T>(key: string, value: T) { values.set(key, structuredClone(value)); return value; },
        async removeItem(key) { values.delete(key); },
        async clear() { values.clear(); },
        async iterate<T, R>(iterator: (value: T, key: string, index: number) => R) {
            let index = 0;
            for (const [key, value] of values) {
                const result = iterator(value as T, key, ++index);
                if (result !== undefined) return result;
            }
        },
    };
}

export function createMemoryStorage(files: Partial<Pick<StorageAdapter, "images" | "media" | "previews">> = {}): StorageAdapter {
    const plugins = new Map<string, StorageCollection>();
    const projectValues = new Map<string, unknown>();
    const savedVideoTasks = new Map<string, WebPluginVideoReceipt>();
    const canvasVideoConnections = new Map<string, { identity: string; fingerprint: string }>();
    const images = files.images ?? createMemoryCollection(), media = files.media ?? createMemoryCollection(), previews = files.previews ?? createMemoryCollection();
    const works = new Map<string, PluginStandaloneWork>();
    const workTimes = new Map<string, string>();
    const chatValues = new Map<string, unknown>();
    const chatDeletions = new Map<string, ChatSyncRecord>();
    const chatRecords = createMemoryCollection(chatValues);
    function chatRecord(id: string) {
        return chatValues.has(id) ? storedChatSyncRecord({ key: id, value: chatValues.get(id) }) : chatDeletions.get(id) ?? null;
    }
    function saveChat(row: ChatSyncRecord) {
        if (row.thread) { chatDeletions.delete(row.id); chatValues.set(row.id, structuredClone(row.thread)); }
        else { chatValues.delete(row.id); chatDeletions.set(row.id, structuredClone(row)); }
    }
    const chats: StorageAdapter["chats"] = {
        ...chatRecords,
        async syncRecords() { return [...Array.from(chatValues.keys(), (id) => chatRecord(id)!), ...structuredClone([...chatDeletions.values()])]; },
        async setItem(key, value) {
            const next = ordinaryChatWrite(chatRecord(key), storedChatSyncRecord({ key, value }))!;
            saveChat(next);
            return next.thread as typeof value;
        },
        async deleteThread(id, projectId, updatedAt) { saveChat(ordinaryChatWrite(chatRecord(id), { id, projectId, updatedAt, thread: null })!); },
        async compareSync(expected, next) {
            if (next.thread && !projectValues.has(next.projectId)) return false;
            if (!canCompareChatSync(chatRecord(next.id), expected, next)) return false;
            saveChat(next);
            return true;
        },
        async removeItem(id) {
            const next = ordinaryChatWrite(chatRecord(id), null);
            if (next) saveChat(next);
        },
        async clear() { for (const id of [...chatValues.keys()]) await this.removeItem(id); },
    };
    const preferences = createMemoryCollection();
    const stateValues = new Map<string, unknown>();
    const state = createMemoryCollection(stateValues);
    const library = () => stateValues.has(assetLibraryKey) ? JSON.parse(stateValues.get(assetLibraryKey) as string) : null;
    return {
        kind: "browser",
        state,
        images, previews, media,
        imageRecords: createMemoryCollection(), videoRecords: createMemoryCollection(), audioRecords: createMemoryCollection(), agentRecords: createMemoryCollection(),
        async editAssetLibrary(edits) { stateValues.set(assetLibraryKey, JSON.stringify(applyAssetEdits(library(), edits))); },
        pluginVideoTasks: {
            async prepare() {},
            async read(id, target) { return storedPluginVideoReceipt(savedVideoTasks.get(id), id, target); },
            async save(next, previous, blob) {
                const receipt = storedPluginVideoReceipt(next, next.id, next.target);
                const current = savedVideoTasks.get(receipt.id);
                if (previous) {
                    const result = finishPluginVideoReceipt(current, receipt, previous);
                    if (result !== receipt) return result;
                } else if (current || receipt.state.status !== "pending") throw new ModelExecutionError("MODEL_TASK_CONFLICT");
                const key = receipt.state.status === "completed" && receipt.state.result.storageKey;
                if (key) {
                    const exists = await media.getItem(key) !== null;
                    if (blob ? exists : !exists) throw new StorageError("STORAGE_INVALID");
                    if (blob) await media.setItem(key, blob);
                }
                savedVideoTasks.set(receipt.id, receipt);
                return structuredClone(receipt);
            },
        },
        async canvasVideoConnection(task, identity, originalFingerprint) {
            const key = JSON.stringify([task.projectId, task.nodeId, task.runId]);
            const existing = canvasVideoConnections.get(key);
            if (existing) return existing.identity === identity && (originalFingerprint === undefined || originalFingerprint === existing.fingerprint) ? existing.fingerprint : null;
            if (originalFingerprint === undefined) return null;
            const document = projectValues.get(task.projectId) as CanvasDocument | undefined;
            const bound = document?.nodes.find((node) => node.id === task.nodeId && node.type === "video")?.metadata?.webVideoTask;
            if (!bound || document?.id !== task.projectId || !sameCanvasVideoRun(bound, task)) return null;
            canvasVideoConnections.set(key, { identity, fingerprint: originalFingerprint });
            return originalFingerprint;
        },
        projects: {
            ...createMemoryCollection(projectValues),
            async setItem(key, value) {
                if (value != null) {
                    const parsed = canvasDocumentSchema.safeParse(value);
                    if (!parsed.success || parsed.data.id !== key) throw new StorageError("STORAGE_INVALID");
                }
                projectValues.set(key, structuredClone(value));
                return value;
            },
        },
        preferences,
        works: {
            ...createMemoryCollection(works),
            async setItem(key, work) {
                const value = serializeStandaloneWork(key, work);
                const current = works.get(key);
                if (current && !sameWorkOwner(current, value)) throw new StorageError("STORAGE_INVALID");
                const time = nextRecordUpdatedAt(current && workTimes.get(key));
                works.set(key, value);
                workTimes.set(key, time);
                return work;
            },
            async create(work) {
                const value = serializeStandaloneWork(work.workId, work);
                const existing = works.get(work.workId);
                if (existing) return sameWorkOwner(existing, value) && existing.title === value.title;
                works.set(work.workId, value);
                workTimes.set(work.workId, nextRecordUpdatedAt());
                return true;
            },
            async syncRecords() {
                return Array.from(works, ([id, work]) => storedWorkSyncRecord(id, work, workTimes.get(id)));
            },
            async compareSync(expected, next) {
                const work = serializeStandaloneWork(next.id, next.work);
                const current = works.get(next.id);
                if (!canCompareWorkSync(current ? storedWorkSyncRecord(next.id, current, workTimes.get(next.id)) : null, expected, next)) return false;
                works.set(next.id, work);
                workTimes.set(next.id, next.updatedAt);
                return true;
            },
        },
        chats,
        async installArchive({ target, files }, devicePreferences) {
            const additions: [Map<string, unknown>, string, unknown][] = [];
            if (target.kind === "work") additions.push([works, target.work.workId, target.work]);
            else {
                const deleted = await preferences.getItem<{ id: string }[]>("deletedProjects");
                if (deleted?.some(({ id }) => id === target.document.id)) throw new StorageError("STORAGE_INVALID");
                additions.push([projectValues, target.document.id, serializeCanvasDocument(target.document)]);
                for (const thread of target.threads) additions.push([chatValues, thread.id, thread]);
            }
            if (additions[0][0].has(additions[0][1])) return;
            if (additions.some(([records, key]) => records.has(key))) throw new StorageError("STORAGE_INVALID");
            for (const { resource, blob } of files) {
                await (resource.collection === "plugin-files" ? this.pluginFiles(resource.owner) : this[resource.collection]).setItem(resource.key, blob);
            }
            for (const [records, key, value] of additions) records.set(key, value);
            if (target.kind === "work") workTimes.set(target.work.workId, nextRecordUpdatedAt());
            else if (devicePreferences && await preferences.getItem(target.document.id) === null) await preferences.setItem(target.document.id, devicePreferences);
        },
        pluginFiles(id) { return this.pluginData("files:" + id); },
        async comparePluginSyncData(owner, domainId, expected, next) {
            if (!domainId.startsWith(owner + ":")) throw new StorageError("STORAGE_INVALID");
            const store = this.pluginData(owner), key = pluginSyncStorageKey(domainId);
            if (JSON.stringify(await store.getItem(key)) !== JSON.stringify(expected)) return false;
            if (expected && expected.dataVersion !== next.dataVersion) throw new StorageError("STORAGE_INVALID");
            await store.setItem(key, next);
            return true;
        },
        pluginData(id) {
            if (!plugins.has(id)) plugins.set(id, createMemoryCollection());
            return plugins.get(id)!;
        },
    };
}
