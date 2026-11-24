import type { PluginProjectData, PluginResourceRef, ResourcesCapability } from "@infinite-canvas/plugin-sdk";
import { projectData } from "@infinite-canvas/plugin-sdk/builtin";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { StorageError } from "@infinite-canvas/shared/storage-data";
import { pluginProjectValueSchema, type PluginProjectDomainRecord, type PluginProjectResource } from "@infinite-canvas/shared/canvas/schema/canvas";
import { sha256 } from "@infinite-canvas/shared/utils/sha256";
import { storage } from "@workbench/services/storage/runtime";
import { useCanvasStore } from "@workbench/stores/canvas/use-canvas-store";
import { capabilityCaller } from "./capability-caller";
import { pluginRegistry } from "./registry";

type DomainDocument = { records: readonly PluginProjectDomainRecord[]; commit(record: PluginProjectDomainRecord, before?: PluginProjectDomainRecord, onDispatch?: () => void): Promise<void> };
type DomainStore = { target?: Pick<PluginResourceRef, "kind" | "id">; selection: AbortSignal; key(domain: string): string; assertActive(): void; open(): DomainDocument | Promise<DomainDocument> };
export type TrackData = <T>(action: () => Promise<T>) => Promise<T>;
// 画布按域串行，独立作品的多个域写在同一份文档中，按作品串行。
const canvasWrites = new Map<string, Promise<unknown>>();
export function queueDomainWrite<T>(domainWrites: Map<string, Promise<unknown>>, key: string, action: () => Promise<T>) {
    const previous = domainWrites.get(key) ?? Promise.resolve();
    const write = previous.catch(() => {}).then(action);
    domainWrites.set(key, write);
    return write.finally(() => { if (domainWrites.get(key) === write) domainWrites.delete(key); });
}

type ResourceReader = { target: NonNullable<DomainStore["target"]>; selection: AbortSignal; read: ResourcesCapability["read"] };
const resourceReaders = new WeakMap<AbortSignal, Set<ResourceReader>>();
export function openedWorkSignal(callerSignal: AbortSignal, workId: string): AbortSignal {
    for (const entry of resourceReaders.get(callerSignal) ?? []) {
        if (entry.target.kind === "work" && entry.target.id === workId && !entry.selection.aborted) return entry.selection;
    }
    throw new PluginError("PLUGIN_TASK_UNAVAILABLE");
}
export const resourceMethods: ResourcesCapability = {
    async read(ref, context) {
        const caller = capabilityCaller(context);
        const reader = Array.from(resourceReaders.get(caller.scope.signal) ?? []).find((item) => item.target.kind === ref.kind && item.target.id === ref.id);
        if (!reader) throw new PluginError("PLUGIN_NOT_FOUND");
        return reader.read(ref, context);
    },
};

