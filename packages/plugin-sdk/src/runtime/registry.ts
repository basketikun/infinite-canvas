import { PluginError } from "@infinite-canvas/shared/plugins";
import { PluginScope } from "../scope";
import { isReadonlySnapshot } from "../readonly-snapshot";
import type { Capability, CapabilityHandle, ExtensionPoint, PluginCapabilities, PluginDeclarations, PluginExtensions, RegisteredContribution, ScopeBinding } from "./contracts";

type PointRecord = { owner: RegistryInstance; point: ExtensionPoint<any>; controller: AbortController };
type ContributionRecord = { owner: RegistryInstance; point: ExtensionPoint<any>; id: string; value: unknown; sequence: number; controller: AbortController };
type CapabilityRecord = { owner: RegistryInstance; contract: Capability<any>; implementation: Record<string, (...args: any[]) => any>; controller: AbortController };
type Published = { record: ContributionRecord; provider: PointRecord; entry: RegisteredContribution<any> };
const empty = Object.freeze([]) as readonly RegisteredContribution<any>[];

function snapshot(value: any): any {
    if (value && typeof value === "object" && isReadonlySnapshot(value)) return value;
    if (Array.isArray(value)) return Object.freeze(value.map(snapshot));
    if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype || "$$typeof" in value) return value;
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item)])));
}

export function assertBinding(binding: ScopeBinding, required: ExtensionPoint<unknown>["scope"]) {
    if (binding.signal.aborted) throw new PluginError("PLUGIN_SCOPE_CLOSED");
    if (binding.kind !== "application" && !binding.workspaceId || binding.kind === "project" && !binding.projectId || binding.kind === "view" && !binding.viewId) throw new PluginError("PLUGIN_CONTRACT_MISMATCH");
    if (required === "workspace" && binding.kind === "application" || required === "project" && (binding.kind !== "project" && binding.kind !== "view" || !binding.projectId) || required === "view" && binding.kind !== "view") throw new PluginError("PLUGIN_CONTRACT_MISMATCH");
}

const rank = (record: ContributionRecord) => record.owner.pluginId === "builtin" ? 0 : 1;
function compare(a: ContributionRecord, b: ContributionRecord) {
    return rank(a) - rank(b) || (a.owner.pluginId < b.owner.pluginId ? -1 : a.owner.pluginId > b.owner.pluginId ? 1 : 0) || a.sequence - b.sequence;
}

/**
 * 一份贡献目录；贡献随时登记和撤销，提供方未登记扩展点时贡献静置，校验失败的贡献跳过并记录。
 */
export class ExtensionRegistry {
    private sequence = 0;
    private instances = new Set<RegistryInstance>();
    private points = new Map<string, PointRecord>();
    private capabilities = new Map<string, CapabilityRecord>();
    private published = new Map<string, Published[]>();
    // 校验失败的贡献只在对应提供方下报告一次。
    private rejected = new WeakMap<ContributionRecord, PointRecord>();
    private snapshots = new Map<string, readonly RegisteredContribution<any>[]>();
    private listeners = new Set<() => void>();
    private bindings = new WeakMap<ScopeBinding, Map<string, { source: readonly RegisteredContribution<any>[]; value: readonly RegisteredContribution<any>[] }>>();
    private handles = new WeakMap<ScopeBinding, Map<string, { record: CapabilityRecord; value: object }>>();

    createInstance(options: { id: string; scope: PluginScope }) {
        options.scope.assertActive();
        const instance = new RegistryInstance(this, ++this.sequence, options.id, options.scope);
        this.instances.add(instance);
        return instance;
    }

    getSnapshot<T>(point: ExtensionPoint<T>): readonly RegisteredContribution<T>[] {
        return this.snapshots.get(point.id) ?? empty;
    }

