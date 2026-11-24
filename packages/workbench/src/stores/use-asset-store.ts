import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { nanoid } from "nanoid";
import { serializeAsset } from "@workbench/lib/asset-utils";
import { appStateStorage } from "@workbench/services/storage/persist";
import { storage } from "@workbench/services/storage/runtime";
import { reportStorageError } from "@workbench/services/storage/status";
import { StorageError } from "@infinite-canvas/shared/storage-data";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { assetLibraryKey, assetLibrarySchema, defaultAssetFolderId, type StoredAsset, type StoredAssetFolder } from "@infinite-canvas/shared/sync-records";
import { previewUrlFor } from "@workbench/services/image-storage";

export type Asset = StoredAsset;
export type AssetKind = Asset["kind"];
export type AssetFolder = StoredAssetFolder;
export type TextAsset = Extract<Asset, { kind: "text" }>;
export type ImageAsset = Extract<Asset, { kind: "image" }>;
export type VideoAsset = Extract<Asset, { kind: "video" }>;
export type AudioAsset = Extract<Asset, { kind: "audio" }>;

type AssetStore = {
    hydrated: boolean;
    loadError: string;
    assets: Asset[];
    folders: AssetFolder[];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    addFolder: (name: string, parentId: string | null) => string;
    updateFolder: (id: string, patch: { name?: string; parentId?: string | null }) => void;
    removeFolder: (id: string) => void;
    replaceAssets: (assets: Asset[], synced?: boolean) => Promise<void>;
};

// 图片使用用户封面或已有缓存预览，其他素材保留其封面。
export function assetCoverUrl(asset: Asset) {
    if (asset.kind === "text") return undefined;
    return asset.kind === "image" ? asset.coverUrl || previewUrlFor(asset.data.storageKey) : asset.coverUrl;
}

let lastLocalAssets: Asset[] = [];
let lastLocalFolders: AssetFolder[] = [];
let fullReplacement: { assets: Asset[]; folders: AssetFolder[] } | undefined;
let reloadSyncAssets = false;
const pendingWrites: Array<() => Promise<unknown>> = [];
let assetWrite: Promise<void> | undefined;
const registeringMedia = new Map<string, Promise<string | null>>();

type GeneratedAsset = Omit<ImageAsset, "id" | "createdAt" | "updatedAt"> | Omit<VideoAsset, "id" | "createdAt" | "updatedAt"> | Omit<AudioAsset, "id" | "createdAt" | "updatedAt">;

function resultSource(asset: GeneratedAsset) {
    return asset.data.storageKey ?? (asset.kind === "image" ? asset.data.dataUrl : asset.data.url);
}

export async function saveGeneratedAsset(asset: GeneratedAsset): Promise<boolean> {
    const existing = asset.data.storageKey
        ? useAssetStore.getState().assets.find((item) => item.kind !== "text" && item.data.storageKey === asset.data.storageKey)
        : undefined;
    if (existing) return existing.kind === asset.kind;
    const id = useAssetStore.getState().addAsset(asset);
    await flushAssetWrites();
    const stored = useAssetStore.getState().assets.find((item) => item.id === id);
    return stored?.kind === asset.kind && stored.data.storageKey === asset.data.storageKey && resultSource(stored) === resultSource(asset);
}

export type MediaAssetInput = {
    kind: "image" | "video" | "audio";
    storageKey?: string;
    url?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    title?: string;
    source?: string;
    folderId?: string;
    metadata?: Record<string, unknown>;
};

function sameMediaAsset(asset: Asset, input: MediaAssetInput) {
    if (asset.kind === "text" || asset.kind !== input.kind) return false;
    if (input.storageKey) return asset.data.storageKey === input.storageKey;
    if (!input.url) return false;
    return asset.kind === "image" ? asset.data.dataUrl === input.url : asset.data.url === input.url;
}

/** 上传或生成得到的新文件自动进默认文件夹；同一原件只登记一条资产。 */
export function registerMediaAsset(input: MediaAssetInput): Promise<string | null> {
    if (!input.storageKey && !input.url) return Promise.resolve(null);
    const key = `${input.kind}:${input.storageKey ?? input.url}`;
    const pending = registeringMedia.get(key);
    if (pending) return pending;
    const task = registerMediaAssetOnce(input).finally(() => { if (registeringMedia.get(key) === task) registeringMedia.delete(key); });
    registeringMedia.set(key, task);
    return task;
}

