import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { CONFIG_DIR } from "../config.js";
import type { CollaborationData } from "./types.js";

const STORAGE_VERSION = 1;
const EMPTY_DATA: CollaborationData = { version: STORAGE_VERSION, sessions: [] };
const identitySchema = z.object({
    kind: z.enum(["codex", "zcode", "trae", "claude"]),
    name: z.string(),
    instanceId: z.string(),
}).passthrough();
const claimSchema = z.object({
    agent: identitySchema,
    attempt: z.number().int().positive(),
    claimedAt: z.number(),
    leaseUntil: z.number(),
}).passthrough();
const resultSchema = z.object({
    agent: identitySchema,
    attempt: z.number().int().positive(),
    status: z.enum(["completed", "failed"]),
    summary: z.string(),
    data: z.unknown().optional(),
    createdAt: z.number(),
}).passthrough();
const taskSchema = z.object({
    id: z.string(),
    sessionId: z.string(),
    parentTaskId: z.string().optional(),
    title: z.string(),
    instructions: z.string(),
    targetKinds: z.array(z.enum(["codex", "zcode", "trae", "claude"])),
    dependsOn: z.array(z.string()),
    depth: z.number().int().nonnegative(),
    status: z.enum(["draft", "open", "claimed", "completed", "failed", "cancelled"]),
    claims: z.array(claimSchema),
    results: z.array(resultSchema),
    attempts: z.record(z.number().int().nonnegative()),
    createdAt: z.number(),
    updatedAt: z.number(),
    deadlineAt: z.number().optional(),
    canvasProjectId: z.string().optional(),
    canvasRevision: z.number().int().positive().optional(),
    codexDispatch: z.enum(["mailbox", "active"]).optional(),
}).passthrough();
const collaborationDataSchema = z.object({
    version: z.literal(STORAGE_VERSION),
    sessions: z.array(z.object({
        id: z.string(),
        title: z.string(),
        goal: z.string(),
        mode: z.enum(["broadcast", "orchestrated"]),
        status: z.enum(["open", "completed", "cancelled"]),
        coordinator: identitySchema.optional(),
        members: z.array(identitySchema.extend({ role: z.enum(["coordinator", "worker"]), joinedAt: z.number(), lastSeenAt: z.number() })),
        tasks: z.array(taskSchema),
        maxDepth: z.number().int().positive(),
        maxTasks: z.number().int().positive(),
        maxParallelClaims: z.number().int().positive(),
        createdAt: z.number(),
        updatedAt: z.number(),
    }).passthrough()),
});

export class CollaborationStore {
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(private readonly filePath = path.join(CONFIG_DIR, "collaboration", "sessions.json")) {}

    async read(): Promise<CollaborationData> {
        try {
            const value = JSON.parse(await fs.readFile(this.filePath, "utf8")) as CollaborationData;
            if (!validData(value)) throw new Error("协作存储版本未知或格式损坏");
            return structuredClone(value);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY_DATA);
            throw error;
        }
    }

    mutate<T>(operation: (data: CollaborationData) => T | Promise<T>): Promise<T> {
        const result = this.writeQueue.then(async () => {
            const data = await this.read();
            const value = await operation(data);
            await this.write(data);
            return value;
        });
        this.writeQueue = result.then(() => undefined, () => undefined);
        return result;
    }

    private async write(data: CollaborationData) {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const temporary = `${this.filePath}.${process.pid}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
        await fs.rename(temporary, this.filePath);
    }
}

function validData(value: CollaborationData) {
    return collaborationDataSchema.safeParse(value).success;
}
