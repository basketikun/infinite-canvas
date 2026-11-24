import type { PluginWorkInfo, PluginWorks } from "@infinite-canvas/plugin-sdk";
import { projectData } from "@infinite-canvas/plugin-sdk/builtin";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { pluginStandaloneWorkSchema, type PluginStandaloneWork } from "@infinite-canvas/shared/canvas/schema/canvas";
import { PluginError } from "@infinite-canvas/shared/plugins";
import type { WorkSyncRecord } from "@infinite-canvas/shared/storage-data";
import { storage } from "@workbench/services/storage/runtime";
import { createDomainData, queueDomainWrite, type TrackData } from "./project-data";
import { pluginRegistry } from "./registry";

// 已接受但写入失败的作品仍持有它的附件。重试从这份文档继续合并各域。
const pendingWorks = new Map<string, PluginStandaloneWork>();
const workWrites = new Map<string, Promise<unknown>>();
const editors = new Map<string, number>();
let workRevision = 0;

export async function readWorkSyncRecords() {
    const revision = workRevision;
    if (workWrites.size || pendingWorks.size) throw new PluginError("PLUGIN_CONFLICT");
    const records = await storage.works.syncRecords();
    if (workRevision !== revision || workWrites.size || pendingWorks.size) throw new PluginError("PLUGIN_CONFLICT");
    return records;
}

export function applySyncedWork(expected: WorkSyncRecord | null, next: WorkSyncRecord, signal: AbortSignal) {
    const id = next.id;
    signal.throwIfAborted();
    if (editors.has(id) || workWrites.has(id) || pendingWorks.has(id)) throw new PluginError("PLUGIN_CONFLICT");
    return queueDomainWrite(workWrites, id, async () => {
        signal.throwIfAborted();
        if (editors.has(id)) throw new PluginError("PLUGIN_CONFLICT");
        if (!await storage.works.compareSync(expected, next)) throw new PluginError("PLUGIN_CONFLICT");
        workRevision++;
    });
}

async function ownedWork(owner: string, packageName: string, id: string) {
    const work = pendingWorks.get(id) ?? await storage.works.getItem<PluginStandaloneWork>(id);
    if (!work || work.owner !== owner || work.packageName !== packageName) throw new PluginError("PLUGIN_NOT_FOUND");
    return work;
}

async function saveWork(work: PluginStandaloneWork, onDispatch?: () => void) {
    workRevision++;
    onDispatch?.();
    pendingWorks.set(work.workId, work);
    await storage.works.setItem(work.workId, work);
    if (pendingWorks.get(work.workId) === work) pendingWorks.delete(work.workId);
}

export function createPluginWorks(owner: string, packageName: string, binding: ScopeBinding, assertEnabled: () => void, track: TrackData): PluginWorks {
    function directory() {
        assertEnabled();
        if (!pluginRegistry.query(projectData, binding).some((entry) => entry.pluginId === owner)) throw new PluginError("PLUGIN_INVALID");
    }
    async function readWork(id: string, signal: AbortSignal) {
        signal.throwIfAborted();
        await workWrites.get(id)?.catch(() => {});
        signal.throwIfAborted();
        const work = await ownedWork(owner, packageName, id);
        signal.throwIfAborted();
        return work;
    }
    function archive<T>(signal: AbortSignal, run: (api: typeof import("../canvas/work-archive"), active: AbortSignal) => Promise<T>) {
        return track(async () => {
            directory();
            const active = AbortSignal.any([binding.signal, signal]);
            active.throwIfAborted();
            const api = await import("../canvas/work-archive");
            active.throwIfAborted();
            const result = await run(api, active);
            active.throwIfAborted();
            directory();
            return result;
        });
    }
    return {
        async list() {
            return track(async () => {
                directory();
                const works: PluginWorkInfo[] = [];
                await storage.works.iterate<PluginStandaloneWork, void>((work) => {
                    if (work.owner === owner && work.packageName === packageName) works.push({ workId: work.workId, title: work.title });
                });
                directory();
                return works.sort((a, b) => a.title.localeCompare(b.title) || a.workId.localeCompare(b.workId));
            });
        },
        async create(workId, title) {
            return track(async () => {
                directory();
                const created = pluginStandaloneWorkSchema.safeParse({ workId, owner, packageName, title, pluginDomains: [] });
                if (!created.success) throw new PluginError("PLUGIN_INVALID");
                return queueDomainWrite(workWrites, workId, async () => {
                    directory();
                    workRevision++;
                    const matches = await storage.works.create(created.data);
                    directory();
                    if (!matches) throw new PluginError("PLUGIN_CONFLICT");
                    return { workId, title };
                });
            });
        },
        async open(workId, signal) {
            return track(async () => {
                const selection = AbortSignal.any([binding.signal, signal]);
                const active = () => {
                    directory();
                    if (signal.aborted) throw new PluginError("PLUGIN_SCOPE_CLOSED");
                };
                active();
                const read = async () => {
                    active();
                    const work = await ownedWork(owner, packageName, workId);
                    active();
                    return work;
                };
                await queueDomainWrite(workWrites, workId, async () => {
                    await read();
                    active();
                    editors.set(workId, (editors.get(workId) ?? 0) + 1);
                    selection.addEventListener("abort", () => {
                        const count = editors.get(workId)! - 1;
                        if (count) editors.set(workId, count); else editors.delete(workId);
                    }, { once: true });
                });
                return createDomainData(owner, packageName, binding, {
                    target: { kind: "work", id: workId }, selection,
                    key: () => workId,
                    assertActive: active,
                    async open() {
                        const work = await read();
                        return { records: work.pluginDomains, commit(record, _before, onDispatch) {
                            const others = work.pluginDomains.filter((item) => item.owner !== owner || item.domain !== record.domain);
                            const next = { ...work, pluginDomains: [...others, record] };
                            return saveWork(next, () => { active(); onDispatch?.(); });
                        } };
                    },
                }, track, workWrites);
            });
        },
        export(workIds, signal) {
            const ids = [...new Set(workIds)];
            return archive(signal, async (api, active) => {
                if (!ids.length) throw new PluginError("PLUGIN_INVALID");
                const works: PluginStandaloneWork[] = [];
                for (const id of ids) works.push(await readWork(id, active));
                return api.exportWorkArchive(works, active);
            });
        },
        import(file, signal) {
            return archive(signal, (api, active) => api.importWorkArchive(file, { owner, packageName }, active));
        },
        copy(workId, title, signal) {
            return archive(signal, async (api, active) => {
                if (!title) throw new PluginError("PLUGIN_INVALID");
                return api.copyStandaloneWork(await readWork(workId, active), title, active);
            });
        },
    };
}
