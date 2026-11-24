import { create } from "zustand";
import { storage } from "@workbench/services/storage/runtime";
import { reportStorageError } from "@workbench/services/storage/status";
import { nanoid } from "nanoid";
import { PluginError } from "@infinite-canvas/shared/plugins";
import type { ArchiveThread } from "@infinite-canvas/shared/chat";
import { nextRecordUpdatedAt, sameChatSyncRecord, storedChatSyncRecord, StorageError, type ChatSyncRecord } from "@infinite-canvas/shared/storage-data";
import { useCanvasStore } from "./canvas/use-canvas-store";
import type { ModelMessage } from "ai";
import type { AgentTokenUsage } from "@workbench/lib/agent/agent-chat-usage";

export type AgentChatImage = { storageKey: string; name: string; width: number; height: number; bytes: number; mimeType: string };
export type AgentChatItem = { id: string; role: "user" | "assistant" | "tool" | "error" | "notice"; text: string; images?: AgentChatImage[]; toolName?: string; status?: "running" | "done" | "failed"; usage?: AgentTokenUsage; outputTokensPerSecond?: number };
export type AgentThread = { id: string; projectId: string; title: string; updatedAt: string; items: AgentChatItem[]; messages: ModelMessage[]; contextMessages?: ModelMessage[]; contextTokens?: number };
type ChatStore = {
    threads: AgentThread[];
    activeThreadIds: Record<string, string>;
    storageError: boolean;
    ready: boolean;
    run: { projectId: string; threadId?: string; controller: AbortController; done: Promise<void> } | null;
    receiving: ReadonlyMap<string, string>;
    deletions: ReadonlyMap<string, "pending" | "error">;
    createThread: (projectId: string) => string;
    selectThread: (projectId: string, threadId: string) => void;
    deleteThread: (threadId: string) => Promise<void>;
    flush: (projectId?: string) => Promise<void>;
    deleteProjectThreads: (projectIds: readonly string[]) => Promise<void>;
    updateThread: (threadId: string, patch: Partial<Pick<AgentThread, "title" | "items" | "messages" | "contextMessages" | "contextTokens">>) => void;
};
const chatStorage = storage.chats;
type ChatWrite = { id: string; projectId: string } & ({ thread: AgentThread } | { thread: null; deletedAt: string });
const dirty = new Map<string, ChatWrite>();
const pending = new Map<string, { write: ChatWrite; promise: Promise<void> }>();
const failed = new Set<string>();
const drafts = new Map<symbol, string>();
let loadFailed = false;
let saveQueue = Promise.resolve();

export function holdChatDraft(threadId: string) {
    const view = Symbol();
    drafts.set(view, threadId);
    return () => { drafts.delete(view); };
}

export type ChatSubmission = {
    projectId: string; threadId: string; selected?: string; item: AgentChatItem; message: ModelMessage;
    write?: { before: ChatSyncRecord | null; next: ChatSyncRecord }; previous?: AgentChatItem; base?: ChatSyncRecord | null; started?: boolean;
};

