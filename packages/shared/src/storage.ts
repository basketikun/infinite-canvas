import type { StorageMode } from "./runtime.js";
import type { CanvasDocument, CanvasWebVideoTask, PluginStandaloneWork } from "./canvas/schema/canvas.js";
import type { ChatSyncRecord, ProjectDeletion, StorageRecord, WorkSyncRecord } from "./storage-data.js";
export type { ChatSyncRecord, WorkSyncRecord } from "./storage-data.js";
import type { ArchiveInstall, ArchivePreferences } from "./work-archive.js";
import type { PluginSyncDomainSnapshot } from "./sync-data.js";
import type { PluginTaskTarget, WebPluginVideoReceipt } from "./model-http.js";
import type { VideoTaskIdentity } from "./model-execution.js";
import type { AssetLibraryEdits } from "./sync-records.js";

/**
 * 业务记录集合；实现负责持久化，不依赖具体运行环境。
 * images、media 与插件文件集合保存二进制原件：每份新内容使用新键写入，写入后不再覆盖，
 * 业务删除只移除记录，不删除原件；未被任何记录引用的原件由用户在本地存储中主动清理。
 */
export interface StorageCollection {
    getItem<T>(key: string): Promise<T | null>;
    setItem<T>(key: string, value: T): Promise<T>;
    removeItem(key: string): Promise<void>;
    clear(): Promise<void>;
    iterate<T, R>(iterator: (value: T, key: string, index: number) => R): Promise<R | void>;
    tombstones?(): Promise<{ key: string; deletedAt: string }[]>;
    subscribe?(listener: (key: string | null) => void): () => void;
}

/**
 * 应用启动时选定的业务存储，缓存和设备偏好独立管理。
 */
export interface StorageAdapter {
    readonly kind: StorageMode;
    readonly state: StorageCollection;
    /** 仅 Web 宿主保存原渠道凭据的摘要；普通项目文档与插件均不携带它。 */
    canvasVideoConnection?(task: CanvasWebVideoTask, identity: string, originalFingerprint?: string): Promise<string | null>;
    readonly pluginVideoTasks?: {
        prepare(): Promise<void>;
        read(id: string, target: PluginTaskTarget): Promise<WebPluginVideoReceipt>;
        save(next: WebPluginVideoReceipt, previous?: VideoTaskIdentity, blob?: Blob): Promise<WebPluginVideoReceipt>;
    };
    readonly projects: StorageCollection & {
        deleteProject?(key: string, deletion: ProjectDeletion): Promise<StorageRecord<CanvasDocument>>;
    };
    readonly works: StorageCollection & {
        create(work: PluginStandaloneWork): Promise<boolean>;
        syncRecords(): Promise<WorkSyncRecord[]>;
        compareSync(expected: WorkSyncRecord | null, next: WorkSyncRecord): Promise<boolean>;
    };
    readonly preferences: StorageCollection;
    /** 图片原件；缩略图按同一键保存在 previews。 */
    readonly images: StorageCollection;
    readonly previews: StorageCollection;
    readonly media: StorageCollection;
    readonly imageRecords: StorageCollection;
    readonly videoRecords: StorageCollection;
    readonly audioRecords: StorageCollection;
    readonly agentRecords: StorageCollection;
    readonly chats: StorageCollection & {
        syncRecords(): Promise<ChatSyncRecord[]>;
        compareSync(expected: ChatSyncRecord | null, next: ChatSyncRecord): Promise<boolean>;
        deleteThread(id: string, projectId: string, updatedAt: string): Promise<void>;
    };
    /** 作品包导入：先写入原件，再写入画布、作品与聊天记录。 */
    installArchive(install: ArchiveInstall, preferences?: ArchivePreferences): Promise<void>;
    editAssetLibrary(edits: AssetLibraryEdits): Promise<void>;
    comparePluginSyncData(owner: string, domainId: string, expected: PluginSyncDomainSnapshot | null, next: PluginSyncDomainSnapshot): Promise<boolean>;
    pluginFiles(pluginId: string): StorageCollection;
    pluginData(pluginId: string): StorageCollection;
}
