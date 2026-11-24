import { create } from "zustand";
import { subscribeCreateSessionsChanged } from "@workbench/lib/create-sessions-events";
import { readGenerationRecords } from "@workbench/services/generation-records";
import { deleteCreateSession, renameCreateSession } from "@workbench/services/create/sessions";
import { storage } from "@workbench/services/storage/runtime";
import { agentSession, readAgentThreads } from "@workbench/services/create/agent-logs";
import { createSessions, mergeSessions, type AudioLog, type CreateSession, type ImageLog, type VideoLog } from "@workbench/services/create/logs";

type CreateSessionStore = {
    sessions: CreateSession[];
    hydrated: boolean;
    loadError: string;
    load: () => Promise<void>;
    refresh: () => Promise<void>;
    renameSession: (id: string, title: string) => Promise<void>;
    removeSession: (id: string) => Promise<void>;
    removeSessions: (ids: string[]) => Promise<void>;
};

let loading: Promise<void> | undefined;
let subscribed = false;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

async function readSessions() {
    const [images, videos, audios, threads] = await Promise.all([
        readGenerationRecords<ImageLog>("image"),
        readGenerationRecords<VideoLog>("video"),
        readGenerationRecords<AudioLog>("audio"),
        readAgentThreads(),
    ]);
    const records = [...images, ...videos, ...audios].sort((left, right) => right.createdAt - left.createdAt);
    return mergeSessions(createSessions(records), threads.map(agentSession));
}

function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void useCreateSessionStore.getState().refresh();
    }, 250);
}

function subscribeStorage() {
    if (subscribed) return;
    subscribed = true;
    for (const collection of [storage.imageRecords, storage.videoRecords, storage.audioRecords, storage.agentRecords]) {
        collection.subscribe?.(scheduleRefresh);
    }
    subscribeCreateSessionsChanged(scheduleRefresh);
}

export const useCreateSessionStore = create<CreateSessionStore>((set) => ({
    sessions: [],
    hydrated: false,
    loadError: "",
    load() {
        subscribeStorage();
        if (loading) return loading;
        loading = readSessions().then(
            (sessions) => set({ sessions, hydrated: true, loadError: "" }),
            (error) => {
                console.error("[create-sessions] read failed", error);
                set({ hydrated: true, loadError: "暂时无法读取创作对话。" });
            },
        ).finally(() => { loading = undefined; });
        return loading;
    },
    async refresh() {
        try {
            set({ sessions: await readSessions(), hydrated: true, loadError: "" });
        } catch (error) {
            console.error("[create-sessions] refresh failed", error);
            set({ loadError: "暂时无法读取创作对话。" });
        }
    },
    async renameSession(id, title) {
        await renameCreateSession(id, title);
        await useCreateSessionStore.getState().refresh();
    },
    async removeSession(id) {
        await deleteCreateSession(id);
        await useCreateSessionStore.getState().refresh();
    },
    async removeSessions(ids) {
        let failed = false;
        for (const id of ids) {
            try {
                await deleteCreateSession(id);
            } catch (error) {
                console.error("[create-sessions] remove", id, error);
                failed = true;
            }
        }
        await useCreateSessionStore.getState().refresh();
        if (failed) throw new Error("CREATE_SESSION_DELETE_FAILED");
    },
}));
