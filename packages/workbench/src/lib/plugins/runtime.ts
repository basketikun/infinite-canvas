import { useThemeStore } from "@workbench/stores/use-theme-store";
import React from "react";
import * as reactDom from "react-dom";
import * as jsxRuntime from "react/jsx-runtime";
import * as jsxDevRuntime from "react/jsx-dev-runtime";
import * as radix from "radix-ui";
import { PluginScope } from "@infinite-canvas/plugin-sdk/scope";
import { readonlySnapshot } from "@infinite-canvas/plugin-sdk/readonly-snapshot";
import type { CanvasChangeSource, CanvasNodeDefinition, CanvasPlugin, CanvasSession, CanvasSessionCapability, ModelsCapability, PluginAppearance, PluginCanvas, PluginCanvasEvents, PluginCommand, PluginContext, PluginEvents } from "@infinite-canvas/plugin-sdk";
import { assertBinding, type CapabilityCallContext, type ExtensionPoint, type RegistryInstance, type RegisteredContribution, type ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { layouts, themes, nodes, commands, models, projectData, canvasSession, canvasApply, canvasUndo, canvasRedo, canvasSelect, canvasViewport, resources, tasks } from "@infinite-canvas/plugin-sdk/builtin";
import { PluginError, type InstalledPlugin, type PluginErrorCode, type PluginPackage, type PluginRuntimeStatus } from "@infinite-canvas/shared/plugins";
import { builtinPlugin, pluginRegistry, workspaceBinding } from "./registry";
import { workspaceModelMethods, workspaceTaskMethods } from "./models";
import { capabilityCallers } from "./capability-caller";
import { openClientFiles } from "./client-files";
import { createProjectData, resourceMethods } from "./project-data";
import { assertPluginStorageKey } from "@infinite-canvas/shared/sync-data";
import { createPluginWorks } from "./standalone-works";
import { canExecuteCommand, executeCommand } from "./commands";
import { initializeThemes } from "./themes";
import { initializeCallScripts } from "./call-scripts";
import { storage } from "@workbench/services/storage/runtime";
import { hostTransactions } from "@workbench/lib/canvas/host-transaction";
import type { CanvasSession as WorkbenchCanvasSession } from "@workbench/lib/canvas/canvas-session";
import { usePluginStore } from "@workbench/stores/use-plugin-store";

type Instance = { pkg: PluginPackage; scope: PluginScope; ctx: PluginContext; registrations: RegistryInstance; starting?: Promise<void>; stopping?: Promise<void>; lateCleanup?: () => void | Promise<void> };
type Handler = (payload: never) => void | Promise<void>;
const instances = new Map<string, Instance>();
const listeners = new Map<string, Set<Handler>>();
let currentCanvas: WorkbenchCanvasSession | null = null;
let releaseCanvas: (() => void) | undefined;
export let pluginProjectBinding: ScopeBinding | null = null;
const boundContexts = new WeakMap<object, PluginContext>();
const contextScopes = new WeakMap<PluginContext, { owner: Instance; scope: PluginScope }>();
const canvasBindings = new WeakMap<object, ScopeBinding>();
const canvasScopeRoots = new WeakMap<AbortSignal, AbortSignal>();

// 宿主派生的视图可以代表原会话，只有相同 projectId 的外部信号不能代表它。
export function bindCanvasScope<T extends ScopeBinding>(binding: T, parent: AbortSignal): T {
    const root = canvasScopeRoots.get(parent) ?? parent;
    const previous = canvasScopeRoots.get(binding.signal);
    if (previous && previous !== root) throw new PluginError("PLUGIN_PROJECT_CHANGED");
    canvasScopeRoots.set(binding.signal, root);
    return binding;
}

function resolveCanvasScope(binding: ScopeBinding, caller: ScopeBinding, origin = binding.signal) {
    if (binding.signal.aborted) throw new PluginError("PLUGIN_SCOPE_CLOSED");
    if (!currentCanvas || currentCanvas.signal.aborted || binding.workspaceId !== workspaceBinding.workspaceId || binding.projectId !== currentCanvas.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
    if (canvasScopeRoots.get(origin) !== currentCanvas.signal || caller.projectId !== undefined && canvasScopeRoots.get(caller.signal) !== currentCanvas.signal) throw new PluginError("PLUGIN_PROJECT_CHANGED");
    return currentCanvas;
}

function validateContribution<T>(point: ExtensionPoint<T>, contribution: { id: string; value: T }) {
    if (point.id === nodes.id && contribution.id !== (contribution.value as CanvasNodeDefinition).type) throw new PluginError("PLUGIN_INVALID");
    if (point.id === commands.id && contribution.id !== (contribution.value as PluginCommand).command.id) throw new PluginError("PLUGIN_INVALID");
    if (point.id === themes.id && contribution.id !== (contribution.value as PluginAppearance).id) throw new PluginError("PLUGIN_INVALID");
}

export function canvasBinding(canvas: CanvasSession) {
    let binding = canvasBindings.get(canvas);
    if (!binding) {
        binding = bindCanvasScope({ ...workspaceBinding, kind: "project", projectId: canvas.projectId, signal: canvas.signal }, canvas.signal);
        canvasBindings.set(canvas, binding);
    }
    return binding;
}

function tracked<T>(scope: PluginScope, action: () => T): T {
    scope.assertActive();
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => { finish = resolve; });
    const release = scope.add(() => settled);
    const done = () => { finish(); return release(); };
    try {
        const value = action();
        if (value && typeof (value as unknown as Promise<unknown>).then === "function") {
            const delivery = Promise.resolve(value).then((result) => { scope.assertActive(); return result; }, (error) => { scope.assertActive(); throw error; });
            return delivery.finally(done) as T;
        }
        scope.assertActive();
        void done();
        return value;
    } catch (error) {
        void done();
        scope.assertActive();
        throw error;
    }
}

export function runPluginCallback<T>(ctx: PluginContext, contributionId: string, callbackName: string, action: () => T): T {
    const instance = instances.get(ctx.id);
    const context = contextScopes.get(ctx);
    if (!instance || context?.owner !== instance) throw new PluginError("PLUGIN_INACTIVE");
    context.scope.assertActive();
    const failed = (error: unknown): never => {
        console.error(`[plugins] ${ctx.id} ${contributionId} ${callbackName}`, error);
        context.scope.assertActive();
        throw error instanceof PluginError ? error : new PluginError("PLUGIN_OPERATION_FAILED", { cause: error });
    };
    try {
        const value = tracked(context.scope, action);
        if (value && typeof (value as unknown as Promise<unknown>).then === "function") return Promise.resolve(value).catch(failed) as T;
        return value;
    } catch (error) { return failed(error); }
}

export function setPluginCanvas(canvas: WorkbenchCanvasSession | null) {
    if (canvas !== currentCanvas) usePluginStore.getState().panel?.close();
    releaseCanvas?.();
    currentCanvas = canvas;
    pluginProjectBinding = canvas ? canvasBinding(canvas) : null;
    if (canvas) {
        const listeners = [canvas.subscribe(notifyPluginCanvas), ...(["document.committed", "document.saved", "document.saveFailed", "selection.changed", "viewport.changed"] as const).map(event => canvas.on(event, payload => emitPluginEvent(event, payload)))];
        releaseCanvas = () => { for (const unsubscribe of listeners) unsubscribe(); };
    } else releaseCanvas = undefined;
    usePluginStore.setState((state) => ({ canvasRevision: state.canvasRevision + 1 }));
}

export function notifyPluginCanvas() {
    usePluginStore.setState((state) => ({ canvasRevision: state.canvasRevision + 1 }));
}

export function emitPluginEvent<K extends keyof PluginEvents>(event: K, payload: PluginEvents[K]) {
    dispatch(event, readonlySnapshot(payload));
}

function dispatch(event: string, payload: unknown) {
    for (const handler of listeners.get(event) ?? []) {
        try { Promise.resolve(handler(payload as never)).catch((error) => console.error(`[plugin event] ${event}`, error)); }
        catch (error) { console.error(`[plugin event] ${event}`, error); }
    }
}

function listen(scope: PluginScope, id: string, event: string, handler: Handler, signal?: AbortSignal) {
    scope.assertActive();
    signal?.throwIfAborted();
    const set = listeners.get(event) ?? new Set<Handler>();
    listeners.set(event, set);
    let active = true;
    const listener: Handler = (payload) => {
        if (active && !scope.signal.aborted && !signal?.aborted) return tracked(scope, async () => handler(payload)).catch((error) => {
            if (!scope.signal.aborted) console.error(`[plugins] ${id} event ${event}`, error);
        });
    };
    set.add(listener);
    const unsubscribe = () => {
        active = false;
        set.delete(listener);
        if (!set.size && listeners.get(event) === set) listeners.delete(event);
        signal?.removeEventListener("abort", unsubscribe);
        scope.signal.removeEventListener("abort", unsubscribe);
        void dispose();
    };
    const dispose = scope.add(unsubscribe);
    signal?.addEventListener("abort", unsubscribe, { once: true });
    scope.signal.addEventListener("abort", unsubscribe, { once: true });
    return unsubscribe;
}

export function canvasFor(scope: PluginScope, source: CanvasChangeSource, canvas: CanvasSession | null = currentCanvas, binding?: ScopeBinding, producer?: RegisteredContribution<unknown>): PluginCanvas {
    scope.assertActive();
    if (!canvas) throw new PluginError("PLUGIN_PROJECT_CHANGED");
    if (binding?.projectId && binding.projectId !== canvas.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
    if (binding) bindCanvasScope(binding, canvas.signal);
    const signal = AbortSignal.any([scope.signal, canvas.signal, ...(binding ? [binding.signal] : [])]);
    const target = bindCanvasScope(Object.freeze({ ...(binding ?? canvasBinding(canvas)), signal }), canvas.signal);
    const assertCurrent = () => {
        scope.assertActive();
        if (canvas !== currentCanvas || signal.aborted) throw new PluginError("PLUGIN_PROJECT_CHANGED");
    };
    const assertReadable = () => { scope.assertActive(); signal.throwIfAborted(); };
    const bound: PluginCanvas = {
        projectId: canvas.projectId,
        signal,
        scope: target,
        on: (event, handler) => listen(scope, source.id ?? "builtin", event, ((payload: PluginCanvasEvents[typeof event]) => { if (!signal.aborted && payload.projectId === canvas.projectId) return handler(payload); }) as Handler, signal),
        getSnapshot: () => { assertReadable(); return canvas.getSnapshot(); },
        subscribe: listener => {
            assertReadable();
            const unsubscribe = canvas.subscribe(() => { if (!signal.aborted) listener(); });
            const release = scope.add(unsubscribe);
            const close = () => { signal.removeEventListener("abort", close); unsubscribe(); void release(); };
            signal.addEventListener("abort", close, { once: true });
            return close;
        },
        getNodes: () => { assertReadable(); return canvas.getSnapshot().nodes; },
        getConnections: () => { assertReadable(); return canvas.getSnapshot().connections; },
        getSelectedIds: () => { assertReadable(); return canvas.getSnapshot().selection.nodeIds; },
        transact: async (ops, options) => {
            const { signal: operation, ...transaction } = options ?? {};
            const check = () => {
                assertCurrent();
                if (operation?.aborted) throw operation.reason instanceof PluginError ? operation.reason : new PluginError("PLUGIN_SCOPE_CLOSED", { cause: operation.reason });
            };
            const commit = () => tracked(scope, async () => {
                check();
                const result = await currentCanvas!.transactWithMedia(ops, { ...structuredClone(transaction), source }, check);
                check();
                return result;
            });
            try { return await (producer ? pluginRegistry.track(producer, commit) : commit()); }
            catch (error) {
                check();
                throw error instanceof PluginError ? error : new PluginError("PLUGIN_OPERATION_FAILED", { cause: error });
            }
        },
        undo: () => { assertCurrent(); return canvas.undo(source); },
        redo: () => { assertCurrent(); return canvas.redo(source); },
        setSelection: selection => { assertCurrent(); canvas.setSelection(selection, source); },
        setViewport: viewport => { assertCurrent(); canvas.setViewport(viewport, source); },
        flush: () => tracked(scope, async () => { assertCurrent(); await canvas.flush(); assertCurrent(); }),
        models: pluginRegistry.getCapability<ModelsCapability>(models, target, scope, source.id ?? "builtin")!,
    };
    if (producer?.pluginId === "builtin") hostTransactions.set(bound, (ops, options) => { assertCurrent(); return canvas.transact(ops, { ...options, source }); });
    return bound;
}

export function setPluginStatus(id: string, status: PluginRuntimeStatus, error?: PluginErrorCode) {
    const panel = usePluginStore.getState().panel;
    if (panel?.entry.pluginId === id && status !== "active") panel.close();
    usePluginStore.setState((state) => ({ states: { ...state.states, [id]: { status, error } }, revision: state.revision + 1 }));
}

export async function deactivatePlugin(id: string) {
    const instance = instances.get(id);
    if (!instance) { setPluginStatus(id, "disabled"); return; }
    if (!instance.stopping) {
        instance.stopping = Promise.resolve().then(async () => {
            await instance.starting?.catch(() => {});
            const errors: unknown[] = [];
            try { await instance.lateCleanup?.(); } catch (error) { errors.push(error); }
            try { await instance.scope.close(); } catch (error) { errors.push(error); }
            if (errors.length) console.error(`[plugins] ${id} cleanup failed`, errors);
            if (instances.get(id) === instance) instances.delete(id);
        });
        instance.registrations.dispose();
        setPluginStatus(id, "disabled");
        instance.scope.cancel();
    }
    await instance.stopping;
}

function createPluginInstance(pkg: PluginPackage, scope: PluginScope, registry = pluginRegistry, owner?: Instance, binding = workspaceBinding, existing?: RegistryInstance): Instance {
    const id = pkg.infiniteCanvas.id;
    const source: CanvasChangeSource = id === "builtin" ? { kind: "ui" } : { kind: "plugin", id };
    const registrations = existing ?? owner?.registrations ?? registry.createInstance({ id, scope });
    const assertEnabled = () => {
        scope.assertActive();
        if (instances.get(id) !== (owner ?? instance)) throw new PluginError("PLUGIN_INACTIVE");
    };
    const contextBinding = Object.freeze({ ...binding, signal: scope.signal });
    capabilityCallers.set(scope.signal, { pluginId: id, packageName: pkg.name, scope: contextBinding, track: scope.track.bind(scope), assertActive: assertEnabled });
    if (binding.projectId !== undefined) bindCanvasScope(contextBinding, canvasScopeRoots.get(binding.signal) ?? (currentCanvas?.projectId === binding.projectId ? currentCanvas.signal : binding.signal));
    const commandSession = (command: PluginCommand["command"], target: ScopeBinding) => {
        assertEnabled();
        if (command.scope === "project" || command.scope === "view" && target.projectId) return resolveCanvasScope(target, contextBinding);
    };
    const ctx: PluginContext = {
        id,
        signal: scope.signal,
        scope: contextBinding,
        get models() { assertEnabled(); return pluginRegistry.getCapability<ModelsCapability>(models, contextBinding, scope, id)!; },
        commands: {
            execute: (command, input, options) => {
                try { return executeCommand(command, input, { ...options, session: commandSession(command, options.scope), owner: scope, source }); }
                catch (error) { return Promise.reject(error); }
            },
            canExecute: (command, input, options) => {
                try { return canExecuteCommand(command, input, { ...options, session: commandSession(command, options.scope), owner: scope, source }); }
                catch { return false; }
            },
        },
        extensions: {
            define: (point) => { assertEnabled(); return registrations.extensions.define(point); },
            contribute: (point, contribution) => { assertEnabled(); validateContribution(point, contribution); return registrations.extensions.contribute(point, contribution); },
            query: (point, binding) => { assertEnabled(); return registrations.extensions.query(point, binding); },
            subscribe: (point, binding, listener) => { assertEnabled(); return scope.add(registrations.extensions.subscribe(point, binding, listener)); },
            track: (entry, action) => { assertEnabled(); return tracked(scope, () => registrations.extensions.track(entry, action)); },
        },
        capabilities: {
            get: (contract, binding) => {
                assertEnabled();
                if (contract.id === canvasSession.id) resolveCanvasScope(binding, contextBinding);
                return registrations.getCapability(contract, binding, scope);
            },
        },
        files: {
            read: async (key) => tracked(scope, () => { assertEnabled(); return storage.pluginFiles(id).getItem<Blob>(key); }),
            write: async (key, file) => tracked(scope, async () => { assertEnabled(); await storage.pluginFiles(id).setItem(key, file); }),
            remove: async (key) => tracked(scope, () => { assertEnabled(); return storage.pluginFiles(id).removeItem(key); }),
        },
        images: {
            async store(file, signal) {
                const active = AbortSignal.any([scope.signal, signal]);
                return tracked(scope, async () => {
                    assertEnabled();
                    const { uploadImage } = await import("@workbench/services/image-storage");
                    assertEnabled();
                    const image = await uploadImage(file, { signal: active });
                    active.throwIfAborted();
                    return image;
                });
            },
            read: async (key, url, signal) => tracked(scope, async () => {
                assertEnabled();
                const { readImageBlob } = await import("@workbench/services/image-storage");
                assertEnabled();
                return readImageBlob(key, url, { signal: AbortSignal.any([signal, scope.signal]) });
            }),
            preview: async (key) => tracked(scope, async () => {
                assertEnabled();
                const { readImagePreview } = await import("@workbench/services/image-storage");
                assertEnabled();
                return readImagePreview(key);
            }),
        },
        media: {
            read: async (key, url, signal) => tracked(scope, async () => {
                assertEnabled();
                const { readMediaBlob } = await import("@workbench/services/file-storage");
                assertEnabled();
                return readMediaBlob(key, url, { signal: AbortSignal.any([scope.signal, signal]) });
            }),
        },
        projectData: createProjectData(id, pkg.name, contextBinding, () => {
            assertEnabled();
            return resolveCanvasScope(contextBinding, contextBinding).projectId;
        }, (action) => tracked(scope, action)),
        works: createPluginWorks(id, pkg.name, contextBinding, assertEnabled, (action) => tracked(scope, action)),
        layout: {
            select: (layoutId) => {
                assertEnabled();
                if (layoutId !== null && !pluginRegistry.getSnapshot(layouts).some((entry) => entry.id === layoutId)) throw new PluginError("PLUGIN_INVALID");
                usePluginStore.setState((state) => ({ revision: state.revision + 1, layoutSelection: layoutId }));
            },
        },
        appearance: {
            select: (themeId) => {
                assertEnabled();
                if (themeId !== null && !pluginRegistry.getSnapshot(themes).some((entry) => entry.id === themeId)) throw new PluginError("PLUGIN_INVALID");
                useThemeStore.setState({ selection: themeId });
            },
            getSnapshot: () => { scope.assertActive(); return readonlySnapshot(useThemeStore.getState().appearance); },
            subscribe: (listener) => {
                scope.assertActive();
                let lastAppearance = useThemeStore.getState().appearance;
                const unsubscribe = useThemeStore.subscribe(() => {
                    const appearance = useThemeStore.getState().appearance;
                    if (scope.signal.aborted || appearance === lastAppearance) return;
                    lastAppearance = appearance;
                    try { listener(); }
                    catch (error) { console.error(`[plugins] ${id} appearance subscriber failed`, error); }
                });
                const stop = () => { unsubscribe(); scope.signal.removeEventListener("abort", stop); };
                scope.signal.addEventListener("abort", stop, { once: true });
                const release = scope.add(stop);
                return () => { stop(); void release(); };
            },
        },
        storage: {
            get: async <T>(key: string) => tracked(scope, () => storage.pluginData(id).getItem<T>(assertPluginStorageKey(key))),
            set: async (key, value) => tracked(scope, async () => { await storage.pluginData(id).setItem(assertPluginStorageKey(key), value); }),
            remove: async (key) => tracked(scope, () => storage.pluginData(id).removeItem(assertPluginStorageKey(key))),
        },
        canvas: () => {
            assertEnabled();
            if (contextBinding.kind === "view" && contextBinding.projectId === undefined) throw new PluginError("PLUGIN_PROJECT_CHANGED");
            if (contextBinding.projectId === undefined) return canvasFor(scope, source);
            return canvasFor(scope, source, resolveCanvasScope(contextBinding, contextBinding), contextBinding);
        },
        onDispose: scope.add.bind(scope),
        on: (event, handler) => { assertEnabled(); if (event.startsWith("plugin:")) throw new PluginError("PLUGIN_INVALID"); return listen(scope, id, event, handler as Handler); },
        emit: (event, payload) => { scope.assertActive(); if (event !== "settings.changed") assertEnabled(); dispatch(`plugin:${id}:${event}`, payload); },
        onMessage: (event, handler) => { assertEnabled(); return listen(scope, id, `plugin:${id}:${event}`, handler); },
    };
    // React 会遍历旧视图的属性。仅在插件显式访问 models 时解析仍有效的模型能力。
    Object.defineProperty(ctx, "models", { enumerable: false });
    const instance: Instance = { pkg, scope, ctx, registrations };
    contextScopes.set(ctx, { owner: owner ?? instance, scope });
    return instance;
}

async function importPlugin(pkg: PluginPackage, source: string | InstalledPlugin, scope: PluginScope) {
    scope.assertActive();
    const id = pkg.infiniteCanvas.id;
    (globalThis as unknown as { InfiniteCanvasRuntime: unknown }).InfiniteCanvasRuntime = { React, reactDom, jsxRuntime, jsxDevRuntime, radix };
    const url = typeof source === "string" ? URL.createObjectURL(new Blob([source], { type: "text/javascript" })) : await openClientFiles(source, scope);
    let plugin: CanvasPlugin;
    try { plugin = (await import(/* @vite-ignore */ url)).default; }
    finally { if (typeof source === "string") URL.revokeObjectURL(url); }
    scope.assertActive();
    if (!plugin || typeof plugin !== "object") throw new PluginError("PLUGIN_INVALID");
    if (Object.keys(plugin).some((key) => !["extensionPoints", "contributions", "setup", "css"].includes(key))) throw new PluginError("PLUGIN_INVALID");
    if (plugin.css) {
        const style = document.createElement("style");
        style.dataset.canvasPlugin = id;
        style.textContent = plugin.css;
        document.head.appendChild(style);
        scope.add(() => style.remove());
    }
    return plugin;
}

export async function activatePlugin(pkg: PluginPackage, source?: string | InstalledPlugin, signal?: AbortSignal) {
    const id = pkg.infiniteCanvas.id;
    while (instances.has(id)) await deactivatePlugin(id);
    signal?.throwIfAborted();
    const scope = new PluginScope();
    const instance = createPluginInstance(pkg, scope);
    setPluginStatus(id, "starting");
    instances.set(id, instance);
    const stop = () => { void deactivatePlugin(id); };
    signal?.addEventListener("abort", stop, { once: true });
    scope.add(() => signal?.removeEventListener("abort", stop));
    instance.starting = (async () => {
        const plugin = source === undefined ? {} : await importPlugin(pkg, source, scope);
        for (const contribution of plugin.contributions ?? []) validateContribution(contribution.point, contribution);
        instance.registrations.register(plugin);
        const cleanup = await plugin.setup?.(instance.ctx);
        if (cleanup) {
            if (scope.signal.aborted) instance.lateCleanup = cleanup;
            else scope.add(cleanup);
        }
        scope.assertActive();
        setPluginStatus(id, "active");
    })();
    try { await instance.starting; }
    catch (error) {
        if (scope.signal.aborted) throw new PluginError("PLUGIN_INACTIVE", { cause: error });
        await deactivatePlugin(id);
        setPluginStatus(id, "failed", "PLUGIN_LOAD_FAILED");
        console.error(`[plugins] ${id} activation failed`, error);
        throw new PluginError("PLUGIN_LOAD_FAILED", { cause: error });
    }
}

function bindPluginContext(instance: Instance, key: object, binding: ScopeBinding, contribution?: { signal: AbortSignal; point: string; id: string }, viewScope?: PluginScope) {
    binding.signal.throwIfAborted();
    let ctx = boundContexts.get(key);
    if (!ctx) {
        const scope = new PluginScope();
        viewScope?.add(() => scope.close());
        const signal = AbortSignal.any([instance.scope.signal, binding.signal, ...(contribution ? [contribution.signal] : [])]);
        const release = instance.scope.add(() => scope.close());
        const label = contribution ? `${contribution.point}/${contribution.id}` : "canvas";
        const close = () => { scope.cancel(); void release().catch((error) => console.error(`[plugins] ${instance.ctx.id} ${label} view cleanup`, error)); };
        signal.addEventListener("abort", close, { once: true });
        scope.add(() => signal.removeEventListener("abort", close));
        ctx = createPluginInstance(instance.pkg, scope, pluginRegistry, instance, binding).ctx;
        boundContexts.set(key, ctx);
    }
    return ctx;
}

export function getPluginContributions<T>(point: ExtensionPoint<T>, binding?: ScopeBinding, viewScope?: PluginScope) {
    if (binding?.signal.aborted) return [];
    const entries = binding ? pluginRegistry.query(point, binding) : pluginRegistry.getSnapshot(point);
    return entries.flatMap((entry) => {
        const instance = instances.get(entry.pluginId);
        if (!instance || instance.scope.signal.aborted) return [];
        if (!binding) return [{ ctx: instance.ctx, item: entry.value, entry }];
        const ctx = bindPluginContext(instance, entry, binding, entry, viewScope);
        return [{ ctx, item: entry.value, entry }];
    });
}

export function getPluginPackageName(id: string) {
    const instance = instances.get(id);
    if (!instance) throw new PluginError("PLUGIN_INACTIVE");
    return instance.pkg.name;
}

export function getPluginContext(id: string) {
    const instance = instances.get(id);
    return instance && !instance.scope.signal.aborted ? instance.ctx : undefined;
}

export function getPluginNodeContext(type: string, canvas: CanvasSession, binding: ScopeBinding = canvasBinding(canvas)) {
    if (binding.projectId !== canvas.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
    binding.signal.throwIfAborted();
    bindCanvasScope(binding, canvas.signal);
    const entry = getPluginContributions(nodes, binding).find(({ item }) => item.type === type);
    const ctx = entry?.ctx ?? bindPluginContext(instances.get("builtin")!, binding, binding);
    const context = contextScopes.get(ctx)!;
    return { ctx, canvas: canvasFor(context.scope, ctx.id === "builtin" ? { kind: "ui" } : { kind: "plugin", id: ctx.id }, canvas, binding) };
}

function capabilityCanvas(context: CapabilityCallContext) {
    const caller = capabilityCallers.get(context.callerSignal);
    if (!caller || caller.pluginId !== context.callerId) throw new PluginError("PLUGIN_INACTIVE");
    caller.assertActive();
    return resolveCanvasScope(context.scope, caller.scope, context.bindingSignal);
}

const canvasMethods: CanvasSessionCapability = {
    snapshot: (_, context) => capabilityCanvas(context).getSnapshot(),
    transact: ({ ops, ...options }, context) => {
        const session = capabilityCanvas(context);
        return session.transactWithMedia(ops, { ...options, source: { kind: "plugin", id: context.callerId } }, () => {
            capabilityCanvas(context);
        });
    },
    undo: (_, context) => capabilityCanvas(context).undo({ kind: "plugin", id: context.callerId }),
    redo: (_, context) => capabilityCanvas(context).redo({ kind: "plugin", id: context.callerId }),
    select: (selection, context) => capabilityCanvas(context).setSelection(selection, { kind: "plugin", id: context.callerId }),
    viewport: (viewport, context) => capabilityCanvas(context).setViewport(viewport, { kind: "plugin", id: context.callerId }),
    flush: (_, context) => capabilityCanvas(context).flush(),
};
builtinPlugin.capabilities.provide(models, workspaceModelMethods);
builtinPlugin.capabilities.provide(tasks, workspaceTaskMethods);
builtinPlugin.capabilities.provide(resources, resourceMethods);
builtinPlugin.capabilities.provide(canvasSession, canvasMethods);
const canvasCommands: PluginCommand<any, any>[] = [
    { command: canvasApply, title: "修改画布", run: ({ ops, ...options }, { canvas }) => canvas!.transact(ops, options) },
    { command: canvasUndo, title: "撤销", enabled: (_, { canvas }) => canvas!.getSnapshot().canUndo, run: (_, { canvas }) => canvas!.undo() },
    { command: canvasRedo, title: "重做", enabled: (_, { canvas }) => canvas!.getSnapshot().canRedo, run: (_, { canvas }) => canvas!.redo() },
    { command: canvasSelect, title: "选择内容", run: (selection, { canvas }) => { canvas!.setSelection(selection); return canvas!.getSnapshot(); } },
    { command: canvasViewport, title: "移动视图", run: (viewport, { canvas }) => { canvas!.setViewport(viewport); return canvas!.getSnapshot(); } },
];
for (const value of canvasCommands) builtinPlugin.extensions.contribute(commands, { id: value.command.id, value });
instances.set("builtin", createPluginInstance({ name: "builtin", version: "1.0.0", infiniteCanvas: { id: "builtin", name: "内置功能", client: "client.js" } }, builtinPlugin.scope, pluginRegistry, undefined, workspaceBinding, builtinPlugin));
initializeThemes();
initializeCallScripts();
