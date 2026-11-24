import stringify from "fast-json-stable-stringify";
import { z } from "zod";
import { archiveThreadSchema, type ArchiveThread } from "./chat.js";
import { canvasDocumentSchema, pluginStandaloneWorkSchema, type CanvasDocument, type PluginStandaloneWork } from "./canvas/schema/canvas.js";
import { mapCanvasResources } from "./canvas/ops/archive-resources.js";

export const storageWriteSchema = z.object({ value: z.unknown(), clientId: z.string() });
export type StorageWrite = z.infer<typeof storageWriteSchema>;
/** 同步重放按删除时刻合并。普通首次删除无条件执行，重试只针对原来保存的版本。 */
export type ProjectDeletion = { deletedAt: string; expectedDocument?: never } | { deletedAt?: never; expectedDocument?: CanvasDocument | null };
export const projectDeletionSchema = z.union([
    z.object({ deletedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))) }).strict(),
    z.object({ expectedDocument: z.custom<CanvasDocument>((value) => canvasDocumentSchema.safeParse(value).success).nullable().optional() }).strict(),
]);

/**
 * 媒体由 storageKey 定位；临时预览地址不属于持久化数据。
 */
export function serializeStorageData<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, function (key, item) {
        if (["url", "dataUrl", "content", "coverUrl"].includes(key) && typeof item === "string" && (item.startsWith("blob:") || (this.storageKey && item.startsWith("data:")))) return "";
        return item;
    }));
}

/** 只规范化宿主字段；插件值中的同名字符串属于它自身的数据契约。 */
export function serializeCanvasDocument<T extends CanvasDocument>(document: T): T {
    return JSON.parse(JSON.stringify(mapCanvasResources(document, (resource) => resource.key, false)));
}

export function serializeStandaloneWork(key: string, value: unknown): PluginStandaloneWork {
    const work = pluginStandaloneWorkSchema.safeParse(value);
    if (!work.success || work.data.workId !== key) throw new StorageError("STORAGE_INVALID");
    return structuredClone(work.data);
}

const recordTimeSchema = z.string().datetime({ offset: true }).refine((value) => Number.isFinite(Date.parse(value)));
const chatThread = z.custom<ArchiveThread>((value) => archiveThreadSchema.safeParse(value).success);
export const chatSyncRecordSchema = z.object({
    id: z.string().min(1), projectId: z.string().min(1), updatedAt: recordTimeSchema, thread: chatThread.nullable(),
}).strict().refine(({ id, projectId, updatedAt, thread }) => thread === null || (id === thread.id && projectId === thread.projectId && Date.parse(updatedAt) === Date.parse(thread.updatedAt)));
export type ChatSyncRecord = z.infer<typeof chatSyncRecordSchema>;

export function storedChatSyncRecord(record: StorageRecord): ChatSyncRecord {
    const live = record.value as ArchiveThread | null;
    if (live === null && record.projectId === undefined && record.key && recordTimeSchema.safeParse(record.deletedAt).success) throw new StorageError("STORAGE_CHAT_PROJECT_MISSING");
    const parsed = chatSyncRecordSchema.safeParse({ id: record.key, projectId: live ? live.projectId : record.projectId, updatedAt: live ? live.updatedAt : record.deletedAt, thread: live });
    if (!parsed.success) throw new StorageError("STORAGE_INVALID");
    return parsed.data;
}

export function chatSyncBaseline({ id, projectId, updatedAt, thread }: ChatSyncRecord): string {
    const time = Date.parse(updatedAt);
    return stringify([id, projectId, time, thread && { ...thread, updatedAt: time }]);
}

export function sameChatSyncRecord(a: ChatSyncRecord, b: ChatSyncRecord): boolean {
    return a === b || (a.id === b.id && a.projectId === b.projectId && Date.parse(a.updatedAt) === Date.parse(b.updatedAt) && chatSyncBaseline(a) === chatSyncBaseline(b));
}

export function canCompareChatSync(current: ChatSyncRecord | null, expected: ChatSyncRecord | null, next: ChatSyncRecord): boolean {
    if (expected && expected.id !== next.id) throw new StorageError("STORAGE_INVALID");
    if (!current || !expected) return current === expected;
    if (current.projectId !== next.projectId || !sameChatSyncRecord(current, expected)) return false;
    const delta = Date.parse(next.updatedAt) - Date.parse(current.updatedAt);
    return delta > 0 || (delta === 0 && (next.thread === null || sameChatSyncRecord(current, next)));
}

