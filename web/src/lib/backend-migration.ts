/**
 * IndexedDB 自动迁移：将旧 localforage 数据（画布项目、素材、媒体、日志）迁移到总后台。
 *
 * 迁移流程：
 * 1. 读取 IndexedDB 中的画布项目、素材和文件夹
 * 2. 上传媒体 Blob 到总后台，建立旧 → 新 storage key 映射
 * 3. 批量写入总后台
 * 4. 校验数量
 * 5. 写入迁移完成标记 + 清理旧 IndexedDB 业务数据
 *
 * 迁移失败时：保留原 IndexedDB，不写完成标记，清理孤立媒体。
 */

import localforage from "localforage";
import {
    saveBackendProjects,
    fetchBackendProjects,
    saveBackendAssets,
    fetchBackendAssets,
    uploadBackendMediaDataUrl,
    createBackendGenerationLog,
    deleteBackendMedia,
} from "@/services/backend-api";
import type { Asset, AssetFolder } from "@/stores/use-asset-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

const MIGRATION_MARKER_KEY = "infinite-canvas:backend_migration_done_v2";

// ── 去重依据 ──────────────────────────────────────────────────────────────
const MIGRATION_DEDUP = {
    existingProjectIds: new Set<string>(),
    existingAssetIds: new Set<string>(),
    existingLogIds: new Set<string>(),
    /** 旧 storage key → 新 storage key */
    mediaKeyMap: new Map<string, string>(),
};

let migrationRunning = false;

export type MigrationResult = {
    success: boolean;
    projectsMigrated: number;
    assetsMigrated: number;
    mediaUploaded: number;
    logsMigrated: number;
    error?: string;
};

/** 检查是否已完成迁移。 */
export function isMigrationDone(): boolean {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(MIGRATION_MARKER_KEY) === "true";
}

/** 从总后台拉取已有数据，构建去重集合。 */
async function buildDedupSets() {
    try {
        const existingProjects = await fetchBackendProjects();
        (existingProjects.projects || []).forEach((p) => { if (p.id) MIGRATION_DEDUP.existingProjectIds.add(String(p.id)); });
    } catch { /* first run */ }
    try {
        const existingAssets = await fetchBackendAssets();
        (existingAssets.assets || []).forEach((a) => {
            const record = a as Record<string, unknown>;
            if (record.id) MIGRATION_DEDUP.existingAssetIds.add(String(record.id));
        });
    } catch { /* first run */ }
}

