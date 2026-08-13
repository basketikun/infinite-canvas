import localforage from "localforage";

import i18n from "@/i18n";
import { cleanupUnusedMedia, getMediaBlob, resolveMediaUrl, setMediaBlob } from "@/services/file-storage";
import { cleanupUnusedImages, getImageBlob, resolveImageUrl, setImageBlob } from "@/services/image-storage";
import { deleteWebdavFile, downloadWebdavFile, uploadWebdavFile, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import type { AppSyncBaseline, AppSyncTrashDomainKey, AppSyncTrashEntry } from "@/services/app-sync-trash";
import { getAppSyncTargetFingerprint, listAllLocalAppSyncTrash, listLocalAppSyncTrash, readAppSyncBaseline, removeLocalAppSyncTrash, replaceLocalAppSyncTrash, writeAppSyncBaseline } from "@/services/app-sync-trash";
import type { Asset } from "@/stores/use-asset-store";
import { useAssetStore } from "@/stores/use-asset-store";
import type { WebdavSyncConfig } from "@/stores/use-config-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

type StoredLog = Record<string, unknown> & { id?: string };
export type AppSyncDomainKey = AppSyncTrashDomainKey;
type DomainKey = AppSyncDomainKey;
type DomainItem = { id?: string };
type TimeKey = "updatedAt" | "createdAt";
type DomainClockFields = Partial<Record<TimeKey, unknown>>;
type CanvasDomainData = { projects: CanvasProject[] };
type AssetDomainData = { assets: Asset[] };
type LogDomainData = { logs: StoredLog[] };

type AppSyncFile = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

type DomainManifest<TData, TItem extends DomainItem> = {
    app: "infinite-canvas";
    version: 2;
    domain: DomainKey;
    exportedAt: string;
    data: TData;
    trash: AppSyncTrashEntry<TItem>[];
    files: AppSyncFile[];
    pendingDeletes: AppSyncFile[];
};

type SyncDomainOptions<TData, TItem extends DomainItem> = {
    key: DomainKey;
    label: string;
    localData: () => Promise<TData>;
    emptyData: TData;
    getItems: (data: TData) => TItem[];
    makeData: (items: TItem[]) => TData;
    timeKey: TimeKey;
    touchItem: (item: TItem, now: string) => TItem;
    applyData?: (data: TData) => Promise<void>;
};

export type AppSyncTestDomainOptions<TData, TItem extends DomainItem> = Pick<SyncDomainOptions<TData, TItem>, "key" | "emptyData" | "getItems" | "makeData" | "timeKey">;
export type AppSyncTestDomainManifest<TData, TItem extends DomainItem> = DomainManifest<TData, TItem>;
export type AppSyncTestFile = AppSyncFile;

type SyncDomainResult<TData> = {
    data: TData;
    mergedRemote: boolean;
    files: number;
    manifestBytes: number;
    uploadedFiles: number;
    uploadedBytes: number;
};

type ClearDomainState = {
    domain: DomainKey;
    manifest: DomainManifest<unknown, DomainItem> | null;
    activeData: unknown;
    liveIds: string[];
    activeFiles: AppSyncFile[];
    deleteCandidates: AppSyncFile[];
    localTrashIds: string[];
    clearedTrashIds: string[];
};

export type AppSyncResult = {
    syncedAt: string;
    mergedRemote: boolean;
    projects: number;
    assets: number;
    imageLogs: number;
    videoLogs: number;
    files: number;
    manifestBytes: number;
    uploadedFiles: number;
    uploadedBytes: number;
};

export type AppSyncProgressEvent = {
    domain?: AppSyncDomainKey;
    label?: string;
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

export type AppSyncProgress = (event: AppSyncProgressEvent) => void;

export type AppSyncTrashListEntry = {
    key: string;
    domain: AppSyncDomainKey;
    id: string;
    deletedAt: string;
    title: string;
};

type WorkbenchLogDomain = Extract<AppSyncDomainKey, "image-workbench" | "video-workbench">;

const FILE_CONCURRENCY = 3;
const workbenchLogsChangedEvent = "infinite-canvas:app-sync-workbench-logs-changed";
const domainKeys: DomainKey[] = ["canvas", "assets", "image-workbench", "video-workbench"];
const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
type LogStore = typeof imageLogStore;
const storageKeyPattern = /^(image|video|audio|file|video-reference|audio-reference):/;

export async function syncAppDataToWebdav(config: WebdavSyncConfig, onProgress?: AppSyncProgress): Promise<AppSyncResult> {
    emitProgress(onProgress, { stage: "等待本地数据加载" });
    await Promise.all([waitForHydration(useCanvasStore), waitForHydration(useAssetStore)]);

    const [canvas, assets, imageLogs, videoLogs] = await Promise.all([
        syncDomain<CanvasDomainData, CanvasProject>(config, onProgress, canvasOptions()),
        syncDomain<AssetDomainData, Asset>(config, onProgress, assetOptions()),
        syncDomain<LogDomainData, StoredLog>(config, onProgress, imageLogOptions()),
        syncDomain<LogDomainData, StoredLog>(config, onProgress, videoLogOptions()),
    ]);

    const result = {
        syncedAt: new Date().toISOString(),
        mergedRemote: [canvas, assets, imageLogs, videoLogs].some((item) => item.mergedRemote),
        projects: canvas.data.projects.length,
        assets: assets.data.assets.length,
        imageLogs: imageLogs.data.logs.length,
        videoLogs: videoLogs.data.logs.length,
        files: canvas.files + assets.files + imageLogs.files + videoLogs.files,
        manifestBytes: canvas.manifestBytes + assets.manifestBytes + imageLogs.manifestBytes + videoLogs.manifestBytes,
        uploadedFiles: canvas.uploadedFiles + assets.uploadedFiles + imageLogs.uploadedFiles + videoLogs.uploadedFiles,
        uploadedBytes: canvas.uploadedBytes + assets.uploadedBytes + imageLogs.uploadedBytes + videoLogs.uploadedBytes,
    };
    emitProgress(onProgress, { stage: "同步完成", status: "success" });
    return result;
}

export async function listAppSyncTrash(config: WebdavSyncConfig): Promise<AppSyncTrashListEntry[]> {
    const targetKey = appSyncTargetKey(config);
    const [remoteLists, localLists] = await Promise.all([Promise.all(domainKeys.map((domain) => listDomainTrash(config, domain))), Promise.all(domainKeys.map((domain) => listLocalDomainTrash(targetKey, domain)))]);
    const byKey = new Map<string, AppSyncTrashListEntry>();
    [...remoteLists.flat(), ...localLists.flat()].forEach((entry) => {
        const current = byKey.get(entry.key);
        if (!current || Date.parse(entry.deletedAt) >= Date.parse(current.deletedAt)) byKey.set(entry.key, entry);
    });
    return Array.from(byKey.values()).sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt));
}

