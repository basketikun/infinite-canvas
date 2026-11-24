import { ModelExecutionError, videoChannelFingerprintSchema, type ModelTask } from "@infinite-canvas/shared/model-http";
import { models } from "./api/models/runtime";
import { storage } from "./storage/runtime";
import { notifyCreateSessionsChanged } from "@workbench/lib/create-sessions-events";

// 仅用于区分本页仍在提交的请求与已中断的浏览器请求，查询编号始终使用保存的记录。
export const submittingRecords = new Set<string>();

const recordWrites = new Map<string, Promise<unknown>>();

/** 同一条记录的更新按顺序读取、修改、写回；记录已被删除或不属于这次生成时返回 false。 */
export function updateGenerationRecord<T extends { generationId: string }>(kind: "image" | "video" | "audio", id: string, generationId: string, update: (row: T) => T) {
    const key = `${kind}:${id}`;
    const write = (recordWrites.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
        const store = recordStore(kind);
        const row = await store.getItem<T>(id);
        if (!row || row.generationId !== generationId) return false;
        await store.setItem(id, update(row));
        return true;
    });
    recordWrites.set(key, write);
    return write.finally(() => { if (recordWrites.get(key) === write) recordWrites.delete(key); });
}

export class GenerationRecordDeletion {
    readonly ids: readonly string[];
    private readonly remaining: Set<string>;
    busy = false;

    constructor(private readonly kind: "image" | "video" | "audio", ids: readonly string[]) {
        this.ids = [...ids];
        this.remaining = new Set(ids);
    }

    async remove(signal: AbortSignal) {
        signal.throwIfAborted();
        const store = recordStore(this.kind);
        const results = await Promise.allSettled(Array.from(this.remaining, async (id) => {
            await store.removeItem(id);
            this.remaining.delete(id);
        }));
        notifyCreateSessionsChanged();
        signal.throwIfAborted();
        const failed = results.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
    }
}

type RecordStatus = {
    id: string;
    createdAt: number;
    durationMs: number;
    status: "pending" | "success" | "failed" | "interrupted";
    taskId?: string;
    task?: { id: string; channelFingerprint?: string };
    tasks?: Array<{ taskId: string }>;
    successCount?: number;
    failCount?: number;
};

export type GenerationStatus = "idle" | "queued" | "running" | "succeeded" | "failed" | "paused" | "interrupted" | "cancelled";

export function hasUnverifiedVideoTask(record: RecordStatus) {
    return record.status === "pending" && !record.taskId && !!record.task && !videoChannelFingerprintSchema.safeParse(record.task.channelFingerprint).success;
}

function recordStore(kind: "image" | "video" | "audio") {
    return kind === "image" ? storage.imageRecords : kind === "video" ? storage.videoRecords : storage.audioRecords;
}

export async function readGenerationRecords<T extends RecordStatus>(kind: "image" | "video" | "audio", signal?: AbortSignal): Promise<T[]> {
    signal?.throwIfAborted();
    const collection = recordStore(kind);
    const records: T[] = [];
    try {
        await collection.iterate<T, void>((record) => {
            records.push(record.status === "pending" && (kind === "audio" || !record.tasks?.length && !record.taskId && !record.task) && !submittingRecords.has(record.id) ? { ...record, status: "interrupted" } : record);
        });
    } finally { signal?.throwIfAborted(); }
    return records.sort((a, b) => b.createdAt - a.createdAt);
}

export async function readWorkbenchStatus(kind: "image" | "video" | "audio", recordId?: string, signal?: AbortSignal) {
    const collection = recordStore(kind);
    const records: RecordStatus[] = [];
    if (recordId) {
        const record = await collection.getItem<RecordStatus>(recordId);
        if (record) records.push(record);
    } else {
        await collection.iterate<RecordStatus, void>((record) => { records.push(record); });
    }

    return Promise.all(records.map(async (record) => {
        const taskIds = record.tasks?.map((slot) => slot.taskId) ?? (record.taskId ? [record.taskId] : []);
        let status: GenerationStatus = record.status === "success" ? "succeeded" : record.status === "failed" ? "failed" : record.status === "interrupted" ? "interrupted" : "running";
        let successCount = record.successCount ?? Number(status === "succeeded");
        let failCount = record.failCount ?? Number(status === "failed");
        let updatedAt = record.createdAt + record.durationMs;
        if (record.status !== "success" && models.tasks && taskIds.length) {
            const local = models.tasks;
            const states = await Promise.all(taskIds.map(async (id): Promise<ModelTask["status"] | "queued"> => {
                try {
                    const snapshot = await local.read(id, signal);
                    updatedAt = Math.max(updatedAt, snapshot.updatedAt);
                    return snapshot.status;
                } catch (error) {
                    if (!(error instanceof ModelExecutionError) || error.code !== "MODEL_TASK_MISSING") throw error;
                    if (record.status === "failed") return "failed";
                    return submittingRecords.has(record.id) ? "queued" : "interrupted";
                }
            }));
            successCount = states.filter((state) => state === "completed").length;
            failCount = states.filter((state) => state === "failed" || state === "cancelled" || state === "interrupted").length;
            if (states.includes("running")) status = "running";
            else if (states.includes("queued")) status = "queued";
            else if (states.includes("paused")) status = "paused";
            else if (successCount) status = "succeeded";
            else if (states.includes("interrupted")) status = "interrupted";
            else if (states.every((state) => state === "cancelled")) status = "cancelled";
            else status = "failed";
        } else if ((kind === "video" && hasUnverifiedVideoTask(record)) || (record.status === "pending" && !record.task && !submittingRecords.has(record.id))) {
            status = "interrupted";
        }
        return { id: record.id, source: kind, kind, status, taskIds, successCount, failCount, updatedAt: new Date(updatedAt).toISOString(),
            error: status === "failed" ? "生成未完成，请检查生成设置后重试。" : undefined };
    }));
}