async function registerMediaAssetOnce(input: MediaAssetInput): Promise<string | null> {
    if (!useAssetStore.getState().hydrated) {
        await new Promise<void>((resolve) => {
            if (useAssetStore.getState().hydrated || useAssetStore.getState().loadError) { resolve(); return; }
            const unsubscribe = useAssetStore.subscribe((state) => {
                if (!state.hydrated && !state.loadError) return;
                unsubscribe();
                resolve();
            });
            if (useAssetStore.getState().hydrated || useAssetStore.getState().loadError) { unsubscribe(); resolve(); }
        });
    }
    if (!useAssetStore.getState().hydrated) return null;
    const existing = useAssetStore.getState().assets.find((asset) => sameMediaAsset(asset, input));
    if (existing) return existing.id;
    const common = {
        title: input.title?.trim() || (input.kind === "image" ? "画布图片" : input.kind === "video" ? "画布视频" : "画布音频"),
        coverUrl: "", source: input.source ?? "上传",
        ...(input.folderId && { folderId: input.folderId }),
        ...(input.metadata && { metadata: input.metadata }),
    };
    const asset: GeneratedAsset = input.kind === "image"
        ? { ...common, kind: "image", data: { storageKey: input.storageKey, dataUrl: input.url, width: input.width, height: input.height, bytes: input.bytes, mimeType: input.mimeType } }
        : { ...common, kind: input.kind, data: { storageKey: input.storageKey, url: input.url, width: input.width, height: input.height, bytes: input.bytes, mimeType: input.mimeType } };
    if (!await saveGeneratedAsset(asset)) return null;
    return useAssetStore.getState().assets.find((item) => sameMediaAsset(item, input))?.id ?? null;
}

function assertAssetsLoaded() {
    if (!useAssetStore.getState().hydrated) throw new StorageError("STORAGE_UNAVAILABLE");
}

function savePendingAssetWrites() {
    const last = pendingWrites.at(-1)!;
    async function save() {
        if (!pendingWrites.includes(last)) return;
        while (pendingWrites.length) {
            const current = pendingWrites[0];
            await current();
            pendingWrites.shift();
            if (current === last) return;
        }
    }
    const saved = assetWrite ? assetWrite.then(save, save) : save();
    assetWrite = saved;
    void saved.then(() => { if (assetWrite === saved) assetWrite = undefined; }, reportStorageError);
    return saved;
}

export async function flushAssetWrites() {
    try { await assetWrite; } catch { /* 显式保存可重试尚未收到回执的编辑。 */ }
    if (pendingWrites.length) await savePendingAssetWrites();
}

async function readStoredAssets() {
    const value = await storage.state.getItem<string>(assetLibraryKey);
    if (value === null) return [];
    try {
        return assetLibrarySchema.parse(JSON.parse(value)).state.assets;
    } catch {
        throw new StorageError("STORAGE_INVALID");
    }
}

export async function readAssetsForSync() {
    assertAssetsLoaded();
    const current = useAssetStore.getState().assets;
    if (!reloadSyncAssets) return current;
    // 整库写回执未知时，先等本页后续条目编辑落盘，再读取真正的合并基线。
    await flushAssetWrites();
    const stored = await readStoredAssets();
    if (useAssetStore.getState().assets !== current) throw new PluginError("PLUGIN_CONFLICT");
    lastLocalAssets = stored;
    reloadSyncAssets = false;
    useAssetStore.setState({ assets: stored });
    return stored;
}

async function saveSyncedAssets(assets: Asset[]) {
    const previous = useAssetStore.getState().assets;
    const previousWrite = pendingWrites.length ? savePendingAssetWrites() : assetWrite?.catch(() => {});
    const value = JSON.stringify({ state: { assets: assets.map(serializeAsset), folders: useAssetStore.getState().folders }, version: 0 });
    const saved = Promise.resolve(previousWrite).then(async () => {
        if (reloadSyncAssets || useAssetStore.getState().assets !== previous) throw new PluginError("PLUGIN_CONFLICT");
        reloadSyncAssets = true;
        await storage.state.setItem(assetLibraryKey, value);
        if (useAssetStore.getState().assets !== previous) throw new PluginError("PLUGIN_CONFLICT");
        lastLocalAssets = assets;
        reloadSyncAssets = false;
        useAssetStore.setState({ assets });
    });
    assetWrite = saved;
    try { await saved; }
    finally { if (assetWrite === saved) assetWrite = undefined; }
}

export function appendImportedAssets(assets: Asset[], folders: AssetFolder[] = []) {
    assertAssetsLoaded();
    return useAssetStore.setState((state) => ({ assets: [...assets, ...state.assets], folders: [...folders, ...state.folders] }));
}