    query<T>(point: ExtensionPoint<T>, binding: ScopeBinding): readonly RegisteredContribution<T>[] {
        assertBinding(binding, point.scope);
        const source = this.getSnapshot(point);
        let cache = this.bindings.get(binding);
        if (!cache) { cache = new Map(); this.bindings.set(binding, cache); }
        const previous = cache.get(point.id);
        if (previous?.source === source) return previous.value;
        const retained = new Map(previous?.source.map((entry, index) => [entry, previous.value[index]]));
        const value = Object.freeze(source.map((entry) => retained.get(entry) ?? Object.freeze({
            ...entry,
            signal: AbortSignal.any([entry.signal, binding.signal]),
            assertActive: () => { entry.assertActive(); assertBinding(binding, point.scope); },
        })));
        cache.set(point.id, { source, value });
        return value;
    }

    track<T>(entry: RegisteredContribution<unknown>, action: () => T): T {
        entry.assertActive();
        const published = this.published.get(entry.point)?.find((item) => item.entry.id === entry.id && item.entry.instanceId === entry.instanceId);
        if (!published) throw new PluginError("PLUGIN_INACTIVE");
        const run = () => {
            try {
                const result = action();
                if (result && typeof (result as unknown as Promise<unknown>).then === "function") return Promise.resolve(result).then((value) => { entry.assertActive(); return value; }, (error) => { entry.assertActive(); throw error; }) as T;
                entry.assertActive();
                return result;
            } catch (error) { entry.assertActive(); throw error; }
        };
        return published.record.owner.scope.track(() => published.provider.owner === published.record.owner ? run() : published.provider.owner.scope.track(run));
    }

    subscribeAll(listener: () => void) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    subscribe<T>(point: ExtensionPoint<T>, binding: ScopeBinding, listener: () => void) {
        let previous = this.query(point, binding);
        const remove = this.subscribeAll(() => {
            const next = this.query(point, binding);
            if (next !== previous) { previous = next; listener(); }
        });
        const dispose = () => { remove(); binding.signal.removeEventListener("abort", dispose); };
        binding.signal.addEventListener("abort", dispose, { once: true });
        return dispose;
    }

    getCapability<T extends object>(contract: Capability<T>, binding: ScopeBinding, caller?: PluginScope, callerId = "builtin", bindingSignal = binding.signal): CapabilityHandle<T> | null {
        assertBinding(binding, contract.scope);
        caller?.assertActive();
        const record = this.capabilities.get(contract.id);
        if (!record) return null;
        let cache = this.handles.get(binding);
        if (!cache) { cache = new Map(); this.handles.set(binding, cache); }
        const key = `${callerId}\0${contract.id}`;
        const previous = cache.get(key);
        if (previous?.record === record) return previous.value as CapabilityHandle<T>;
        const signal = AbortSignal.any([record.owner.signal, record.controller.signal, binding.signal, ...(caller ? [caller.signal] : [])]);
        const scope = Object.freeze({ ...binding, signal });
        const context = Object.freeze({ callerId, callerSignal: caller?.signal ?? binding.signal, bindingSignal, signal, scope });
        const assertActive = () => {
            record.owner.assertActive();
            assertBinding(binding, contract.scope);
            caller?.assertActive();
            if (record.controller.signal.aborted || this.capabilities.get(contract.id) !== record) throw new PluginError("PLUGIN_INACTIVE");
        };
        const handle = Object.freeze(Object.fromEntries(Object.keys(record.contract.methods).map((method) => {
            const schemas = record.contract.methods[method];
            return [method, (input: unknown) => {
                assertActive();
                const completed = (value: unknown) => {
                    assertActive();
                    const output = schemas.output.safeParse(value);
                    if (!output.success) throw new PluginError("PLUGIN_CONTRACT_MISMATCH", { cause: output.error });
                    const result = snapshot(output.data);
                    assertActive();
                    return result;
                };
                const failed = (error: unknown): never => {
                    console.error(`[plugins] ${contract.id} ${method}`, error);
                    assertActive();
                    throw error instanceof PluginError ? error : new PluginError("PLUGIN_OPERATION_FAILED", { cause: error });
                };
                try {
                    const run = () => record.owner.scope.track(() => {
                        const parsed = schemas.input.safeParse(input);
                        if (!parsed.success) throw new PluginError("PLUGIN_CONTRACT_MISMATCH", { cause: parsed.error });
                        const value = snapshot(parsed.data);
                        assertActive();
                        const result = record.implementation[method](value, context);
                        if (result && typeof result.then === "function") return Promise.resolve(result).then(completed).catch(failed);
                        return completed(result);
                    });
                    return caller && caller !== record.owner.scope ? caller.track(run) : run();
                } catch (error) { return failed(error); }
            }];
        }))) as CapabilityHandle<T>;
        cache.set(key, { record, value: handle });
        return handle;
    }