/** 首条正文与回复分开接收。重试用原 CAS 与条目 ID，不把外部后来编辑的会话写回旧快照。 */
export async function confirmChatSubmission(submission: ChatSubmission, signal: AbortSignal) {
    const { projectId, threadId, selected, item, message } = submission;
    const preparations = await Promise.allSettled([useCanvasStore.getState().flush(projectId), flushChatWrites(projectId)]);
    for (const receipt of preparations) if (receipt.status === "rejected") throw receipt.reason;
    signal.throwIfAborted();
    const operation = saveQueue.then(async () => {
        signal.throwIfAborted();
        const local = useAgentChatStore.getState().threads.find((t) => t.id === threadId);
        if (!submission.write) {
            if (selected && local?.projectId !== projectId || !selected && local && !submission.previous) throw new PluginError("PLUGIN_CONFLICT");
            const before = submission.base !== undefined ? submission.base : local ? storedChatSyncRecord({ key: threadId, value: local }) : null;
            const source = before?.thread as AgentThread | undefined;
            const thread: AgentThread = {
                ...source, id: threadId, projectId, updatedAt: nextRecordUpdatedAt(source?.updatedAt),
                title: source?.messages.length ? source.title : (item.text || item.images![0].name).slice(0, 40),
                items: [...(source?.items ?? []), item], messages: [...(source?.messages ?? []), message],
                contextMessages: [...(source?.contextMessages ?? source?.messages ?? []), message],
            };
            submission.write = { before, next: storedChatSyncRecord({ key: threadId, value: thread }) };
        }
        const { before, next } = submission.write;
        await chatStorage.compareSync(before, next);
        // 同一请求重放、保存回执延迟时，都从真记录确认最初的消息。后加的正文不能被旧回复覆盖。
        const saved = await chatStorage.getItem<AgentThread>(threadId);
        const user = saved?.items.find((row) => row.id === item.id);
        const fields = ["storageKey", "name", "width", "height", "bytes", "mimeType"];
        if (useAgentChatStore.getState().threads.find((t) => t.id === threadId) !== local) throw new PluginError("PLUGIN_CONFLICT");
        if (saved?.projectId === projectId) receiveThread(threadId, saved);
        if (!saved || saved.projectId !== projectId || user?.role !== "user") throw new PluginError("PLUGIN_CONFLICT");
        const matches = (attempt: AgentChatItem) => user.text === attempt.text && JSON.stringify(user.images ?? [], fields) === JSON.stringify(attempt.images ?? [], fields);
        if (!matches(item)) {
            if (submission.previous && matches(submission.previous)) return "previous" as const;
            throw new PluginError("PLUGIN_CONFLICT");
        }
        return sameChatSyncRecord(next, { ...next, thread: { ...saved as ArchiveThread, title: next.thread!.title, updatedAt: next.updatedAt } }) ? "current" as const : "advanced" as const;
    });
    saveQueue = operation.then(() => {}, () => {});
    return operation;
}

function writeThread(write: ChatWrite, manualDeletion = false) {
    const promise = saveQueue.then(async () => {
        let saved: AgentThread | null = null;
        if (write.thread) {
            try { saved = await chatStorage.setItem(write.id, write.thread); }
            catch (error) {
                if (error instanceof StorageError && error.code === "STORAGE_CHAT_DELETED") {
                    const { run } = useAgentChatStore.getState();
                    if (run?.threadId === write.id) run.controller.abort();
                    dirty.delete(write.id);
                    failed.delete(write.id);
                    receiveThread(write.id, null);
                }
                throw error;
            }
        }
        else {
            try { await chatStorage.deleteThread(write.id, write.projectId, write.deletedAt); }
            catch (error) {
                let reason = error;
                // 这次删除只针对当时看到的会话。保存较晚的正文留给用户重新决定。
                if (error instanceof StorageError && error.code === "STORAGE_INVALID" && dirty.get(write.id) === write) {
                    const newer = await chatStorage.getItem<AgentThread>(write.id);
                    if (newer?.projectId === write.projectId && Date.parse(newer.updatedAt) >= Date.parse(write.deletedAt)) {
                        dirty.delete(write.id);
                        failed.delete(write.id);
                        receiveThread(write.id, portableAgentThread(newer));
                        reason = new PluginError("PLUGIN_CONFLICT", { cause: error });
                    }
                }
                if (storage.kind === "server" && error instanceof StorageError && (reason === error || !useAgentChatStore.getState().deletions.has(write.id))) reportStorageError(error);
                throw reason;
            }
        }
        if (dirty.get(write.id) === write) {
            dirty.delete(write.id);
            failed.delete(write.id);
            if (saved && write.thread && saved.updatedAt !== write.thread.updatedAt) receiveThread(write.id, saved);
        }
        if (!write.thread) receiveThread(write.id, null);
    });
    saveQueue = promise.catch(() => undefined);
    pending.set(write.id, { write, promise });
    const deletions = useAgentChatStore.getState().deletions;
    if (!write.thread && (manualDeletion || deletions.get(write.id) === "error")) {
        useAgentChatStore.setState({ deletions: new Map(deletions).set(write.id, "pending") });
    }
    const release = () => {
        const current = pending.get(write.id)?.promise === promise;
        if (current) pending.delete(write.id);
        useAgentChatStore.setState((state) => {
            let deletions = state.deletions;
            if (current && !write.thread && deletions.has(write.id)) {
                const next = new Map(deletions);
                if (dirty.get(write.id) === write) next.set(write.id, "error");
                else next.delete(write.id);
                deletions = next;
            }
            return { deletions, storageError: loadFailed || [...failed].some((id) => !deletions.has(id)) };
        });
    };
    void promise.then(release, () => {
        if (dirty.get(write.id) === write) failed.add(write.id);
        release();
    });
    return promise;
}