export const useAssetStore = create<AssetStore>()(
    persist(
        (set) => ({
            hydrated: false,
            loadError: "",
            assets: [],
            folders: [],
            addAsset: (asset) => {
                assertAssetsLoaded();
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, folderId: asset.folderId ?? defaultAssetFolderId, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                return id;
            },
            updateAsset: (id, patch) => {
                assertAssetsLoaded();
                set((state) => ({
                    assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                }));
            },
            removeAsset: (id) => {
                assertAssetsLoaded();
                set((state) => ({ assets: state.assets.filter((asset) => asset.id !== id) }));
            },
            addFolder: (name, parentId) => {
                assertAssetsLoaded();
                const trimmed = name.trim();
                if (!trimmed) throw new Error("ASSET_FOLDER_NAME_REQUIRED");
                if (parentId !== null && parentId !== defaultAssetFolderId && !useAssetStore.getState().folders.some((folder) => folder.id === parentId)) throw new Error("ASSET_FOLDER_MISSING");
                const id = nanoid();
                const now = new Date().toISOString();
                set((state) => ({ folders: [...state.folders, { id, name: trimmed, parentId, createdAt: now, updatedAt: now }] }));
                return id;
            },
            updateFolder: (id, patch) => {
                assertAssetsLoaded();
                const { folders } = useAssetStore.getState();
                if (id === defaultAssetFolderId || !folders.some((folder) => folder.id === id)) throw new Error("ASSET_FOLDER_MISSING");
                if (patch.name !== undefined && !patch.name.trim()) throw new Error("ASSET_FOLDER_NAME_REQUIRED");
                if (patch.parentId !== undefined && patch.parentId !== null) {
                    if (patch.parentId === id || patch.parentId !== defaultAssetFolderId && !folders.some((folder) => folder.id === patch.parentId)) throw new Error("ASSET_FOLDER_MISSING");
                    let parentId: string | null = patch.parentId;
                    while (parentId && parentId !== defaultAssetFolderId) {
                        if (parentId === id) throw new Error("ASSET_FOLDER_CYCLE");
                        parentId = folders.find((folder) => folder.id === parentId)?.parentId ?? null;
                    }
                }
                const now = new Date().toISOString();
                set((state) => ({ folders: state.folders.map((folder) => folder.id === id ? { ...folder, ...patch, ...(patch.name !== undefined && { name: patch.name.trim() }), updatedAt: now } : folder) }));
            },
            removeFolder: (id) => {
                assertAssetsLoaded();
                const { folders, assets } = useAssetStore.getState();
                if (id === defaultAssetFolderId) throw new Error("ASSET_FOLDER_DEFAULT");
                if (!folders.some((folder) => folder.id === id)) throw new Error("ASSET_FOLDER_MISSING");
                if (folders.some((folder) => folder.parentId === id) || assets.some((asset) => asset.folderId === id)) throw new Error("ASSET_FOLDER_NOT_EMPTY");
                set((state) => ({ folders: state.folders.filter((folder) => folder.id !== id) }));
            },
            async replaceAssets(assets, synced) {
                assertAssetsLoaded();
                if (synced) return saveSyncedAssets(assets);
                fullReplacement = { assets, folders: useAssetStore.getState().folders };
                await set({ assets });
            },
        }),
        {
            name: assetLibraryKey,
            storage: {
                ...createJSONStorage<Pick<AssetStore, "assets" | "folders">>(() => appStateStorage)!,
                setItem(key, { state: { assets, folders }, version }) {
                    if (!useAssetStore.getState().hydrated) return;
                    if (fullReplacement?.assets === assets) {
                        fullReplacement = undefined;
                        const value = JSON.stringify({ state: { assets: assets.map(serializeAsset), folders }, version });
                        pendingWrites.push(() => storage.state.setItem(key, value));
                    } else {
                        const before = new Map(lastLocalAssets.map((item) => [item.id, item]));
                        const put = assets.filter((item) => {
                            const changed = before.get(item.id) !== item;
                            before.delete(item.id);
                            return changed;
                        }).map(serializeAsset);
                        const remove = [...before.keys()];
                        const beforeFolders = new Map(lastLocalFolders.map((item) => [item.id, item]));
                        const folderPut = folders.filter((item) => {
                            const changed = beforeFolders.get(item.id) !== item;
                            beforeFolders.delete(item.id);
                            return changed;
                        });
                        const folderRemove = [...beforeFolders.keys()];
                        if (put.length || remove.length || folderPut.length || folderRemove.length) {
                            const edits = structuredClone({
                                put, remove,
                                ...(folderPut.length || folderRemove.length ? { folders: { put: folderPut, remove: folderRemove } } : {}),
                            });
                            pendingWrites.push(() => storage.editAssetLibrary(edits));
                        }
                    }
                    lastLocalAssets = assets;
                    lastLocalFolders = folders;
                    if (pendingWrites.length) return savePendingAssetWrites();
                },
            },
            partialize: (state) => ({ assets: state.assets, folders: state.folders }),
            merge: (persisted, current) => {
                const state = {
                    ...current,
                    ...(persisted as Pick<AssetStore, "assets" | "folders">),
                    folders: (persisted as Partial<Pick<AssetStore, "folders">>)?.folders ?? [],
                    hydrated: true, loadError: "",
                };
                lastLocalAssets = state.assets;
                lastLocalFolders = state.folders;
                return state;
            },
            onRehydrateStorage: () => (_, error) => {
                if (!error) return;
                reportStorageError(error);
                useAssetStore.setState({ hydrated: false, loadError: new StorageError("STORAGE_UNAVAILABLE").message });
            },
        },
    ),
);
