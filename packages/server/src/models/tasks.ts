import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { ModelExecutionError, type LocalModelRequest, type ModelTaskTarget, type ModelTask, type ModelErrorCode } from "@infinite-canvas/shared/model-http";
import type { ModelCallUpstream } from "@infinite-canvas/shared/model-calls";
import type { FsStorage } from "../storage/fs-storage.js";
import { logger } from "../utils/logger.js";
import { toModelError } from "@infinite-canvas/model-runtime/execute";
import { executeModel, type RemoteVideo } from "./execute.js";

type TaskRecord = { snapshot: ModelTask; fingerprint: string; remote?: RemoteVideo };
type Worker = { controller: AbortController; started: Promise<void>; done: Promise<void> };

/** 页面展示用的错误码与模型服务说明。 */
export function modelErrorInfo(error: unknown): { code: ModelErrorCode; message?: string } {
    const mapped = toModelError(error);
    const { code, detail } = mapped instanceof ModelExecutionError ? mapped : new ModelExecutionError("MODEL_FAILED");
    logger.warn("Model execution failed", { name: error instanceof Error ? error.name : "Error", code });
    return { code, message: detail };
}

export class ModelTasks {
    private workers = new Map<string, Worker>();
    private opening = new Map<string, Promise<ModelTask>>();
    private closing = false;
    private writeFailures = new Set<string>();
    private observers = new Map<string, Set<() => void>>();
    readonly ready: Promise<void>;

    constructor(private storage: FsStorage) {
        this.ready = this.restore();
    }

    private async restore() {
        for (const row of await this.storage.list("task")) {
            const record = row.value as TaskRecord;
            const { status, code } = record.snapshot;
            if (record.remote && !record.remote.channelFingerprint && (status === "running" || status === "paused")) {
                if (status !== "paused" || code !== "MODEL_LOCAL_VIDEO_CONNECTION_UNVERIFIED") await this.storage.save("task", row.key, { ...record, snapshot: { ...record.snapshot, status: "paused", code: "MODEL_LOCAL_VIDEO_CONNECTION_UNVERIFIED", updatedAt: Date.now(), revision: randomUUID() } }, "models");
                continue;
            }
            if (record.snapshot.status !== "running") continue;
            if (record.remote) this.launch(record);
            else await this.storage.save("task", row.key, { ...record, snapshot: { ...record.snapshot, status: "interrupted", code: "MODEL_TASK_INTERRUPTED", updatedAt: Date.now(), revision: randomUUID() } }, "models");
        }
    }

    async submit(taskId: string, request: LocalModelRequest, target?: ModelTaskTarget): Promise<ModelTask> {
        await this.ready;
        if (this.closing) throw new ModelExecutionError("MODEL_UNAVAILABLE");
        if (request.action === "video-query") throw new ModelExecutionError("MODEL_CONFIG_MISSING");
        const fingerprint = createHash("sha256").update(JSON.stringify([request, target])).digest("hex");
        const opening = this.opening.get(taskId);
        if (opening) await opening;
        const action = request.action;
        const create = async () => {
            const existing = await this.storage.read<TaskRecord>("task", taskId);
            if (existing?.value) {
                if (existing.value.fingerprint !== fingerprint) throw new ModelExecutionError("MODEL_TASK_CONFLICT");
                return existing.value.snapshot;
            }
            const createdAt = Date.now();
            const snapshot: ModelTask = { taskId, action, status: "running", model: request.call.model, target, createdAt, updatedAt: createdAt, revision: randomUUID() };
            const record: TaskRecord = { snapshot, fingerprint };
            await this.storage.save("task", taskId, record, "models");
            this.launch(record, request);
            return snapshot;
        };
        const pending = create();
        this.opening.set(taskId, pending);
        try { return await pending; } finally { if (this.opening.get(taskId) === pending) this.opening.delete(taskId); }
    }

