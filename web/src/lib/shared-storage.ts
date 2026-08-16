import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

type SharedValueType = "blob" | "arrayBuffer" | "uint8Array" | "string" | "json" | "undefined";

export type SharedStore = {
    getItem: <T = unknown>(key: string) => Promise<T | null>;
    setItem: <T = unknown>(key: string, value: T) => Promise<T>;
    removeItem: (key: string) => Promise<void>;
    keys: () => Promise<string[]>;
    clear: () => Promise<void>;
    iterate: <T = unknown, U = void>(callback: (value: T, key: string, iterationNumber: number) => U | Promise<U>) => Promise<U | void>;
};

const SHARED_STORAGE_API = "/api/shared-storage";
const storeCache = new Map<string, SharedStore>();

function namespace(databaseName: string, storeName: string) {
    return `${databaseName}/${storeName}`;
}

function fallbackStore(databaseName: string, storeName: string) {
    return localforage.createInstance({ name: databaseName, storeName });
}

function endpoint(action: "item" | "keys", store: string, key?: string) {
    const params = new URLSearchParams({ store });
    if (key !== undefined) params.set("key", key);
    return `${SHARED_STORAGE_API}/${action}?${params.toString()}`;
}

async function encodeValue(value: unknown) {
    if (value instanceof Blob) return { body: value, type: "blob" as const, mimeType: value.type || "application/octet-stream" };
    if (value instanceof ArrayBuffer) return { body: value, type: "arrayBuffer" as const, mimeType: "application/octet-stream" };
    if (value instanceof Uint8Array) return { body: new Uint8Array(value).buffer as ArrayBuffer, type: "uint8Array" as const, mimeType: "application/octet-stream" };
    if (typeof value === "string") return { body: value, type: "string" as const, mimeType: "text/plain; charset=utf-8" };
    if (typeof value === "undefined") return { body: "", type: "undefined" as const, mimeType: "application/octet-stream" };
    return { body: JSON.stringify(value), type: "json" as const, mimeType: "application/json; charset=utf-8" };
}

async function decodeResponse<T>(response: Response) {
    const type = (response.headers.get("X-Shared-Storage-Type") || "json") as SharedValueType;
    const bytes = await response.arrayBuffer();
    if (type === "blob") return new Blob([bytes], { type: response.headers.get("Content-Type") || "application/octet-stream" }) as T;
    if (type === "arrayBuffer") return bytes as T;
    if (type === "uint8Array") return new Uint8Array(bytes) as T;
    if (type === "undefined") return undefined as T;
    const text = new TextDecoder().decode(bytes);
    if (type === "string") return text as T;
    return JSON.parse(text) as T;
}

async function remoteGet<T>(store: string, key: string) {
    const response = await fetch(endpoint("item", store, key), { cache: "no-store" });
    if (response.status === 404) return { found: false, value: null as T | null };
    if (!response.ok) throw new Error(`Shared storage GET failed: ${response.status}`);
    return { found: true, value: await decodeResponse<T>(response) };
}

async function remoteSet(store: string, key: string, value: unknown) {
    const encoded = await encodeValue(value);
    const response = await fetch(endpoint("item", store, key), {
        method: "PUT",
        body: encoded.body,
        headers: { "X-Shared-Storage-Type": encoded.type, "Content-Type": encoded.mimeType },
    });
    if (!response.ok) throw new Error(`Shared storage PUT failed: ${response.status}`);
}

async function remoteRemove(store: string, key: string) {
    const response = await fetch(endpoint("item", store, key), { method: "DELETE" });
    if (!response.ok && response.status !== 404) throw new Error(`Shared storage DELETE failed: ${response.status}`);
}

async function remoteKeys(store: string) {
    const response = await fetch(endpoint("keys", store), { cache: "no-store" });
    if (!response.ok) throw new Error(`Shared storage KEYS failed: ${response.status}`);
    return (await response.json()) as string[];
}

async function remoteClear(store: string) {
    const response = await fetch(endpoint("keys", store), { method: "DELETE" });
    if (!response.ok) throw new Error(`Shared storage CLEAR failed: ${response.status}`);
}

function createSharedStore(databaseName: string, storeName: string): SharedStore {
    const store = namespace(databaseName, storeName);
    const fallback = fallbackStore(databaseName, storeName);
    return {
        getItem: async <T>(key: string) => {
            try {
                const remote = await remoteGet<T>(store, key);
                if (remote.found) return remote.value;
                const local = await fallback.getItem<T>(key);
                if (local !== null) {
                    try {
                        await remoteSet(store, key, local);
                    } catch {
                        // Keep the browser-local value usable when the shared service is unavailable.
                    }
                }
                return local;
            } catch {
                return fallback.getItem<T>(key);
            }
        },
        setItem: async <T>(key: string, value: T) => {
            try {
                await remoteSet(store, key, value);
                await fallback.setItem(key, value);
            } catch {
                await fallback.setItem(key, value);
            }
            return value;
        },
        removeItem: async (key: string) => {
            await Promise.allSettled([remoteRemove(store, key), fallback.removeItem(key)]);
        },
        keys: async () => {
            try {
                const [remote, local] = await Promise.all([remoteKeys(store), fallback.keys()]);
                return Array.from(new Set([...remote, ...local]));
            } catch {
                return fallback.keys();
            }
        },
        clear: async () => {
            await Promise.allSettled([remoteClear(store), fallback.clear()]);
        },
        iterate: async <T, U>(callback: (value: T, key: string, iterationNumber: number) => U | Promise<U>) => {
            const keys = await (async () => {
                try {
                    return await remoteKeys(store);
                } catch {
                    return fallback.keys();
                }
            })();
            for (let index = 0; index < keys.length; index += 1) {
                const value = await (async () => {
                    try {
                        const remote = await remoteGet<T>(store, keys[index]);
                        if (remote.found) return remote.value;
                    } catch {
                        // Fall through to the browser-local copy.
                    }
                    return fallback.getItem<T>(keys[index]);
                })();
                const result = await callback(value as T, keys[index], index + 1);
                if (result !== undefined) return result;
            }
            return undefined;
        },
    };
}

export function getSharedStore(storeName: string, databaseName = "infinite-canvas") {
    const key = namespace(databaseName, storeName);
    const existing = storeCache.get(key);
    if (existing) return existing;
    const store = createSharedStore(databaseName, storeName);
    storeCache.set(key, store);
    return store;
}

const preferenceStore = getSharedStore("preferences");

export const sharedPreferenceStorage: StateStorage = {
    getItem: async (name) => {
        const shared = await preferenceStore.getItem<string>(name);
        if (shared !== null) return shared;
        const legacy = typeof window === "undefined" ? null : window.localStorage.getItem(name);
        if (legacy !== null) {
            try {
                await preferenceStore.setItem(name, legacy);
            } catch {
                // Keep the legacy preference usable when the shared service is unavailable.
            }
        }
        return legacy;
    },
    setItem: async (name, value) => {
        await preferenceStore.setItem(name, value);
        if (typeof window !== "undefined") window.localStorage.setItem(name, value);
    },
    removeItem: async (name) => {
        await Promise.allSettled([preferenceStore.removeItem(name), typeof window === "undefined" ? Promise.resolve() : Promise.resolve(window.localStorage.removeItem(name))]);
    },
};