/** 执行一次性 IndexedDB → 总后台迁移。 */
export async function migrateIndexDBToBackend(): Promise<MigrationResult> {
    if (migrationRunning) return { success: true, projectsMigrated: 0, assetsMigrated: 0, mediaUploaded: 0, logsMigrated: 0, error: "migration already in progress" };
    if (isMigrationDone()) return { success: true, projectsMigrated: 0, assetsMigrated: 0, mediaUploaded: 0, logsMigrated: 0 };
    migrationRunning = true;
    const uploadedMedia: string[] = [];

    try {
        await buildDedupSets();

        // 1. 从 IndexedDB 读取画布项目
        const canvasStore = await getLocalForageItem("app_state", ASSET_STORE_KEY_CANVAS);
        let projectsMigrated = 0;
        const canvasProjects = (canvasStore as Record<string, unknown> | null)?.projects;
        const projects = Array.isArray(canvasProjects)
            ? (canvasProjects as CanvasProject[]).filter((p) => p.id)
            : [];

        // 2. 从 IndexedDB 读取素材
        const assetStore = await getLocalForageItem("app_state", ASSET_STORE_KEY_ASSETS);
        let assetsMigrated = 0;
        let mediaUploaded = 0;
        const rawAssets = (assetStore as Record<string, unknown> | null)?.assets;
        const rawFolders = (assetStore as Record<string, unknown> | null)?.folders;
        if (Array.isArray(rawAssets)) {
            const assets = (rawAssets as Asset[]).filter((a) => a.id);
            const folders = Array.isArray(rawFolders) ? (rawFolders as AssetFolder[]) : [];

            if (assets.length || folders.length) {
                // 上传媒体
                for (const asset of assets) {
                    mediaUploaded += await migrateAssetMedia(asset, uploadedMedia);
                }
                await saveBackendAssets(assets.map((asset) => rewriteStorageKeys(asset)) as unknown[], folders as unknown[]);
                assets.forEach((a) => MIGRATION_DEDUP.existingAssetIds.add(a.id));
                assetsMigrated = assets.length;
            }
        }

        await migrateReferencedMedia([...projects, ...(Array.isArray(rawAssets) ? rawAssets : [])], uploadedMedia);

        if (projects.length) {
            await saveBackendProjects(projects.map((project) => rewriteStorageKeys(project)) as unknown as Record<string, unknown>[]);
            projects.forEach((project) => MIGRATION_DEDUP.existingProjectIds.add(project.id));
            projectsMigrated = projects.length;
        }

        // 3. 迁移生成日志（如果有）
        const logStores = [
            await getLocalForageItem("image_generation_logs", "infinite-canvas:image_generation_logs"),
            await getLocalForageItem("video_generation_logs", "infinite-canvas:video_generation_logs"),
        ];
        let logsMigrated = 0;
        for (const logStore of logStores) if (Array.isArray(logStore)) {
            const logs = logStore as Record<string, unknown>[];
            for (const log of logs.slice(0, 500)) {
                const id = String(log.id || "");
                if (!id || MIGRATION_DEDUP.existingLogIds.has(id)) continue;
                try {
                    await createBackendGenerationLog({
                        projectId: String(log.projectId || ""),
                        nodeId: log.nodeId ? String(log.nodeId) : undefined,
                        status: String(log.status || "success"),
                        platform: String(log.platform || "Generate"),
                        prompt: String(log.prompt || ""),
                        references: Array.isArray(log.refs) ? log.refs as Record<string, unknown>[] : [],
                        inputCounts: {},
                        startedAt: new Date(Number(log.createdAt) || Date.now()).toISOString(),
                        durationMs: Number(log.runMs || 0),
                        outputs: Array.isArray(log.outputs) ? log.outputs as Record<string, unknown>[] : [],
                        error: log.error ? String(log.error) : undefined,
                        params: { legacyLogId: id },
                    });
                    MIGRATION_DEDUP.existingLogIds.add(id);
                    logsMigrated++;
                } catch { /* best effort */ }
            }
        }

        // 4. 校验
        const verify = await fetchBackendProjects();
        if ((verify.projects || []).length < projectsMigrated) {
            throw new Error(`迁移校验失败：期望 ${projectsMigrated} 个项目，实际 ${(verify.projects || []).length}`);
        }

        // 5. 写完成标记
        localStorage.setItem(MIGRATION_MARKER_KEY, "true");

        // 6. 清理旧 IndexedDB 业务数据
        await clearLocalForageBusinessData();

        return { success: true, projectsMigrated, assetsMigrated, mediaUploaded, logsMigrated };
    } catch (error) {
        // 清理孤立媒体
        for (const key of uploadedMedia) {
            try { await deleteBackendMedia(key); } catch { /* ignore */ }
        }
        return {
            success: false,
            projectsMigrated: 0,
            assetsMigrated: 0,
            mediaUploaded: 0,
            logsMigrated: 0,
            error: error instanceof Error ? error.message : String(error),
        };
    } finally {
        migrationRunning = false;
    }
}

