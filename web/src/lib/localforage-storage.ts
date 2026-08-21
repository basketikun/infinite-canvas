import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

const STORAGE_OPERATION_TIMEOUT = 1500;

function withTimeout<T>(operation: Promise<T>) {
    return Promise.race([
        operation,
        new Promise<never>((_, reject) => {
            window.setTimeout(() => reject(new Error("Local storage operation timed out")), STORAGE_OPERATION_TIMEOUT);
        }),
    ]);
}

localforage.config({
    name: "infinite-canvas",
    storeName: "app_state",
});

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        try {
            return (await withTimeout(localforage.getItem<string>(name))) || null;
        } catch {
            return window.localStorage.getItem(name);
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        try {
            await withTimeout(localforage.setItem(name, value));
        } catch {
            window.localStorage.setItem(name, value);
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        try {
            await withTimeout(localforage.removeItem(name));
        } catch {
            window.localStorage.removeItem(name);
        }
    },
};