export function createDomainData(owner: string, packageName: string, binding: ScopeBinding, store: DomainStore, track: TrackData, domainWrites = canvasWrites): PluginProjectData {
    function target(domain: string) {
        store.assertActive();
        const entry = pluginRegistry.query(projectData, binding).find((item) => item.pluginId === owner && item.value.id === domain);
        if (!entry) throw new PluginError("PLUGIN_INVALID");
        return { domain, entry, dataVersion: entry.value.dataVersion, key: store.key(domain) };
    }
    async function current({ domain, dataVersion, entry }: ReturnType<typeof target>) {
        store.assertActive();
        entry.assertActive();
        const document = await store.open();
        store.assertActive();
        entry.assertActive();
        const record = document.records.find((item) => item.owner === owner && item.domain === domain);
        if (record && record.packageName !== packageName) throw new PluginError("PLUGIN_CONFLICT");
        if (record && record.dataVersion !== dataVersion) throw new PluginError("PLUGIN_CONTRACT_MISMATCH");
        return { document, record };
    }
    async function makeRef(target: NonNullable<DomainStore["target"]>, record: PluginProjectDomainRecord, file: PluginProjectResource): Promise<PluginResourceRef> {
        const revision = await sha256(new TextEncoder().encode(JSON.stringify([owner, packageName, target.kind, target.id, record.domain, record.dataVersion, file.slot, file.key, file.sha256])).buffer);
        return Object.freeze({ ...target, domain: record.domain, dataVersion: record.dataVersion, slot: file.slot, revision });
    }
    if (store.target) {
        const subject = store.target;
        const reader: ResourceReader = { target: subject, selection: store.selection, async read(ref, context) {
            const location = target(ref.domain);
            return pluginRegistry.track(location.entry, async () => {
                await domainWrites.get(location.key)?.catch(() => {});
                const { record } = await current(location);
                const file = record?.resources.find((item) => item.slot === ref.slot);
                if (!record || !file?.sha256 || record.dataVersion !== ref.dataVersion || (await makeRef(subject, record, file)).revision !== ref.revision) throw new PluginError("PLUGIN_NOT_FOUND");
                context.signal.throwIfAborted();
                store.assertActive();
                const blob = await storage.pluginFiles(owner).getItem<Blob>(file.key);
                if (!blob || await sha256(await blob.arrayBuffer()) !== file.sha256) throw new PluginError("PLUGIN_OPERATION_FAILED");
                const latest = (await current(location)).record;
                if (!latest?.resources.some((item) => item.slot === ref.slot && item.key === file.key && item.sha256 === file.sha256)) throw new PluginError("PLUGIN_NOT_FOUND");
                context.signal.throwIfAborted();
                return blob;
            });
        } };
        let active = resourceReaders.get(binding.signal);
        if (!active) { active = new Set(); resourceReaders.set(binding.signal, active); }
        active.add(reader);
        store.selection.addEventListener("abort", () => active.delete(reader), { once: true });
    }
    return {
        async read<T>(domain: string) {
            return track(async () => {
                const location = target(domain);
                await domainWrites.get(location.key)?.catch(() => {});
                const { record } = await current(location);
                store.assertActive();
                if (!record) return null;
                const resources = await Promise.all(record.resources.map((file) => makeRef(store.target!, record, file)));
                store.assertActive();
                location.entry.assertActive();
                return { value: structuredClone(record.value) as T, resources: Object.freeze(resources) };
            });
        },
        async save(domain, value, slots, files) {
            return track(async () => {
                const location = target(domain);
                const parsed = pluginProjectValueSchema.safeParse(value);
                const wanted = new Set(slots);
                const supplied = new Map(files.map(({ key, file }) => [key, file]));
                if (!parsed.success || wanted.size !== slots.length || supplied.size !== files.length ||
                    [...wanted].some((slot) => typeof slot !== "string" || !slot.length) ||
                    [...supplied].some(([key, file]) => !wanted.has(key) || !(file instanceof Blob))) throw new PluginError("PLUGIN_INVALID");

                const snapshot = structuredClone(parsed.data);
                await queueDomainWrite(domainWrites, location.key, async () => {
                    const initial = await current(location);
                    const before = initial.record;
                    const stored = new Map(before?.resources.map((item) => [item.slot, item]));
                    const created: PluginProjectResource[] = [];
                    const resources = [...wanted].map((slot) => {
                        const existing = stored.get(slot);
                        if (existing) return existing;
                        if (!supplied.has(slot)) throw new PluginError("PLUGIN_INVALID");
                        const resource: PluginProjectResource = { slot, owner, collection: "plugin-files", key: crypto.randomUUID() };
                        created.push(resource);
                        return resource;
                    });
                    const record: PluginProjectDomainRecord = { owner, packageName, domain, dataVersion: location.dataVersion, value: snapshot, resources };
                    for (const file of created) {
                        store.assertActive();
                        const blob = supplied.get(file.slot)!;
                        file.sha256 = await sha256(await blob.arrayBuffer());
                        store.assertActive();
                        await storage.pluginFiles(owner).setItem(file.key, blob);
                    }
                    const { document } = created.length ? await current(location) : initial;
                    store.assertActive();
                    location.entry.assertActive();
                    await document.commit(record, before, () => location.entry.assertActive());
                }).finally(() => store.assertActive());
            });
        },
    };
}

export function createProjectData(owner: string, packageName: string, binding: ScopeBinding, assertProject: () => string, track: TrackData) {
    return createDomainData(owner, packageName, binding, {
        target: binding.projectId ? { kind: "canvas", id: binding.projectId } : undefined, selection: binding.signal,
        key: (domain) => JSON.stringify(["canvas", assertProject(), owner, domain]),
        assertActive: assertProject,
        open() {
            const id = assertProject();
            const project = useCanvasStore.getState().openProject(id);
            if (!project) throw new PluginError("PLUGIN_PROJECT_CHANGED");
            return { records: project.pluginDomains ?? [], commit(record, before, onDispatch) {
                const current = useCanvasStore.getState().openProject(id);
                if (!current) throw new PluginError("PLUGIN_PROJECT_CHANGED");
                if (current.pluginDomains?.find((item) => item.owner === owner && item.domain === record.domain) !== before) throw new PluginError("PLUGIN_CONFLICT");
                onDispatch?.();
                return useCanvasStore.getState().savePluginDomain(id, record);
            } };
        },
    }, track);
}
