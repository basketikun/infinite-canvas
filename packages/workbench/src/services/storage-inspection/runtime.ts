import type { StorageEntry, StorageUsage } from "@infinite-canvas/shared/storage-inspection";
import type { StorageReference } from "@infinite-canvas/shared/resource-references";
import type { ArchiveResource } from "@infinite-canvas/shared/work-archive";

export interface StorageInspectionAdapter {
    /**
     * 读取当前存储的分类占用与空间信息。
     */
    usage(): Promise<StorageUsage>;
    /**
     * 列举分类内容，不读取文件正文。
     */
    entries(category: string): Promise<StorageEntry[]>;
    /** 只读取已保存的业务声明，不能作为删除原文件的依据。 */
    references(resource: ArchiveResource, signal?: AbortSignal): Promise<StorageReference[]>;
    /**
     * 按需读取记录或文件；文件统一返回 Blob。
     */
    read(category: string, key: string): Promise<unknown>;
    /**
     * 只读取已有图片预览，缺失时返回 null，不加载原图。
     */
    preview(key: string): Promise<Blob | null>;
    /**
     * 删除没有被任何记录引用的图片、音视频和插件文件，返回清理的文件数与释放的字节数。
     */
    cleanup(): Promise<{ files: number; bytes: number }>;
    /**
     * 在系统文件管理器中打开本地存储目录，仅本地模式提供。
     */
    openFolder?(): Promise<void>;
}

export let storageInspection: StorageInspectionAdapter;

export function initializeStorageInspection(adapter: StorageInspectionAdapter) {
    if (storageInspection) throw new Error("STORAGE_INSPECTION_ALREADY_INITIALIZED");
    storageInspection = adapter;
}
