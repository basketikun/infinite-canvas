import { z } from "zod";
import { objectStorageConfigSchema } from "./object-storage.js";

export const syncTransportIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*:[^:\s]+$/);
export const syncTransportFieldKeySchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/).refine((key) => key !== "prototype" && !Object.hasOwn(Object.prototype, key));
const packageName = z.string().min(1).refine((key) => key !== "__proto__");
const timestamp = z.string().datetime({ offset: true });
export const syncConnectionConfigSchema = z.object({
    url: z.string(), directory: z.string(), values: z.record(syncTransportFieldKeySchema, z.string()), lastSyncedAt: z.union([z.literal(""), timestamp]),
}).strict();
export type SyncConnectionConfig = z.infer<typeof syncConnectionConfigSchema>;
const connections = z.record(syncTransportIdSchema, z.record(packageName, syncConnectionConfigSchema));
export const workspaceConfigSchema = z.object({ syncConnections: connections, objectStorage: objectStorageConfigSchema }).strict();
export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
export const defaultWorkspaceConfig: WorkspaceConfig = {
    syncConnections: {},
    objectStorage: { endpoint: "", region: "", bucket: "", accessKeyId: "", secretAccessKey: "", publicBaseUrl: "", forcePathStyle: true },
};

// 对象存储延用其原有物理位置。没有配置过同步传输的工作区只读取该字段。
export const storedWorkspaceConfigSchema = z.object({ objectStorage: objectStorageConfigSchema, syncConnections: connections.default({}) });

export const workspaceConfigMutationSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("objectStorage"), config: objectStorageConfigSchema }).strict(),
    z.object({ kind: z.literal("connection"), id: syncTransportIdSchema, packageName, config: syncConnectionConfigSchema }).strict(),
    z.object({ kind: z.literal("confirm"), id: syncTransportIdSchema, packageName, expected: syncConnectionConfigSchema, syncedAt: timestamp }).strict(),
]);
export type WorkspaceConfigMutation = z.infer<typeof workspaceConfigMutationSchema>;

export function workspaceConnection(config: WorkspaceConfig, id: string, owner: string) {
    const entries = config.syncConnections[id];
    return entries && Object.hasOwn(entries, owner) ? entries[owner] : null;
}

export function applyWorkspaceConfigMutation(current: WorkspaceConfig, change: WorkspaceConfigMutation): WorkspaceConfig | null {
    if (change.kind === "objectStorage") return { ...current, objectStorage: change.config };
    const previous = workspaceConnection(current, change.id, change.packageName);
    const config = change.kind === "confirm" ? change.expected : change.config;
    const same = previous && previous.url === config.url && previous.directory === config.directory
        && Object.keys(previous.values).length === Object.keys(config.values).length
        && Object.entries(config.values).every(([key, value]) => Object.hasOwn(previous.values, key) && previous.values[key] === value);
    if (change.kind === "confirm" && (!same || previous.lastSyncedAt !== config.lastSyncedAt)) return null;
    const lastSyncedAt = change.kind === "confirm" ? change.syncedAt : same ? previous.lastSyncedAt : "";
    return { ...current, syncConnections: {
        ...current.syncConnections, [change.id]: { ...current.syncConnections[change.id], [change.packageName]: { ...config, lastSyncedAt } },
    } };
}