    publish() {
        const points = new Map<string, PointRecord>();
        const capabilities = new Map<string, CapabilityRecord>();
        const contributions = new Map<string, ContributionRecord[]>();
        for (const owner of this.instances) {
            for (const [id, record] of owner.points) points.set(id, record);
            for (const [id, record] of owner.provided) capabilities.set(id, record);
            for (const record of owner.contributions.values()) {
                const records = contributions.get(record.point.id) ?? [];
                records.push(record);
                contributions.set(record.point.id, records);
            }
        }
        const published = new Map<string, Published[]>();
        const snapshots = new Map<string, readonly RegisteredContribution<any>[]>();
        for (const [id, records] of contributions) {
            const provider = points.get(id);
            if (!provider) continue;
            const entries = records.sort(compare).flatMap((record): Published[] => {
                const previous = this.published.get(id)?.find((item) => item.record === record && item.provider === provider);
                if (previous || this.rejected.get(record) === provider) return previous ? [previous] : [];
                const result = provider.point.schema.safeParse(record.value);
                if (!result.success) { this.rejected.set(record, provider); console.error(`[plugins] ${record.owner.pluginId} ${id} ${record.id} 已跳过`, result.error); return []; }
                const signal = AbortSignal.any([record.owner.signal, record.controller.signal, provider.owner.signal, provider.controller.signal]);
                return [{ record, provider, entry: Object.freeze({
                    id: record.id, point: id, pluginId: record.owner.pluginId, instanceId: record.owner.instanceId,
                    value: snapshot(result.data), signal,
                    assertActive: () => {
                        record.owner.assertActive(); provider.owner.assertActive();
                        if (signal.aborted || !this.instances.has(record.owner) || this.points.get(id) !== provider) throw new PluginError("PLUGIN_INACTIVE");
                    },
                }) }];
            });
            published.set(id, entries);
            const previous = this.snapshots.get(id);
            snapshots.set(id, previous && previous.length === entries.length && entries.every((item, index) => item.entry === previous[index]) ? previous : Object.freeze(entries.map((item) => item.entry)));
        }
        const changed = this.points.size !== points.size || [...points].some(([id, value]) => this.points.get(id) !== value) || this.capabilities.size !== capabilities.size || [...capabilities].some(([id, value]) => this.capabilities.get(id) !== value) || this.snapshots.size !== snapshots.size || [...snapshots].some(([id, value]) => this.snapshots.get(id) !== value);
        this.points = points;
        this.capabilities = capabilities;
        this.published = published;
        this.snapshots = snapshots;
        if (changed) for (const listener of this.listeners) {
            try { listener(); } catch (error) { console.error("[plugins] registry subscriber", error); }
        }
    }

    remove(instance: RegistryInstance) {
        if (this.instances.delete(instance)) this.publish();
    }
}

export class RegistryInstance {
    readonly points = new Map<string, PointRecord>();
    readonly contributions = new Map<string, ContributionRecord>();
    readonly provided = new Map<string, CapabilityRecord>();
    readonly extensions: PluginExtensions;
    readonly capabilities: PluginCapabilities & { provide<T extends object>(contract: Capability<T>, implementation: T): () => void };
    readonly signal: AbortSignal;
    private controller = new AbortController();
    private disposed = false;
    private bindings = new WeakMap<ScopeBinding, ScopeBinding>();
    private sequence = 0;