export async function restoreAppSyncTrashEntry(config: WebdavSyncConfig, domain: AppSyncDomainKey, id: string, onProgress?: AppSyncProgress) {
    if (domain === "canvas") return restoreDomainTrashEntry<CanvasDomainData, CanvasProject>(config, id, onProgress, canvasOptions());
    if (domain === "assets") return restoreDomainTrashEntry<AssetDomainData, Asset>(config, id, onProgress, assetOptions());
    if (domain === "image-workbench") return restoreDomainTrashEntry<LogDomainData, StoredLog>(config, id, onProgress, imageLogOptions());
    return restoreDomainTrashEntry<LogDomainData, StoredLog>(config, id, onProgress, videoLogOptions());
}

export async function clearAppSyncTrash(config: WebdavSyncConfig, onProgress?: AppSyncProgress) {
    const targetKey = appSyncTargetKey(config);
    const states = await Promise.all(domainKeys.map((domain) => readClearDomainState(config, targetKey, domain)));
    await Promise.all(states.filter((state) => !state.manifest).map((state) => removeLocalAppSyncTrash(targetKey, state.domain, state.localTrashIds)));
    await runWithConcurrency(
        states.filter((state) => state.manifest),
        FILE_CONCURRENCY,
        async (state) => {
            if (!state.manifest) return;
            const trashIds = state.manifest.trash.map((entry) => entry.id);
            await uploadClearManifest(config, state, state.deleteCandidates, onProgress);
            await runWithConcurrency(state.deleteCandidates, FILE_CONCURRENCY, async (file, index) => {
                await deleteWebdavFile(config, file.path);
                emitProgress(onProgress, { domain: state.domain, label: domainLabel(state.domain), stage: "清理远端媒体", current: index + 1, total: state.deleteCandidates.length, status: "active" });
            });
            await uploadClearManifest(config, state, [], onProgress);
            state.clearedTrashIds = trashIds;
        },
    );

    await Promise.all(
        states.map(async (state) => {
            if (!state.manifest) return;
            await removeLocalAppSyncTrash(targetKey, state.domain, new Set([...state.clearedTrashIds, ...state.localTrashIds]));
            await writeAppSyncBaseline(targetKey, state.domain, { liveIds: state.liveIds, trashIds: [], updatedAt: new Date().toISOString() });
        }),
    );
    await cleanupUnusedLocalMedia().catch((error) => console.error("Failed to clean unused local media after WebDAV trash clear", error));
    emitProgress(onProgress, { stage: "回收站已清空", status: "success" });
}