/** 用户删除以第一次接受的时刻重试；同刻远端墓碑的优先级只用于同步合并。 */
export function ordinaryChatWrite(current: ChatSyncRecord | null, next: ChatSyncRecord | null): ChatSyncRecord | null {
    if (!current) return next;
    if (!next) return current.thread ? { ...current, updatedAt: nextRecordUpdatedAt(current.updatedAt), thread: null } : current;
    if (current.id !== next.id || current.projectId !== next.projectId) throw new StorageError("STORAGE_INVALID");
    const delta = Date.parse(next.updatedAt) - Date.parse(current.updatedAt);
    if (!next.thread) {
        if (delta < 0 || (current.thread && delta === 0)) throw new StorageError("STORAGE_INVALID");
        return next;
    }
    if (!current.thread) throw new StorageError("STORAGE_CHAT_DELETED");
    if (delta > 0) return next;
    if (sameChatSyncRecord(current, { ...next, updatedAt: current.updatedAt, thread: { ...next.thread, updatedAt: current.updatedAt } })) return current;
    const updatedAt = nextRecordUpdatedAt(current.updatedAt);
    return { ...next, updatedAt, thread: { ...next.thread, updatedAt } };
}

export const workSyncRecordSchema = z.object({ id: z.string().min(1), updatedAt: recordTimeSchema, work: pluginStandaloneWorkSchema }).strict().refine(({ id, work }) => id === work.workId);
export type WorkSyncRecord = z.infer<typeof workSyncRecordSchema>;
export const workSyncChangeSchema = z.object({ expected: workSyncRecordSchema.nullable(), next: workSyncRecordSchema }).strict();

export function nextRecordUpdatedAt(previous?: string): string {
    if (previous === undefined) return new Date().toISOString();
    if (!recordTimeSchema.safeParse(previous).success) throw new StorageError("STORAGE_INVALID");
    const next = new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
    if (!recordTimeSchema.safeParse(next).success) throw new StorageError("STORAGE_INVALID");
    return next;
}

/** 仅本地持久作品可报告缺少保存时间。远端清单须通过完整的 workSyncRecordSchema。 */
export function storedWorkSyncRecord(id: string, work: unknown, updatedAt?: string): WorkSyncRecord {
    const value = serializeStandaloneWork(id, work);
    if (updatedAt === undefined) throw new StorageError("STORAGE_WORK_TIME_MISSING");
    if (!recordTimeSchema.safeParse(updatedAt).success) throw new StorageError("STORAGE_INVALID");
    return { id, work: value, updatedAt };
}

export function workSyncBaseline(record: WorkSyncRecord): string {
    return stringify([record.id, Date.parse(record.updatedAt), record.work]);
}

export function sameWorkSyncRecord(a: WorkSyncRecord, b: WorkSyncRecord): boolean {
    return a === b || (a.id === b.id && Date.parse(a.updatedAt) === Date.parse(b.updatedAt) && workSyncBaseline(a) === workSyncBaseline(b));
}

export function sameWorkOwner(a: PluginStandaloneWork, b: PluginStandaloneWork): boolean {
    return a.owner === b.owner && a.packageName === b.packageName;
}

export function canCompareWorkSync(current: WorkSyncRecord | null, expected: WorkSyncRecord | null, next: WorkSyncRecord): boolean {
    if (expected && expected.id !== next.id) throw new StorageError("STORAGE_INVALID");
    if (!current || !expected) return current === expected;
    if (!sameWorkOwner(current.work, next.work) || !sameWorkSyncRecord(current, expected)) return false;
    return Date.parse(next.updatedAt) > Date.parse(current.updatedAt) || sameWorkSyncRecord(current, next);
}

export type StorageRecord<T = unknown> = { key: string; updatedAt?: string; deletedAt?: string; projectId?: string; value: T | null };
export type StorageChange = { collection: string; key: string; clientId: string };

export class StorageError extends Error {
    constructor(public code: "STORAGE_UNAVAILABLE" | "STORAGE_FILE_EXISTS" | "STORAGE_INVALID" | "STORAGE_WORK_TIME_MISSING" | "STORAGE_CHAT_PROJECT_MISSING" | "STORAGE_CHAT_DELETED" | "WORKSPACE_LOCKED") {
        super({
            STORAGE_UNAVAILABLE: "暂时无法保存或读取，请确认本地程序仍在运行、目录可写，然后重试。",
            STORAGE_FILE_EXISTS: "此位置已有文件，请核对现有内容。",
            STORAGE_INVALID: "内容格式无法读取，请检查所选目录或导入文件。",
            STORAGE_WORK_TIME_MISSING: "有独立作品缺少保存时间，请打开该作品，编辑并保存后再同步。",
            STORAGE_CHAT_PROJECT_MISSING: "有旧会话删除记录无法确认所属画布。请保留原工作区，将需要的画布导出并导入新工作区后再同步。",
            STORAGE_CHAT_DELETED: "这段对话已删除，请新建对话后继续。",
            WORKSPACE_LOCKED: "这个目录已被占用，请先退出使用它的本地程序。",
        }[code]);
    }
}