function saveThread(thread: AgentThread) {
    const write = { id: thread.id, projectId: thread.projectId, thread };
    dirty.set(thread.id, write);
    if (!useAgentChatStore.getState().storageError) void writeThread(write);
}

async function flushChatWrites(projectId?: string) {
    await agentHistoryReady;
    if (loadFailed) await loadChatHistory();
    const attempted = new Set<ChatWrite>();
    let failure: unknown;
    let rejected = false;
    while (true) {
        const writes: Promise<void>[] = [];
        for (const id of new Set([...dirty.keys(), ...pending.keys()])) {
            const active = pending.get(id);
            const write = active?.write ?? dirty.get(id);
            if (!write || projectId !== undefined && write.projectId !== projectId) continue;
            if (active) { attempted.add(write); writes.push(active.promise); }
            else if (!attempted.has(write)) { attempted.add(write); writes.push(writeThread(write)); }
        }
        if (!writes.length) break;
        for (const result of await Promise.allSettled(writes)) {
            if (result.status === "rejected") { rejected = true; failure = result.reason; }
        }
    }
    if (rejected) throw failure;
}

async function deleteThreads(threads: readonly AgentThread[]) {
    if (threads.some((thread) => useAgentChatStore.getState().receiving.has(thread.id))) throw new PluginError("PLUGIN_CHAT_BUSY");
    const writes = threads.map((thread) => {
        const active = pending.get(thread.id);
        if (active?.write.thread === null) return active.promise;
        const write = { id: thread.id, projectId: thread.projectId, thread: null, deletedAt: nextRecordUpdatedAt(thread.updatedAt) };
        dirty.set(thread.id, write);
        return writeThread(write);
    });
    const results = await Promise.allSettled(writes);
    for (const result of results) if (result.status === "rejected") throw result.reason;
}