export function subscribeAppSyncWorkbenchLogsChanged(domain: WorkbenchLogDomain, listener: () => void) {
    const handler = (event: Event) => {
        if (event instanceof CustomEvent && event.detail === domain) listener();
    };
    window.addEventListener(workbenchLogsChangedEvent, handler);
    return () => window.removeEventListener(workbenchLogsChangedEvent, handler);
}

async function syncDomain<TData, TItem extends DomainItem>(config: WebdavSyncConfig, onProgress: AppSyncProgress | undefined, options: SyncDomainOptions<TData, TItem>): Promise<SyncDomainResult<TData>> {
    try {
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "读取远端清单", status: "active" });
        const remoteManifest = await readDomainManifest<TData, TItem>(config, options.key, options.emptyData);
        if (remoteManifest?.pendingDeletes.length) await finishPendingDeletes(config, options.key, remoteManifest.pendingDeletes, onProgress);
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "读取本地数据", status: "active" });
        const targetKey = appSyncTargetKey(config);
        const [localData, localTrash, baseline] = await Promise.all([options.localData(), listLocalAppSyncTrash<TItem>(targetKey, options.key), readAppSyncBaseline(targetKey, options.key)]);
        const merged = mergeDomainState(localData, localTrash, remoteManifest, baseline, options);

        if (remoteManifest) {
            emitProgress(onProgress, { domain: options.key, label: options.label, stage: "下载缺失媒体", status: "active" });
            await downloadMissingFiles(config, options.key, merged.data, remoteManifest.files, onProgress);
            emitProgress(onProgress, { domain: options.key, label: options.label, stage: "写入本地合并结果", status: "active" });
            await options.applyData?.(merged.data);
        }
        await replaceLocalAppSyncTrash(targetKey, options.key, merged.trash, localTrash);

        const uploaded = await uploadDomainManifest(config, options, merged.data, merged.trash, remoteManifest?.files || [], onProgress);
        await writeDomainBaseline(config, options, merged.data, merged.trash);
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "完成", current: 1, total: 1, status: "success" });

        return {
            data: merged.data,
            mergedRemote: Boolean(remoteManifest),
            files: uploaded.files.length,
            manifestBytes: uploaded.manifestBytes,
            uploadedFiles: uploaded.uploadedFiles,
            uploadedBytes: uploaded.uploadedBytes,
        };
    } catch (error) {
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: error instanceof Error ? error.message : i18n.t("config.webdav.errors.syncFailed"), status: "exception" });
        throw error;
    }
}

async function listDomainTrash(config: WebdavSyncConfig, domain: DomainKey): Promise<AppSyncTrashListEntry[]> {
    if (domain === "canvas") return listTypedDomainTrash(config, canvasOptions());
    if (domain === "assets") return listTypedDomainTrash(config, assetOptions());
    if (domain === "image-workbench") return listTypedDomainTrash(config, imageLogOptions());
    return listTypedDomainTrash(config, videoLogOptions());
}

async function listTypedDomainTrash<TData, TItem extends DomainItem>(config: WebdavSyncConfig, options: SyncDomainOptions<TData, TItem>): Promise<AppSyncTrashListEntry[]> {
    const manifest = await readDomainManifest<TData, TItem>(config, options.key, options.emptyData);
    if (!manifest) return [];
    return manifest.trash.map((entry: AppSyncTrashEntry<TItem>) => ({ key: `${options.key}:${entry.id}`, domain: options.key, id: entry.id, deletedAt: entry.deletedAt, title: trashTitle(options.key, entry.item) }));
}

async function listLocalDomainTrash(targetKey: string, domain: DomainKey): Promise<AppSyncTrashListEntry[]> {
    const entries = await listLocalAppSyncTrash<DomainItem>(targetKey, domain);
    return entries.map((entry) => ({ key: `${domain}:${entry.id}`, domain, id: entry.id, deletedAt: entry.deletedAt, title: trashTitle(domain, entry.item) }));
}

