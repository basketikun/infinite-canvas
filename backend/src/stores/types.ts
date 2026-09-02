import path from "node:path";
import type {
    Asset, type AssetFolder, type CanvasProject,
    type GenerationLog, type GenerationLogStatus, type MediaFile,
    type RuntimeTask, type RuntimeTaskEvent, type RuntimeTaskStatus,
} from "../db.js";

/** 各 store 的筛选条件。 */
export type AssetFilter = { kind?: string; folderId?: string };
export type LogFilter = { projectId?: string; nodeId?: string; status?: GenerationLogStatus; limit?: number };
export type LogDeleteScope = { id?: string; projectId?: string; nodeId?: string };
export type TaskPatch = { status?: RuntimeTaskStatus; progress?: number; result?: Record<string, unknown> | null; error?: string | null };
export type GenerationLogInput = Omit<GenerationLog, "id" | "createdAt" | "updatedAt">;
export type MediaStats = { width?: number | null; height?: number | null; durationMs?: number | null };

/** runtime 媒体（H3 ref 落地等）：按 name 幂等读写。 */
export type RuntimeMedia = {
    name: string;
    path: string;
    size: number;
    bytes?: number;
};

/** 画布项目 store：权威来源为总后台 SQLite。 */
export type CanvasProjectStore = {
    list(): CanvasProject[];
    get(id: string): CanvasProject | null;
    upsert(project: CanvasProject): CanvasProject;
    replaceAll(projects: CanvasProject[]): CanvasProject[];
    delete(id: string): number;
};

/** 资产 store：assets + asset_folders 统一入口。 */
export type AssetStore = {
    list(filter?: AssetFilter): Asset[];
    get(id: string): Asset | null;
    upsert(asset: Asset): Asset;
    replaceAll(assets: Asset[], folders: AssetFolder[]): void;
    delete(id: string): number;
    folders(): AssetFolder[];
    upsertFolder(folder: AssetFolder): AssetFolder;
    deleteFolder(id: string): number;
};

/** 媒体 store：media_files 表 + runtime-media/ 文件系统。 */
export type MediaStore = {
    store(data: Buffer, options: { name?: string; mimeType?: string } & MediaStats): MediaFile;
    /** 按 name 落地 runtime 媒体（幂等），对应旧 Agent 的 storeRuntimeMedia。 */
    storeNamed(name: string, data: Buffer, mimeType?: string): RuntimeMedia;
    meta(storageKey: string): MediaFile | null;
    list(): MediaFile[];
    read(storageKey: string): Promise<Buffer>;
    /** 代理 URL（相对总后台根路径）。 */
    url(m: MediaFile): string;
    delete(storageKey: string): number;
};

/** 任务 store：tasks + task_events。 */
export type TaskStore = {
    create(kind: string, input: Record<string, unknown>, params: Record<string, unknown>): RuntimeTask;
    get(id: string): RuntimeTask | null;
    update(id: string, patch: TaskPatch): RuntimeTask;
    cancel(id: string): RuntimeTask;
    events(id: string, after?: number): RuntimeTaskEvent[];
};

/** 生成日志 store。 */
export type GenerationLogStore = {
    create(input: GenerationLogInput): GenerationLog;
    get(id: string): GenerationLog | null;
    update(id: string, patch: Partial<GenerationLogInput>): GenerationLog;
    list(filter?: LogFilter): GenerationLog[];
    delete(scope: LogDeleteScope): number;
};

/** 运行时设置 store（runtime_settings 表）。 */
export type SettingStore = {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
};

/** 总后台 store 集合：server 路由和业务模块的统一依赖。 */
export type Stores = {
    projects: CanvasProjectStore;
    assets: AssetStore;
    media: MediaStore;
    tasks: TaskStore;
    logs: GenerationLogStore;
    settings: SettingStore;
};

/** 媒体存储 key 前缀推导（image/video/audio/file:uuid）。 */
export function mediaKindForMime(mime: string, fileName = ""): "image" | "video" | "audio" | "file" {
    const name = fileName.toLowerCase();
    if (mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/.test(name)) return "image";
    if (mime.startsWith("video/") || /\.(mp4|webm|mov|m4v|mkv)$/.test(name)) return "video";
    if (mime.startsWith("audio/") || /\.(mp3|wav|ogg|opus|flac|aac|m4a)$/.test(name)) return "audio";
    return "file";
}

export function extensionForMime(mime: string, fileName = ""): string {
    const fromName = path.extname(path.basename(fileName)).replace(/[^a-z0-9.]/gi, "").slice(0, 12);
    if (fromName.startsWith(".")) return fromName;
    const table: Array<[RegExp, string]> = [
        [/png/i, ".png"], [/jpe?g/i, ".jpg"], [/webp/i, ".webp"], [/gif/i, ".gif"], [/avif/i, ".avif"],
        [/mp4/i, ".mp4"], [/(webm|mov|m4v|mkv)/i, ".mp4"], [/pdf/i, ".pdf"],
        [/mp3/i, ".mp3"], [/(wav|ogg|opus|flac|aac|m4a)/i, ".mp3"],
    ];
    for (const [pat, ext] of table) if (pat.test(mime)) return ext;
    return ".bin";
}