/** 迁移单个素材的媒体数据，返回上传的媒体数。 */
async function migrateAssetMedia(asset: Asset, uploadedMedia: string[]): Promise<number> {
    let count = 0;

    // Image asset
    if (asset.kind === "image") {
        const storageKey = (asset.data as Record<string, unknown>).storageKey as string | undefined;
        if (storageKey && !MIGRATION_DEDUP.mediaKeyMap.has(storageKey)) {
            const blob = await getImageBlob(storageKey);
            if (blob) {
                const dataUrl = await blobToDataUrl(blob);
                const result = await uploadBackendMediaDataUrl({
                    name: `${asset.id}.png`,
                    dataUrl,
                    mimeType: blob.type || "image/png",
                });
                MIGRATION_DEDUP.mediaKeyMap.set(storageKey, result.storageKey);
                uploadedMedia.push(result.storageKey);
                count++;
            }
        }
    }

    // Video/Audio asset
    if (asset.kind === "video" || asset.kind === "audio") {
        const storageKey = (asset.data as Record<string, unknown>).storageKey as string | undefined;
        if (storageKey && !MIGRATION_DEDUP.mediaKeyMap.has(storageKey)) {
            const blob = await getMediaBlob(storageKey);
            if (blob) {
                const dataUrl = await blobToDataUrl(blob);
                const result = await uploadBackendMediaDataUrl({
                    name: `${asset.id}${asset.kind === "video" ? ".mp4" : ".mp3"}`,
                    dataUrl,
                    mimeType: blob.type || (asset.kind === "video" ? "video/mp4" : "audio/mpeg"),
                });
                MIGRATION_DEDUP.mediaKeyMap.set(storageKey, result.storageKey);
                uploadedMedia.push(result.storageKey);
                count++;
            }
        }
    }

    // Composite items
    if (asset.kind === "composite") {
        const items = (asset.data as Record<string, unknown>).items;
        if (Array.isArray(items)) {
            for (const item of items as Array<Record<string, unknown>>) {
                const storageKey = item.storageKey as string | undefined;
                if (storageKey && !MIGRATION_DEDUP.mediaKeyMap.has(storageKey)) {
                    const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
                    if (blob) {
                        const dataUrl = await blobToDataUrl(blob);
                        const result = await uploadBackendMediaDataUrl({
                            name: `${asset.id}-${storageKey.split(":")[0]}.bin`,
                            dataUrl,
                            mimeType: blob.type || "application/octet-stream",
                        });
                        MIGRATION_DEDUP.mediaKeyMap.set(storageKey, result.storageKey);
                        uploadedMedia.push(result.storageKey);
                        count++;
                    }
                }
            }
        }
    }

    return count;
}

async function migrateReferencedMedia(values: unknown[], uploadedMedia: string[]) {
    const keys = new Set<string>();
    const collect = (value: unknown) => {
        if (Array.isArray(value)) return value.forEach(collect);
        if (!value || typeof value !== "object") return;
        Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
            if (key === "storageKey" && typeof item === "string") keys.add(item);
            else collect(item);
        });
    };
    values.forEach(collect);
    for (const storageKey of keys) {
        if (MIGRATION_DEDUP.mediaKeyMap.has(storageKey)) continue;
        const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        if (!blob) continue;
        const dataUrl = await blobToDataUrl(blob);
        const result = await uploadBackendMediaDataUrl({ name: storageKey, dataUrl, mimeType: blob.type || "application/octet-stream" });
        MIGRATION_DEDUP.mediaKeyMap.set(storageKey, result.storageKey);
        uploadedMedia.push(result.storageKey);
    }
}

// ── LocalForage helpers ────────────────────────────────────────────────────

const ASSET_STORE_KEY_CANVAS = "infinite-canvas:canvas_store";
const ASSET_STORE_KEY_ASSETS = "infinite-canvas:asset_store";

async function getLocalForageItem(storeName: string, key: string) {
    const store = localforage.createInstance({ name: "infinite-canvas", storeName });
    const value = await store.getItem<string>(key);
    if (!value) return null;
    try {
        const parsed = JSON.parse(value);
        return parsed?.state || parsed;
    } catch { return null; }
}

function rewriteStorageKeys<T>(value: T): T {
    if (Array.isArray(value)) return value.map((item) => rewriteStorageKeys(item)) as T;
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        key === "storageKey" && typeof item === "string"
            ? MIGRATION_DEDUP.mediaKeyMap.get(item) || item
            : rewriteStorageKeys(item),
    ])) as T;
}

async function clearLocalForageBusinessData() {
    // 保留本地副本，直到远端媒体与所有节点引用都完成校验；清理由后续显式回收流程负责。
}

async function getImageBlob(storageKey: string) {
    const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
    return store.getItem<Blob>(storageKey);
}

async function getMediaBlob(storageKey: string) {
    const store = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
    return store.getItem<Blob>(storageKey);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Failed to read blob"));
        reader.readAsDataURL(blob);
    });
}

/** 重置迁移标记（用于重试）。 */
export function resetMigrationMarker() {
    localStorage.removeItem(MIGRATION_MARKER_KEY);
}