async function restoreDomainTrashEntry<TData, TItem extends DomainItem>(config: WebdavSyncConfig, id: string, onProgress: AppSyncProgress | undefined, options: SyncDomainOptions<TData, TItem>) {
    await waitForDomainHydration(options.key);
    const [remoteManifest, localData, localTrash, baseline] = await Promise.all([
        readDomainManifest<TData, TItem>(config, options.key, options.emptyData),
        options.localData(),
        listLocalAppSyncTrash<TItem>(appSyncTargetKey(config), options.key),
        readAppSyncBaseline(appSyncTargetKey(config), options.key),
    ]);
    if (remoteManifest?.pendingDeletes.length) await finishPendingDeletes(config, options.key, remoteManifest.pendingDeletes, onProgress);
    const remoteTrash = remoteManifest?.trash || [];
    const trashEntry = [remoteTrash.find((entry: AppSyncTrashEntry<TItem>) => entry.id === id), localTrash.find((entry: AppSyncTrashEntry<TItem>) => entry.id === id)]
        .filter((entry): entry is AppSyncTrashEntry<TItem> => Boolean(entry))
        .sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt))[0];
    if (!trashEntry) throw new Error(i18n.t("config.webdav.errors.trashNotFound"));

    const restoredItem = options.touchItem(withEntryId(trashEntry), new Date().toISOString());
    const localItems = [restoredItem, ...options.getItems(localData).filter((item) => itemId(item) !== id)];
    const nextLocalTrash = localTrash.filter((entry: AppSyncTrashEntry<TItem>) => entry.id !== id);
    const nextRemoteManifest = remoteManifest ? { ...remoteManifest, trash: remoteTrash.filter((entry: AppSyncTrashEntry<TItem>) => entry.id !== id) } : null;
    const merged = mergeDomainState(options.makeData(localItems), nextLocalTrash, nextRemoteManifest, baseline, options);

    emitProgress(onProgress, { domain: options.key, label: options.label, stage: "下载缺失媒体", status: "active" });
    await downloadMissingFiles(config, options.key, merged.data, remoteManifest?.files || [], onProgress);
    await options.applyData?.(merged.data);
    notifyWorkbenchLogsChanged(options.key);
    await replaceLocalAppSyncTrash(appSyncTargetKey(config), options.key, merged.trash, localTrash);
    await uploadDomainManifest(config, options, merged.data, merged.trash, remoteManifest?.files || [], onProgress);
    await writeDomainBaseline(config, options, merged.data, merged.trash);
    emitProgress(onProgress, { domain: options.key, label: options.label, stage: "已恢复", status: "success" });
}

async function readClearDomainState(config: WebdavSyncConfig, targetKey: string, domain: DomainKey) {
    if (domain === "canvas") return readTypedClearDomainState(config, targetKey, canvasOptions());
    if (domain === "assets") return readTypedClearDomainState(config, targetKey, assetOptions());
    if (domain === "image-workbench") return readTypedClearDomainState(config, targetKey, imageLogOptions());
    return readTypedClearDomainState(config, targetKey, videoLogOptions());
}

async function readTypedClearDomainState<TData, TItem extends DomainItem>(config: WebdavSyncConfig, targetKey: string, options: SyncDomainOptions<TData, TItem>): Promise<ClearDomainState> {
    const [manifest, localTrash] = await Promise.all([readDomainManifest<TData, TItem>(config, options.key, options.emptyData), listLocalAppSyncTrash<TItem>(targetKey, options.key)]);
    const localTrashIds = new Set(localTrash.map((entry) => entry.id));
    const clearPlan = planClearDomainState(manifest, localTrash, options);
    return {
        domain: options.key,
        manifest,
        activeData: clearPlan.activeData,
        liveIds: clearPlan.liveIds,
        activeFiles: clearPlan.activeFiles,
        deleteCandidates: clearPlan.deleteCandidates,
        localTrashIds: localTrash.map((entry) => entry.id),
        clearedTrashIds: [],
    };
}

async function uploadClearManifest(config: WebdavSyncConfig, state: ClearDomainState, pendingDeletes: AppSyncFile[], onProgress?: AppSyncProgress) {
    if (!state.manifest) return;
    const manifest = { ...state.manifest, exportedAt: new Date().toISOString(), data: state.activeData, trash: [], files: state.activeFiles, pendingDeletes };
    const manifestFile = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    emitProgress(onProgress, { domain: state.domain, label: domainLabel(state.domain), stage: `上传清单 ${formatBytes(manifestFile.size)}`, status: "active" });
    await uploadWebdavFile(config, domainPath(state.domain, WEBDAV_MANIFEST_FILE_NAME), manifestFile, "application/json");
}

async function finishPendingDeletes(config: WebdavSyncConfig, domain: DomainKey, pendingDeletes: AppSyncFile[], onProgress?: AppSyncProgress) {
    await runWithConcurrency(pendingDeletes, FILE_CONCURRENCY, async (file, index) => {
        await deleteWebdavFile(config, file.path);
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "清理远端媒体", current: index + 1, total: pendingDeletes.length, status: "active" });
    });
}

async function readDomainManifest<TData, TItem extends DomainItem>(config: WebdavSyncConfig, domain: DomainKey, emptyData: TData): Promise<DomainManifest<TData, TItem> | null> {
    const file = await downloadWebdavFile(config, domainPath(domain, WEBDAV_MANIFEST_FILE_NAME));
    if (!file) return null;
    return normalizeDomainManifest<TData, TItem>(domain, emptyData, JSON.parse(await file.text()));
}

