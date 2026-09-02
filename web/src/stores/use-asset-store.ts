import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { cleanupUnusedImages, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";
import { fetchBackendAssets, saveBackendAssets, backendMediaUrl } from "@/services/backend-api";
import { useBackendStore } from "@/stores/use-backend-store";

export type AssetKind = "text" | "image" | "video" | "audio" | "composite";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type AudioAsset = AssetBase<"audio"> & {
    data: { url: string; storageKey?: string; bytes: number; mimeType: string; durationMs?: number };
};
export type CompositeItem =
    | { itemType: "text"; content: string }
    | { itemType: "image"; url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string }
    | { itemType: "video"; url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string }
    | { itemType: "audio"; url: string; storageKey?: string; bytes: number; mimeType: string; durationMs?: number }
    | { itemType: "assetRef"; refId: string; refKind: "text" | "image" | "video" | "audio" };
export type CompositeAsset = AssetBase<"composite"> & { data: { items: CompositeItem[] } };
export type Asset = TextAsset | ImageAsset | VideoAsset | AudioAsset | CompositeAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    folderId?: string | null;
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

export type AssetFolder = { id: string; name: string; parentId: string | null; createdAt: string };

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    folders: AssetFolder[];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    removeAssets: (ids: string[]) => void;
    replaceAssets: (assets: Asset[]) => void;
    addFolder: (name: string, parentId?: string | null) => string;
    renameFolder: (id: string, name: string) => void;
    removeFolder: (id: string) => void;
    cleanupImages: (extra?: unknown) => void;
};

const ASSET_STORE_KEY = "infinite-canvas:asset_store";

/** 同步素材到总后台。 */
async function syncAssetsToBackend(assets: Asset[], folders: AssetFolder[]) {
    if (!useBackendStore.getState().connected) return;
    try {
        await saveBackendAssets(assets as unknown[], folders as unknown[]);
    } catch { /* fall back to localforage */ }
}

async function hydrateAssetsFromBackend() {
    if (!useBackendStore.getState().connected) return false;
    try {
        const response = await fetchBackendAssets();
        const remoteAssets = Array.isArray(response.assets) ? response.assets as unknown as Asset[] : [];
        const remoteFolders = Array.isArray(response.folders) ? response.folders as unknown as AssetFolder[] : [];
        if (remoteAssets.length) {
            const local = useAssetStore.getState();
            const assets = mergeByUpdatedAt(local.assets, remoteAssets);
            const folders = mergeById(local.folders, remoteFolders);
            useAssetStore.setState({ assets, folders });
            if (assets.length !== remoteAssets.length || folders.length !== remoteFolders.length) await syncAssetsToBackend(assets, folders);
            return true;
        }
        const state = useAssetStore.getState();
        if (state.assets.length) await syncAssetsToBackend(state.assets, state.folders);
        return true;
    } catch {
        return false;
    }
}

function mergeByUpdatedAt<T extends { id: string; updatedAt?: string }>(local: T[], remote: T[]) {
    const byId = new Map<string, T>();
    [...remote, ...local].forEach((item) => {
        const current = byId.get(item.id);
        if (!current || String(item.updatedAt || "") > String(current.updatedAt || "")) byId.set(item.id, item);
    });
    return [...byId.values()];
}

function mergeById<T extends { id: string }>(local: T[], remote: T[]) {
    const byId = new Map(remote.map((item) => [item.id, item]));
    local.forEach((item) => { if (!byId.has(item.id)) byId.set(item.id, item); });
    return [...byId.values()];
}

async function hydrateAssets() {
    await hydrateAssetsFromBackend();
}

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        parsed.state.folders = parsed.state.folders || [];
        parsed.state.assets = await Promise.all(
            parsed.state.assets.map(async (asset) => {
                if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind === "composite")
                    return {
                        ...asset,
                        data: {
                            items: await Promise.all(
                                asset.data.items.map(async (item) => {
                                    if (item.itemType === "image" && item.storageKey) return { ...item, url: await resolveImageUrl(item.storageKey, item.url) };
                                    if ((item.itemType === "video" || item.itemType === "audio") && item.storageKey) return { ...item, url: await resolveMediaUrl(item.storageKey, item.url) };
                                    return item;
                                }),
                            ),
                        },
                    };
                if (asset.kind !== "image") return asset;
                if (asset.data.storageKey)
                    return {
                        ...asset,
                        coverUrl: asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(asset.data.storageKey, asset.coverUrl) : asset.coverUrl,
                        data: { ...asset.data, dataUrl: await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl) },
                    };
                if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
                const image = await uploadImage(asset.data.dataUrl);
                return { ...asset, coverUrl: asset.coverUrl.startsWith("data:image/") ? image.url : asset.coverUrl, data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, mimeType: image.mimeType } };
            }),
        );
        return parsed;
    },
    setItem: (name, value) => localForageStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            assets: [],
            folders: [],
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                return id;
            },
            updateAsset: (id, patch) =>
                set((state) => ({
                    assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                })),
            removeAsset: (id) =>
                set((state) => {
                    const assets = state.assets.filter((asset) => asset.id !== id);
                    get().cleanupImages({ assets });
                    return { assets };
                }),
            removeAssets: (ids) =>
                set((state) => {
                    const idSet = new Set(ids);
                    const assets = state.assets.filter((asset) => !idSet.has(asset.id));
                    get().cleanupImages({ assets });
                    return { assets };
                }),
            replaceAssets: (assets) => {
                set({ assets });
                void syncAssetsToBackend(assets, get().folders);
            },
            addFolder: (name, parentId = null) => {
                const id = nanoid();
                set((state) => ({ folders: [...state.folders, { id, name: name.trim() || "新文件夹", parentId, createdAt: new Date().toISOString() }] }));
                return id;
            },
            renameFolder: (id, name) =>
                set((state) => ({ folders: state.folders.map((folder) => (folder.id === id ? { ...folder, name: name.trim() || folder.name } : folder)) })),
            removeFolder: (id) =>
                set((state) => {
                    const folders = state.folders.filter(folder => folder.id !== id && folder.parentId !== id);
                    const remaining = new Set(folders.map(folder => folder.id));
                    const assets = state.assets.map((asset) => (asset.folderId && asset.folderId !== id && remaining.has(asset.folderId) ? asset : { ...asset, folderId: null }));
                    return { folders, assets };
                }),
            cleanupImages: (extra) => {
                window.setTimeout(async () => {
                    const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
                    await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                    await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                }, 0);
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets, folders: state.folders }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => () => {
                useAssetStore.setState({ hydrated: true });
                void hydrateAssets();
            },
        },
    ),
);

if (typeof window !== "undefined") {
    window.addEventListener("backend-connected", () => {
        void hydrateAssets();
        if (useAssetStore.getState().assets.length || useAssetStore.getState().folders.length) {
            void syncAssetsToBackend(useAssetStore.getState().assets, useAssetStore.getState().folders);
        }
    });
}

export { syncAssetsToBackend, hydrateAssets };
