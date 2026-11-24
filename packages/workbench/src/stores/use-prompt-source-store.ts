import { create, type StateCreator } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { StorageError } from "@infinite-canvas/shared/storage-data";

import { DEFAULT_PROMPT_SOURCES, createPromptSource, type PromptSource } from "@workbench/services/api/prompt-source-presets";

export type PromptSourceSchedule = {
    intervalMinutes: number;
    lastFetchedAt: string;
};

const PROMPT_SOURCE_STORE_KEY = "infinite-canvas-v1:prompt_source_store";

const defaultSchedule: PromptSourceSchedule = {
    intervalMinutes: 30,
    lastFetchedAt: "",
};

export const PROMPT_SOURCE_INTERVALS = [0, 30, 60, 360, 1440];

type PromptSourceStore = {
    sources: PromptSource[];
    schedule: PromptSourceSchedule;
    addSource: () => PromptSource;
    saveSource: (source: PromptSource) => void;
    removeSource: (id: string) => void;
    toggleSource: (id: string, enabled: boolean) => void;
    updateSchedule: <K extends keyof PromptSourceSchedule>(key: K, value: PromptSourceSchedule[K]) => void;
    saveConfig: (config: PromptSourceConfig) => void;
};

type PromptSourceConfig = Pick<PromptSourceStore, "sources" | "schedule">;
const preferences = createJSONStorage<PromptSourceConfig>(() => localStorage);

const createPromptSourceState: StateCreator<PromptSourceStore, [], [["zustand/persist", PromptSourceConfig]]> = (publish, get, api) => {
    const save = (change: Partial<PromptSourceConfig>) => {
        const { sources, schedule } = get();
        const state = { sources: change.sources ?? sources, schedule: change.schedule ?? schedule };
        try {
            if (!preferences) throw new StorageError("STORAGE_UNAVAILABLE");
            preferences.setItem(PROMPT_SOURCE_STORE_KEY, { state, version: 0 });
        } catch (error) {
            console.error("[settings] save prompt sources", error);
            throw new StorageError("STORAGE_UNAVAILABLE");
        }
        publish(state);
    };
    return persist<PromptSourceStore, [], [], PromptSourceConfig>(
        () => ({
            sources: DEFAULT_PROMPT_SOURCES,
            schedule: defaultSchedule,
            addSource: () => createPromptSource(),
            saveSource: (source) => {
                const { sources } = get();
                save({ sources: sources.some((item) => item.id === source.id)
                    ? sources.map((item) => (item.id === source.id && !item.builtIn ? createPromptSource(source) : item))
                    : [...sources, createPromptSource(source)] });
            },
            removeSource: (id) => save({ sources: get().sources.filter((item) => item.id !== id || item.builtIn) }),
            toggleSource: (id, enabled) => save({ sources: get().sources.map((item) => (item.id === id ? { ...item, enabled } : item)) }),
            updateSchedule: (key, value) => save({ schedule: { ...get().schedule, [key]: value } }),
            saveConfig: save,
        }),
        {
            name: PROMPT_SOURCE_STORE_KEY,
            storage: preferences,
            partialize: (state) => ({ sources: state.sources, schedule: state.schedule }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<PromptSourceStore>;
                const savedSources = Array.isArray(persistedState.sources) ? persistedState.sources : [];
                const enabledById = new Map(savedSources.map((source) => [source.id, source.enabled]));
                const builtIn = DEFAULT_PROMPT_SOURCES.map((source) => ({ ...source, enabled: enabledById.get(source.id) ?? source.enabled }));
                const custom = savedSources.filter((source) => !source.builtIn).map((source) => createPromptSource(source));
                return { ...current, sources: [...builtIn, ...custom], schedule: { ...defaultSchedule, ...(persistedState.schedule || {}) } };
            },
        },
    )(publish, get, api);
};

export const usePromptSourceStore = create<PromptSourceStore>()(createPromptSourceState);