function normalizeDomainManifest<TData, TItem extends DomainItem>(domain: DomainKey, emptyData: TData, value: unknown): DomainManifest<TData, TItem> {
    const data = value as Partial<Omit<DomainManifest<TData, TItem>, "version">> & { version?: 1 | 2 };
    const manifestVersion: number | undefined = data.version;
    if (data.app !== "infinite-canvas" || data.domain !== domain || (manifestVersion !== 1 && manifestVersion !== 2)) throw new Error(i18n.t("config.webdav.errors.invalidManifest", { domain }));
    return {
        app: "infinite-canvas",
        version: 2,
        domain,
        exportedAt: data.exportedAt || new Date().toISOString(),
        data: data.data || emptyData,
        trash: manifestVersion === 2 && Array.isArray(data.trash) ? data.trash.filter((entry) => Boolean(entry?.id && entry.deletedAt && entry.item)) : [],
        files: validateManifestFiles(domain, data.files),
        pendingDeletes: manifestVersion === 2 ? validateManifestFiles(domain, data.pendingDeletes) : [],
    };
}

async function uploadDomainManifest<TData, TItem extends DomainItem>(config: WebdavSyncConfig, options: SyncDomainOptions<TData, TItem>, data: TData, trash: AppSyncTrashEntry<TItem>[], remoteFiles: AppSyncFile[], onProgress?: AppSyncProgress, pendingDeletes: AppSyncFile[] = []) {
    emitProgress(onProgress, { domain: options.key, label: options.label, stage: "上传新增媒体", status: "active" });
    const uploaded = await uploadChangedFiles(config, options.key, { data, trash }, remoteFiles, onProgress);
    const manifest: DomainManifest<TData, TItem> = { app: "infinite-canvas", version: 2, domain: options.key, exportedAt: new Date().toISOString(), data, trash, files: uploaded.files, pendingDeletes };
    const manifestFile = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    emitProgress(onProgress, { domain: options.key, label: options.label, stage: `上传清单 ${formatBytes(manifestFile.size)}`, status: "active" });
    await uploadWebdavFile(config, domainPath(options.key, WEBDAV_MANIFEST_FILE_NAME), manifestFile, "application/json");
    return { ...uploaded, manifestBytes: manifestFile.size };
}

function mergeDomainState<TData, TItem extends DomainItem>(localData: TData, localTrash: AppSyncTrashEntry<TItem>[], remoteManifest: DomainManifest<TData, TItem> | null, baseline: AppSyncBaseline | null, options: AppSyncTestDomainOptions<TData, TItem>) {
    const remoteData = remoteManifest?.data || options.emptyData;
    const remoteItems = options.getItems(remoteData);
    const remoteLiveIds = new Set(remoteItems.map(itemId).filter(Boolean));
    const remoteTrash = remoteManifest?.trash || [];
    const remoteTrashMap = new Map(remoteTrash.map((entry) => [entry.id, entry]));
    const baselineLiveIds = new Set(baseline?.liveIds || []);
    const baselineTrashIds = new Set(baseline?.trashIds || []);
    const trashMap = new Map<string, AppSyncTrashEntry<TItem>>();

    remoteTrash.forEach((entry) => trashMap.set(entry.id, entry));
    localTrash.forEach((entry) => {
        if (remoteManifest && !remoteTrashMap.has(entry.id) && baselineTrashIds.has(entry.id)) return;
        const current = trashMap.get(entry.id);
        if (!current || Date.parse(entry.deletedAt) >= Date.parse(current.deletedAt)) trashMap.set(entry.id, entry);
    });

    const liveMap = new Map<string, TItem>();
    const addLive = (item: TItem, local: boolean) => {
        const id = itemId(item);
        if (!id) return;
        if (local && remoteManifest && baselineLiveIds.has(id) && !remoteLiveIds.has(id) && !remoteTrashMap.has(id)) return;
        const current = liveMap.get(id);
        if (!current || getTime(item, options.timeKey) >= getTime(current, options.timeKey)) liveMap.set(id, item);
    };
    remoteItems.forEach((item) => addLive(item, false));
    options.getItems(localData).forEach((item) => addLive(item, true));

    Array.from(liveMap.entries()).forEach(([id, item]) => {
        const trash = trashMap.get(id);
        if (!trash) return;
        if (getTime(item, options.timeKey) > Date.parse(trash.deletedAt)) {
            trashMap.delete(id);
            return;
        }
        liveMap.delete(id);
    });

    return {
        data: options.makeData(Array.from(liveMap.values()).sort((a, b) => getTime(b, options.timeKey) - getTime(a, options.timeKey))),
        trash: Array.from(trashMap.values()).sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt)),
    };
}