    private launch(record: TaskRecord, request?: LocalModelRequest) {
        const { taskId } = record.snapshot;
        const active = this.workers.get(taskId);
        if (active || this.closing) return active?.started;
        const controller = new AbortController();
        const { signal } = controller;
        const save = async (patch: Partial<ModelTask>) => {
            const snapshot = { ...record.snapshot, ...patch, updatedAt: Date.now(), revision: randomUUID() };
            await this.storage.save("task", taskId, { ...record, snapshot }, "models");
            record.snapshot = snapshot;
            for (const wake of this.observers.get(taskId) ?? []) wake();
        };
        const started = request ? Promise.resolve() : save({ status: "running", code: undefined, message: undefined });
        const run = async () => {
            let pendingWrite = Promise.resolve();
            let latestText = record.snapshot.text;
            // 只保存提交阶段的请求；后续查询按固定间隔重复，不写入任务记录。
            const upstream: ModelCallUpstream[] = [];
            const onText = (text: string) => {
                latestText = text;
                pendingWrite = pendingWrite.then(async () => {
                    if (latestText !== record.snapshot.text) await save({ text: latestText });
                });
                void pendingWrite.catch(() => {});
            };
            try {
                await started;
                if (request) {
                    const result = await executeModel(this.storage, request, signal, onText, { taskId, onUpstream: (entry) => upstream.push(entry) });
                    await pendingWrite;
                    if (typeof result === "object" && "upstreamId" in result) {
                        record.remote = result;
                        await save({ upstream });
                    } else {
                        if (typeof result === "object" && "pending" in result) throw new ModelExecutionError("MODEL_RESULT_MISSING");
                        await save({ status: "completed", result, upstream });
                        return;
                    }
                }
                const remote = record.remote!;
                for (let attempt = 0; attempt < 120; attempt++) {
                    signal.throwIfAborted();
                    const result = await executeModel(this.storage, { action: "video-query", call: remote.call }, signal, onText, { taskId, remote });
                    if (typeof result === "object" && "collection" in result) {
                        await save({ status: "completed", result });
                        return;
                    }
                    if (attempt < 119) await delay(2500, undefined, { signal });
                }
                await save({ status: "paused", code: "MODEL_TASK_PAUSED" });
            } catch (error) {
                await pendingWrite.catch(() => {});
                if (signal.aborted) {
                    if (this.closing && record.remote) return;
                    await save(this.closing ? { status: "interrupted", code: "MODEL_TASK_INTERRUPTED" } : { status: "cancelled", code: "MODEL_TASK_CANCELLED" });
                } else {
                    const { code, message } = modelErrorInfo(error);
                    const pauseCode = code === "MODEL_VIDEO_CONNECTION_CHANGED" || code === "MODEL_LOCAL_VIDEO_CONNECTION_UNVERIFIED" ? code : "MODEL_TASK_PAUSED";
                    await save(record.remote && code !== "MODEL_TASK_FAILED" ? { status: "paused", code: pauseCode, message: undefined } : { status: "failed", code, message, ...(request && { upstream }) });
                }
            }
        };
        const done = run().catch((error) => {
            this.writeFailures.add(taskId);
            for (const wake of this.observers.get(taskId) ?? []) wake();
            logger.error("Task could not be saved", { taskId, error });
        }).finally(() => this.workers.delete(taskId));
        this.workers.set(taskId, { controller, started, done });
        return started;
    }

    async read(taskId: string, after: string | undefined, signal: AbortSignal): Promise<ModelTask> {
        await this.ready;
        // 先订阅再读，终态即使恰好写在两者之间也不会漏掉。
        let wake!: () => void;
        const changed = new Promise<void>((resolve) => { wake = resolve; });
        const observers = this.observers.get(taskId) ?? new Set();
        this.observers.set(taskId, observers);
        observers.add(wake);
        signal.addEventListener("abort", wake, { once: true });
        try {
            signal.throwIfAborted();
            const row = await this.storage.read<TaskRecord>("task", taskId);
            if (!row?.value) throw new ModelExecutionError("MODEL_TASK_MISSING");
            if (this.writeFailures.has(taskId)) throw new ModelExecutionError("MODEL_UNAVAILABLE");
            const task = row.value.snapshot;
            if (task.status !== "running" || task.revision !== after) return task;
            await changed;
            signal.throwIfAborted();
            if (this.writeFailures.has(taskId)) throw new ModelExecutionError("MODEL_UNAVAILABLE");
            return (await this.storage.read<TaskRecord>("task", taskId))!.value!.snapshot;
        } finally {
            observers.delete(wake);
            if (!observers.size) this.observers.delete(taskId);
            signal.removeEventListener("abort", wake);
        }
    }

    async resume(taskId: string) {
        await this.ready;
        const row = await this.storage.read<TaskRecord>("task", taskId);
        if (!row?.value) throw new ModelExecutionError("MODEL_TASK_MISSING");
        if (row.value.snapshot.status === "paused" && row.value.remote?.channelFingerprint) {
            await this.workers.get(taskId)?.done;
            const latest = await this.storage.read<TaskRecord>("task", taskId);
            if (latest?.value?.snapshot.status === "paused") await this.launch(latest.value);
        }
    }

    async cancel(taskId: string) {
        await this.ready;
        await this.opening.get(taskId);
        const worker = this.workers.get(taskId);
        worker?.controller.abort();
        await worker?.done;
    }

    async close() {
        this.closing = true;
        await this.ready;
        await Promise.allSettled(this.opening.values());
        for (const worker of this.workers.values()) worker.controller.abort();
        await Promise.allSettled([...this.workers.values()].map((worker) => worker.done));
    }
}
