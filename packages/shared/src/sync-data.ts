import { z } from "zod";
import { PluginError, type PluginJsonValue } from "./plugins.js";

export const pluginSyncStoragePrefix = "builtin:sync-data:";
const id = z.string().min(1);
const timestamp = z.string().datetime({ offset: true });

// 同步写入的比较和传输均使用 JSON。拒绝会消失的成员以及循环；只校验，不重建业务对象的键。
function isSyncJson(value: unknown, parents: Set<object>): boolean {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value !== "object" || parents.has(value)) return false;
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
    const keys = Object.keys(value);
    if (Reflect.ownKeys(value).length !== keys.length + (array ? 1 : 0)) return false;
    if (array && (keys.length !== value.length || keys.some((key, index) => key !== String(index)))) return false;
    parents.add(value);
    const valid = keys.every((key) => {
        const property = Object.getOwnPropertyDescriptor(value, key)!;
        return "value" in property && isSyncJson(property.value, parents);
    });
    parents.delete(value);
    return valid;
}

export function pluginSyncStorageKey(domainId: string) {
    return pluginSyncStoragePrefix + domainId;
}

export function assertPluginStorageKey(key: string) {
    if (key.startsWith(pluginSyncStoragePrefix)) throw new PluginError("PLUGIN_INVALID");
    return key;
}

export const pluginSyncRecordSchema = z.object({
    id, updatedAt: timestamp, value: z.custom<PluginJsonValue>((value) => isSyncJson(value, new Set())),
    files: z.array(z.object({ slot: id, key: id }).strict()).refine((files) => new Set(files.map((file) => file.slot)).size === files.length),
}).strict();
export type PluginSyncRecord = z.infer<typeof pluginSyncRecordSchema>;

export const pluginSyncSnapshotSchema = z.object({
    dataVersion: z.number().int().positive(),
    records: z.array(pluginSyncRecordSchema),
    deleted: z.array(z.object({ id, deletedAt: timestamp }).strict()),
}).strict().refine(({ records, deleted }) => new Set([...records.map((item) => item.id), ...deleted.map((item) => item.id)]).size === records.length + deleted.length);
export type PluginSyncDomainSnapshot = z.infer<typeof pluginSyncSnapshotSchema>;