function planClearDomainState<TData, TItem extends DomainItem>(manifest: DomainManifest<TData, TItem> | null, localTrash: AppSyncTrashEntry<TItem>[], options: AppSyncTestDomainOptions<TData, TItem>) {
    const localTrashById = new Map(localTrash.map((entry) => [entry.id, entry]));
    const activeItems = manifest
        ? options.getItems(manifest.data).filter((item) => {
              const trash = localTrashById.get(itemId(item));
              return !trash || getTime(item, options.timeKey) > Date.parse(trash.deletedAt);
          })
        : [];
    const activeData = manifest ? options.makeData(activeItems) : null;
    const retainedStorageKeys = new Set(manifest ? collectStorageKeys({ data: activeData, trash: [] }) : []);
    const activeFiles = manifest ? manifest.files.filter((file) => retainedStorageKeys.has(file.storageKey)) : [];
    const activePaths = new Set(activeFiles.map((file) => file.path));
    const deleteCandidates = manifest ? Array.from(new Map([...manifest.files.filter((file) => !activePaths.has(file.path)), ...manifest.pendingDeletes.filter((file) => !activePaths.has(file.path))].map((file) => [file.path, file])).values()) : [];
    return { activeItems, activeData, activeFiles, deleteCandidates, liveIds: activeItems.map(itemId).filter(Boolean) };
}

function validateManifestFiles(domain: DomainKey, value: unknown): AppSyncFile[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => validateManifestFile(domain, item));
}

function validateManifestFile(domain: DomainKey, value: unknown): AppSyncFile {
    if (!value || typeof value !== "object") throw new Error(i18n.t("config.webdav.errors.invalidManifest", { domain }));
    const item = value as Partial<AppSyncFile>;
    if (typeof item.storageKey !== "string" || !storageKeyPattern.test(item.storageKey) || !item.storageKey.split(":").slice(1).join(":").trim()) throw new Error(i18n.t("config.webdav.errors.invalidManifest", { domain }));
    if (typeof item.path !== "string" || !isSafeDomainFilePath(domain, item.path)) throw new Error(i18n.t("config.webdav.errors.invalidManifest", { domain }));
    if (typeof item.mimeType !== "string") throw new Error(i18n.t("config.webdav.errors.invalidManifest", { domain }));
    if (typeof item.bytes !== "number" || !Number.isFinite(item.bytes) || item.bytes < 0) throw new Error(i18n.t("config.webdav.errors.invalidManifest", { domain }));
    return { storageKey: item.storageKey, path: item.path, mimeType: item.mimeType, bytes: item.bytes };
}

function isSafeDomainFilePath(domain: DomainKey, path: string) {
    const prefix = `${domain}/files/`;
    if (!path.startsWith(prefix)) return false;
    const filename = path.slice(prefix.length);
    if (!filename || filename === "." || filename === "..") return false;
    if (filename.includes("/") || filename.includes("\\")) return false;
    return path === `${prefix}${filename}`;
}

export const __appSyncTest = {
    normalizeDomainManifest,
    validateManifestFiles,
    isSafeDomainFilePath,
    mergeDomainState,
    planClearDomainState,
};

async function downloadMissingFiles<T>(config: WebdavSyncConfig, domain: DomainKey, data: T, remoteFiles: AppSyncFile[], onProgress?: AppSyncProgress) {
    const remoteFileMap = new Map(remoteFiles.map((item) => [item.storageKey, item]));
    const tasks: AppSyncFile[] = [];
    const storageKeys = collectStorageKeys(data);
    let scanned = 0;
    for (const storageKey of storageKeys) {
        const localBlob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        scanned += 1;
        if (localBlob) {
            emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查缺失媒体", current: scanned, total: storageKeys.length, status: "active" });
            continue;
        }
        const remoteFile = remoteFileMap.get(storageKey);
        if (remoteFile) tasks.push(remoteFile);
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查缺失媒体", current: scanned, total: storageKeys.length, status: "active" });
    }
    if (!tasks.length) {
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "媒体已齐全", current: 1, total: 1, status: "active" });
        return;
    }
    let downloaded = 0;
    await runWithConcurrency(tasks, FILE_CONCURRENCY, async (remoteFile) => {
        const blob = await downloadWebdavFile(config, remoteFile.path);
        if (!blob) return;
        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, remoteFile.mimeType);
        await (remoteFile.storageKey.startsWith("image:") ? setImageBlob(remoteFile.storageKey, typedBlob) : setMediaBlob(remoteFile.storageKey, typedBlob));
        downloaded += 1;
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "下载媒体", current: downloaded, total: tasks.length, status: "active" });
    });
}

