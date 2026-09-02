import { create } from "zustand";

import { nanoid } from "nanoid";
import { cleanupUnusedImages } from "@/services/image-storage";
import { cleanupUnusedMedia } from "@/services/file-storage";
import { fetchBackendAssets, saveBackendAssets } from "@/services/backend-api";
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

/** 同步素材到总后台。 */
async function syncAssetsToBackend(assets: Asset[], folders: AssetFolder[]) {
    if (!useBackendStore.getState().connected) return;
    try {
        await saveBackendAssets(assets as unknown[], folders as unknown[]);
    } catch { /* Backend 是唯一写入目标，失败由下一次同步重试 */ }
}

async function hydrateAssetsFromBackend() {
    if (!useBackendStore.getState().connected) return false;
    try {
        const response = await fetchBackendAssets();
        const remoteAssets = Array.isArray(response.assets) ? response.assets as unknown as Asset[] : [];
        const remoteFolders = Array.isArray(response.folders) ? response.folders as unknown as AssetFolder[] : [];
        useAssetStore.setState({ assets: remoteAssets, folders: remoteFolders });
        return true;
    } catch {
        return false;
    }
}

async function hydrateAssets() {
    await hydrateAssetsFromBackend();
    useAssetStore.setState({ hydrated: true });
}

export const useAssetStore = create<AssetStore>()((set, get) => ({
            hydrated: false,
            assets: [],
            folders: [],
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                scheduleAssetSync();
                return id;
            },
            updateAsset: (id, patch) => {
                set((state) => ({
                    assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                }));
                scheduleAssetSync();
            },
            removeAsset: (id) => {
                set((state) => {
                    const assets = state.assets.filter((asset) => asset.id !== id);
                    get().cleanupImages({ assets });
                    return { assets };
                });
                scheduleAssetSync();
            },
            removeAssets: (ids) => {
                set((state) => {
                    const idSet = new Set(ids);
                    const assets = state.assets.filter((asset) => !idSet.has(asset.id));
                    get().cleanupImages({ assets });
                    return { assets };
                });
                scheduleAssetSync();
            },
            replaceAssets: (assets) => {
                set({ assets });
                scheduleAssetSync();
            },
            addFolder: (name, parentId = null) => {
                const id = nanoid();
                set((state) => ({ folders: [...state.folders, { id, name: name.trim() || "新文件夹", parentId, createdAt: new Date().toISOString() }] }));
                scheduleAssetSync();
                return id;
            },
            renameFolder: (id, name) => {
                set((state) => ({ folders: state.folders.map((folder) => (folder.id === id ? { ...folder, name: name.trim() || folder.name } : folder)) }));
                scheduleAssetSync();
            },
            removeFolder: (id) => {
                set((state) => {
                    const folders = state.folders.filter(folder => folder.id !== id && folder.parentId !== id);
                    const remaining = new Set(folders.map(folder => folder.id));
                    const assets = state.assets.map((asset) => (asset.folderId && asset.folderId !== id && remaining.has(asset.folderId) ? asset : { ...asset, folderId: null }));
                    return { folders, assets };
                });
                scheduleAssetSync();
            },
            cleanupImages: (extra) => {
                window.setTimeout(async () => {
                    const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
                    await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                    await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                }, 0);
            },
        }));

let assetSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAssetSync() {
    if (assetSaveTimer) clearTimeout(assetSaveTimer);
    assetSaveTimer = setTimeout(() => {
        assetSaveTimer = null;
        const state = useAssetStore.getState();
        void syncAssetsToBackend(state.assets, state.folders);
    }, 400);
}

if (typeof window !== "undefined") {
    window.addEventListener("backend-connected", () => {
        void hydrateAssets();
    });
}

export { syncAssetsToBackend, hydrateAssets };