export const useAgentChatStore = create<ChatStore>((set, get) => ({
    threads: [],
    activeThreadIds: {},
    storageError: false,
    ready: false,
    run: null,
    receiving: new Map(),
    deletions: new Map(),
    createThread: (projectId) => {
        if (!get().ready || get().storageError) throw new Error("CHAT_STORAGE_UNAVAILABLE");
        if (!useCanvasStore.getState().openProject(projectId)) throw new PluginError("PLUGIN_NOT_FOUND");
        const id = nanoid();
        const thread: AgentThread = { id, projectId, title: "新对话", updatedAt: new Date().toISOString(), items: [], messages: [] };
        set((state) => ({ threads: [thread, ...state.threads], activeThreadIds: { ...state.activeThreadIds, [projectId]: id } }));
        saveThread(thread);
        return id;
    },
    selectThread: (projectId, threadId) => {
        if (!get().deletions.has(threadId)) set((state) => ({ activeThreadIds: { ...state.activeThreadIds, [projectId]: threadId } }));
    },
    deleteThread: (threadId) => {
        const state = get();
        if (!state.ready || state.storageError) return Promise.reject(new StorageError("STORAGE_UNAVAILABLE"));
        if (state.receiving.has(threadId) || state.run?.threadId === threadId) return Promise.reject(new PluginError("PLUGIN_CHAT_BUSY"));
        const active = pending.get(threadId);
        if (active?.write.thread === null) return active.promise;
        const thread = state.threads.find((item) => item.id === threadId);
        if (!thread) return Promise.resolve();
        const previous = dirty.get(threadId);
        const write = previous?.thread === null ? previous : { id: threadId, projectId: thread.projectId, thread: null, deletedAt: nextRecordUpdatedAt(thread.updatedAt) };
        dirty.set(threadId, write);
        return writeThread(write, true);
    },
    flush: flushChatWrites,
    deleteProjectThreads: async (projectIds) => {
        await agentHistoryReady;
        if ([...get().receiving.values()].some((id) => projectIds.includes(id))) throw new PluginError("PLUGIN_CHAT_BUSY");
        const flushed = await Promise.allSettled(projectIds.map((projectId) => flushChatWrites(projectId)));
        for (const result of flushed) if (result.status === "rejected") throw result.reason;
        const rows = await chatStorage.syncRecords();
        const threads = new Map(get().threads.filter((thread) => projectIds.includes(thread.projectId)).map((thread) => [thread.id, thread]));
        for (const row of rows) if (row.thread && projectIds.includes(row.projectId) && !threads.has(row.id)) threads.set(row.id, row.thread as AgentThread);
        await deleteThreads([...threads.values()]);
    },
    updateThread: (threadId, patch) => {
        const current = get().threads.find((item) => item.id === threadId);
        if (get().receiving.has(threadId)) throw new PluginError("PLUGIN_CHAT_BUSY");
        if (!current || dirty.get(threadId)?.thread === null) throw new PluginError("PLUGIN_NOT_FOUND");
        const thread = { ...current, ...patch, updatedAt: nextRecordUpdatedAt(current.updatedAt) };
        set((state) => ({ threads: state.threads.map((item) => item.id === threadId ? thread : item) }));
        saveThread(thread);
    },
}));

export function portableAgentThread<T extends { items: { text: string; status?: unknown }[] }>(thread: T): T {
    if (!thread.items.some((item) => item.status === "running")) return thread;
    return { ...thread, items: thread.items.map((item) => item.status === "running" ? { ...item, status: "failed", text: "上次操作已中断，请确认画布结果后继续。" } : item) };
}

let loadingHistory: Promise<void> | undefined;
function loadChatHistory() {
    return loadingHistory ??= (async () => {
        const threads: AgentThread[] = [];
        await chatStorage.iterate<AgentThread, void>((thread) => {
            threads.push(portableAgentThread(thread));
        });
        const rows = new Map(threads.map((thread) => [thread.id, thread]));
        for (const thread of useAgentChatStore.getState().threads) rows.set(thread.id, thread);
        loadFailed = false;
        useAgentChatStore.setState({ threads: [...rows.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), ready: true, storageError: failed.size > 0 });
    })().catch((error) => {
        loadFailed = true;
        useAgentChatStore.setState({ storageError: true, ready: true });
        throw error;
    }).finally(() => { loadingHistory = undefined; });
}

export const agentHistoryReady = loadChatHistory().catch(() => {});

function receiveThread(id: string, thread: AgentThread | null) {
    useAgentChatStore.setState((state) => {
        const threads = state.threads.filter((item) => item.id !== id);
        if (thread) return { threads: [thread, ...threads] };
        return { threads, activeThreadIds: Object.fromEntries(Object.entries(state.activeThreadIds).filter(([, selected]) => selected !== id)) };
    });
}