async function uploadChangedFiles<T>(config: WebdavSyncConfig, domain: DomainKey, data: T, remoteFiles: AppSyncFile[], onProgress?: AppSyncProgress) {
    const remoteFileMap = new Map(remoteFiles.map((item) => [item.storageKey, item]));
    const files: AppSyncFile[] = [];
    const tasks: Array<{ item: AppSyncFile; blob: Blob }> = [];
    let uploadedFiles = 0;
    let uploadedBytes = 0;

    const storageKeys = collectStorageKeys(data);
    let scanned = 0;
    for (const storageKey of storageKeys) {
        const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        const remoteFile = remoteFileMap.get(storageKey);
        if (!blob) {
            if (remoteFile) files.push(remoteFile);
            scanned += 1;
            emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查本地媒体", current: scanned, total: storageKeys.length, status: "active" });
            continue;
        }
        const item: AppSyncFile = {
            storageKey,
            path: remoteFile?.path || domainPath(domain, `files/${safeFileName(storageKey)}.${fileExtension(blob.type, storageKey)}`),
            mimeType: blob.type || remoteFile?.mimeType || "application/octet-stream",
            bytes: blob.size,
        };
        files.push(item);
        if (!remoteFile || remoteFile.bytes !== blob.size) tasks.push({ item, blob });
        scanned += 1;
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查本地媒体", current: scanned, total: storageKeys.length, status: "active" });
    }

    if (!tasks.length) {
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "媒体无需上传", current: 1, total: 1, status: "active" });
        return { files, uploadedFiles, uploadedBytes };
    }

    await runWithConcurrency(tasks, FILE_CONCURRENCY, async ({ item, blob }) => {
        await uploadWebdavFile(config, item.path, blob, item.mimeType);
        uploadedFiles += 1;
        uploadedBytes += blob.size;
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: `上传媒体 ${formatBytes(blob.size)}`, current: uploadedFiles, total: tasks.length, status: "active" });
    });

    return { files, uploadedFiles, uploadedBytes };
}

async function hydrateAsset(asset: Asset): Promise<Asset> {
    if (asset.kind === "image" && asset.data.storageKey) {
        const dataUrl = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl);
        return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? dataUrl : asset.coverUrl, data: { ...asset.data, dataUrl } };
    }
    if (asset.kind === "video" && asset.data.storageKey) {
        const url = await resolveMediaUrl(asset.data.storageKey, asset.data.url);
        return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? url : asset.coverUrl, data: { ...asset.data, url } };
    }
    return asset;
}

async function readStoredLogs(store: LogStore) {
    const logs: StoredLog[] = [];
    await store.iterate<StoredLog, void>((value: StoredLog) => {
        if (value && typeof value === "object") logs.push(value);
    });
    return logs;
}

async function replaceStoredLogs(store: LogStore, logs: StoredLog[]) {
    await store.clear();
    await runWithConcurrency(logs, FILE_CONCURRENCY, async (log) => {
        const id = getStringField(log, "id");
        if (id) await store.setItem(id, log);
    });
}

async function cleanupUnusedLocalMedia() {
    await Promise.all([waitForHydration(useCanvasStore), waitForHydration(useAssetStore)]);
    const trash = await listAllLocalAppSyncTrash();
    const imageLogs = await readStoredLogs(imageLogStore);
    const videoLogs = await readStoredLogs(videoLogStore);
    const usedData = { projects: useCanvasStore.getState().projects, assets: useAssetStore.getState().assets, imageLogs, videoLogs, trash };
    await cleanupUnusedImages(usedData);
    await cleanupUnusedMedia(usedData);
}

function canvasOptions(): SyncDomainOptions<CanvasDomainData, CanvasProject> {
    return {
        key: "canvas",
        label: "画布",
        emptyData: { projects: [] },
        localData: async () => ({ projects: useCanvasStore.getState().projects }),
        getItems: (data) => data.projects,
        makeData: (projects) => ({ projects }),
        timeKey: "updatedAt",
        touchItem: (item, now) => ({ ...item, updatedAt: now }),
        applyData: async (data) => useCanvasStore.getState().replaceProjects(data.projects),
    };
}

function assetOptions(): SyncDomainOptions<AssetDomainData, Asset> {
    return {
        key: "assets",
        label: "我的资产",
        emptyData: { assets: [] },
        localData: async () => ({ assets: useAssetStore.getState().assets }),
        getItems: (data) => data.assets,
        makeData: (assets) => ({ assets }),
        timeKey: "updatedAt",
        touchItem: (item, now) => ({ ...item, updatedAt: now } as Asset),
        applyData: async (data) => useAssetStore.getState().replaceAssets(await Promise.all(data.assets.map(hydrateAsset))),
    };
}

function imageLogOptions(): SyncDomainOptions<LogDomainData, StoredLog> {
    return logOptions("image-workbench", "生图工作台", imageLogStore);
}