    constructor(private registry: ExtensionRegistry, readonly instanceId: number, readonly pluginId: string, readonly scope: PluginScope) {
        this.signal = AbortSignal.any([scope.signal, this.controller.signal]);
        scope.signal.addEventListener("abort", this.dispose, { once: true });
        this.extensions = {
            define: (point) => {
                if (!point.id.startsWith(`${pluginId}:`)) throw new PluginError("PLUGIN_INVALID");
                return this.install(this.points, point.id, { owner: this, point, controller: new AbortController() });
            },
            contribute: (point, contribution) => {
                if (!contribution.id.startsWith(`${pluginId}:`)) throw new PluginError("PLUGIN_INVALID");
                return this.install(this.contributions, `${point.id}\0${contribution.id}`, { owner: this, point, id: contribution.id, value: contribution.value, sequence: ++this.sequence, controller: new AbortController() });
            },
            query: (point, binding) => registry.query(point, this.bind(binding)),
            subscribe: (point, binding, listener) => this.watch(this.bind(binding), () => this.extensions.query(point, binding), listener),
            track: (entry, action) => scope.track(() => {
                this.assertActive();
                const result = registry.track(entry, action);
                if (result && typeof (result as unknown as Promise<unknown>).then === "function") return Promise.resolve(result).then((value) => { this.assertActive(); return value; }, (error) => { this.assertActive(); throw error; }) as unknown as typeof result;
                this.assertActive();
                return result;
            }),
        };
        this.capabilities = {
            provide: (contract, implementation) => this.install(this.provided, contract.id, { owner: this, contract, implementation: Object.freeze({ ...(implementation as Record<string, (...args: any[]) => any>) }), controller: new AbortController() }),
            get: (contract, binding) => {
                this.assertActive();
                return registry.getCapability(contract, this.bind(binding), this.scope, this.pluginId, binding.signal);
            },
        };
    }

    assertActive() {
        if (this.disposed || this.signal.aborted) throw new PluginError("PLUGIN_INACTIVE");
    }

    getCapability<T extends object>(contract: Capability<T>, binding: ScopeBinding, caller = this.scope): CapabilityHandle<T> | null {
        this.assertActive();
        return this.registry.getCapability(contract, this.bind(binding), caller, this.pluginId, binding.signal);
    }

    private watch<T>(binding: ScopeBinding, read: () => T, listener: () => void) {
        let previous = read();
        const remove = this.registry.subscribeAll(() => {
            const next = read();
            if (next !== previous) { previous = next; listener(); }
        });
        const dispose = () => { remove(); binding.signal.removeEventListener("abort", dispose); };
        binding.signal.addEventListener("abort", dispose, { once: true });
        return dispose;
    }

    private bind(binding: ScopeBinding) {
        this.assertActive();
        let result = this.bindings.get(binding);
        if (!result) { result = { ...binding, signal: AbortSignal.any([this.signal, binding.signal]) }; this.bindings.set(binding, result); }
        return result;
    }

    private install<T extends { controller: AbortController }>(map: Map<string, T>, key: string, record: T) {
        this.assertActive();
        if (map.has(key)) throw new PluginError("PLUGIN_CONFLICT");
        map.set(key, record);
        try { this.registry.publish(); }
        catch (error) { map.delete(key); record.controller.abort(); throw error; }
        return () => {
            if (map.get(key) !== record || this.disposed) return;
            map.delete(key);
            record.controller.abort();
            this.registry.publish();
        };
    }

    register(declarations: PluginDeclarations) {
        this.assertActive();
        try {
            for (const point of declarations.extensionPoints ?? []) this.extensions.define(point);
            for (const contribution of declarations.contributions ?? []) this.extensions.contribute(contribution.point, contribution);
        } catch (error) { this.dispose(); throw error; }
    }

    dispose = () => {
        if (this.disposed) return;
        this.disposed = true;
        this.controller.abort();
        this.scope.signal.removeEventListener("abort", this.dispose);
        this.registry.remove(this);
        this.points.clear(); this.contributions.clear(); this.provided.clear();
    };
}