export async function readChatSyncRecords() {
    await agentHistoryReady;
    const state = useAgentChatStore.getState();
    if (loadFailed || failed.size) throw new StorageError("STORAGE_UNAVAILABLE");
    if (state.run || state.receiving.size || dirty.size || pending.size) throw new PluginError("PLUGIN_CHAT_BUSY");
    const records = await chatStorage.syncRecords();
    const current = useAgentChatStore.getState();
    if (current.threads !== state.threads || current.run || current.receiving.size || dirty.size || pending.size) throw new PluginError("PLUGIN_CONFLICT");
    // 本机可能已经写入但客户端没收到回执。再次同步时从实存恢复对应会话和选择。
    const visible = new Map(current.threads.map((thread) => [thread.id, thread]));
    const threads = records.flatMap((row) => {
        if (!row.thread) return [];
        const thread = portableAgentThread(row.thread) as AgentThread;
        const previous = visible.get(row.id);
        if (previous && sameChatSyncRecord({ ...row, thread: thread as ArchiveThread }, {
            id: previous.id, projectId: previous.projectId, updatedAt: previous.updatedAt, thread: previous as ArchiveThread,
        })) return [previous];
        return [thread];
    });
    if (threads.length !== visible.size || threads.some((thread) => visible.get(thread.id) !== thread)) {
        const unchanged = new Set(threads.filter((thread) => visible.get(thread.id) === thread).map((thread) => thread.id));
        if ([...drafts.values()].some((id) => visible.has(id) && !unchanged.has(id))) throw new PluginError("PLUGIN_CHAT_BUSY");
        const ids = new Map(threads.map((thread) => [thread.id, thread.projectId]));
        const activeThreadIds = Object.fromEntries(Object.entries(current.activeThreadIds).filter(([projectId, id]) => ids.get(id) === projectId));
        useAgentChatStore.setState({ threads: threads.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), activeThreadIds });
    }
    return records;
}

export async function applySyncedChat(expected: ChatSyncRecord | null, next: ChatSyncRecord, signal: AbortSignal) {
    signal.throwIfAborted();
    const state = useAgentChatStore.getState();
    if (state.run?.projectId === next.projectId || state.receiving.has(next.id) || dirty.has(next.id) || pending.has(next.id) || [...drafts.values()].includes(next.id)) throw new PluginError("PLUGIN_CHAT_BUSY");
    if (next.thread && !useCanvasStore.getState().openProject(next.projectId)) throw new PluginError("PLUGIN_CONFLICT");
    useAgentChatStore.setState({ receiving: new Map(state.receiving).set(next.id, next.projectId) });
    try {
        if (!await chatStorage.compareSync(expected, next)) throw new PluginError("PLUGIN_CONFLICT");
        receiveThread(next.id, next.thread && portableAgentThread(next.thread) as AgentThread);
        signal.throwIfAborted();
    } finally {
        const receiving = new Map(useAgentChatStore.getState().receiving);
        receiving.delete(next.id);
        useAgentChatStore.setState({ receiving });
    }
}

/** 从业务会话集合取快照，仍在写入或保存失败的会话取本页已经接受的内容。 */
export async function readProjectChats(projectId: string) {
    await agentHistoryReady;
    if (loadFailed) throw new StorageError("STORAGE_UNAVAILABLE");
    const local = [...dirty.values()].filter((write) => write.projectId === projectId);
    const threads = new Map<string, AgentThread>();
    await chatStorage.iterate<AgentThread, void>((thread) => {
        if (thread.projectId === projectId) threads.set(thread.id, thread);
    });
    for (const write of local) {
        if (write.thread) threads.set(write.id, write.thread);
        else threads.delete(write.id);
    }
    const active = useAgentChatStore.getState().activeThreadIds[projectId];
    return { threads: [...threads.values()], activeThreadId: threads.has(active) ? active : null };
}

export async function receiveProjectChats(projectId: string, activeThreadId: string | null) {
    const { threads } = await readProjectChats(projectId);
    useAgentChatStore.setState((state) => {
        const seen = new Set(state.threads.map((thread) => thread.id));
        const added = threads.filter((thread) => !seen.has(thread.id));
        return { threads: [...added, ...state.threads], activeThreadIds: !state.activeThreadIds[projectId] && activeThreadId && threads.some((thread) => thread.id === activeThreadId)
            ? { ...state.activeThreadIds, [projectId]: activeThreadId } : state.activeThreadIds };
    });
}