function videoLogOptions(): SyncDomainOptions<LogDomainData, StoredLog> {
    return logOptions("video-workbench", "视频创作台", videoLogStore);
}

function logOptions(key: Extract<DomainKey, "image-workbench" | "video-workbench">, label: string, store: LogStore): SyncDomainOptions<LogDomainData, StoredLog> {
    return {
        key,
        label,
        emptyData: { logs: [] },
        localData: async () => ({ logs: await readStoredLogs(store) }),
        getItems: (data) => data.logs,
        makeData: (logs) => ({ logs }),
        timeKey: "createdAt",
        touchItem: (item) => ({ ...item, createdAt: Date.now() }),
        applyData: async (data) => replaceStoredLogs(store, data.logs),
    };
}

function collectStorageKeys(value: unknown, keys = new Set<string>()) {
    if (typeof value === "string") {
        if (storageKeyPattern.test(value)) keys.add(value);
        return [...keys];
    }
    if (!value || typeof value !== "object") return [...keys];
    if ("storageKey" in value && typeof value.storageKey === "string" && storageKeyPattern.test(value.storageKey)) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectStorageKeys(child, keys)) : collectStorageKeys(item, keys)));
    return [...keys];
}

function domainPath(domain: DomainKey, path: string) {
    return `${domain}/${path}`;
}

function domainLabel(domain: DomainKey) {
    if (domain === "canvas") return "画布";
    if (domain === "assets") return "我的资产";
    if (domain === "image-workbench") return "生图工作台";
    return "视频创作台";
}

function emitProgress(onProgress: AppSyncProgress | undefined, event: AppSyncProgressEvent) {
    onProgress?.(event);
}

function notifyWorkbenchLogsChanged(domain: DomainKey) {
    if (domain !== "image-workbench" && domain !== "video-workbench") return;
    window.dispatchEvent(new CustomEvent(workbenchLogsChangedEvent, { detail: domain }));
}

function getStringField(item: Record<string, unknown>, key: string) {
    const value = item[key];
    return typeof value === "string" ? value : "";
}

function getTime(item: DomainItem, key: TimeKey) {
    const value = (item as DomainClockFields)[key];
    if (typeof value === "number") return value;
    if (typeof value === "string") return Date.parse(value) || 0;
    return 0;
}

function itemId(item: DomainItem) {
    return typeof item.id === "string" ? item.id : "";
}

function withEntryId<TItem extends DomainItem>(entry: AppSyncTrashEntry<TItem>): TItem {
    return { ...entry.item, id: entry.id };
}

async function writeDomainBaseline<TData, TItem extends DomainItem>(config: WebdavSyncConfig, options: SyncDomainOptions<TData, TItem>, data: TData, trash: AppSyncTrashEntry<TItem>[]) {
    await writeAppSyncBaseline(appSyncTargetKey(config), options.key, {
        liveIds: options.getItems(data).map(itemId).filter(Boolean),
        trashIds: trash.map((entry) => entry.id),
        updatedAt: new Date().toISOString(),
    });
}

function trashTitle(domain: DomainKey, item: DomainItem) {
    const record = item as Record<string, unknown>;
    const title = getStringField(record, "title").trim() || getStringField(record, "name").trim();
    if (title) return title;
    const prompt = getStringField(record, "prompt").trim();
    if (prompt) return prompt.length > 32 ? `${prompt.slice(0, 32)}...` : prompt;
    if (domain === "canvas") return "未命名画布";
    if (domain === "assets") return "未命名素材";
    if (domain === "image-workbench") return "未命名生图记录";
    return "未命名视频记录";
}

function appSyncTargetKey(config: WebdavSyncConfig): string {
    const targetKey = getAppSyncTargetFingerprint(config);
    if (!targetKey) throw new Error(i18n.t("config.webdav.errors.urlRequired"));
    return targetKey;
}

async function waitForDomainHydration(domain: DomainKey) {
    if (domain === "canvas") await waitForHydration(useCanvasStore);
    if (domain === "assets") await waitForHydration(useAssetStore);
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, storageKey: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    return storageKey.startsWith("image:") ? "png" : "bin";
}

function waitForHydration<T extends { hydrated: boolean }>(store: { getState: () => T; subscribe: (listener: (state: T) => void) => () => void }) {
    if (store.getState().hydrated) return Promise.resolve();
    return new Promise<void>((resolve) => {
        const unsubscribe = store.subscribe((state) => {
            if (!state.hydrated) return;
            unsubscribe();
            resolve();
        });
    });
}

async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (nextIndex < items.length) {
                const index = nextIndex++;
                results[index] = await worker(items[index], index);
            }
        }),
    );
    return results;
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
