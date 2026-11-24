import { canvasNeighbors, canvasNodeIndex } from "./graph-index";
import { create } from "zustand";
import { PluginError } from "@infinite-canvas/shared/plugins";

import type { CanvasNodeContext, CanvasNodeDefinition, CanvasNodeToolbarItem, ReadonlyCanvasNode } from "@infinite-canvas/plugin-sdk";
import { readonlySnapshot } from "@infinite-canvas/plugin-sdk/readonly-snapshot";
import { canvasApply, nodes, nodeAppearanceSchema, nodeResources, nodeResourceSchema, nodeTools, resolvedNodeToolSchema } from "@infinite-canvas/plugin-sdk/builtin";
import type { RegisteredContribution, ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { capabilityCallers } from "@workbench/lib/plugins/capability-caller";
import { builtinPlugin, pluginRegistry } from "@workbench/lib/plugins/registry";
import { bindCanvasScope, getPluginContext, getPluginContributions, pluginProjectBinding, runPluginCallback } from "@workbench/lib/plugins/runtime";

const definitions = new WeakMap<RegisteredContribution<CanvasNodeDefinition>, CanvasNodeDefinition>();

// Increment the registry version on registration or removal to update dependent UI such as creation menus.
export const useNodeRegistryVersion = create<{ version: number }>(() => ({ version: 0 }));
pluginRegistry.subscribeAll(() => useNodeRegistryVersion.setState((state) => ({ version: state.version + 1 })));

export function registerNodeDefinitions(defs: CanvasNodeDefinition[]) {
    const disposers = defs.map((value) => builtinPlugin.extensions.contribute(nodes, { id: `builtin:${value.type}`, value }));
    return () => { for (const dispose of disposers) dispose(); };
}

function definitionFor(entry: RegisteredContribution<CanvasNodeDefinition>): CanvasNodeDefinition {
    const cached = definitions.get(entry);
    if (cached) return cached;
    const def = entry.value;
    const context = getPluginContext(entry.pluginId);
    const { forceInteractive, keepAspectRatio, appearance, onDoubleClick } = def;
    const invoke = <T>(callback: string, action: () => T): T => {
        entry.assertActive();
        if (!context) throw new PluginError("PLUGIN_INACTIVE");
        return runPluginCallback(context, `${entry.point}/${entry.id}`, callback, () => {
            const result = action();
            if (result && typeof (result as Promise<unknown>).then === "function") return Promise.resolve(result).then((value) => { entry.assertActive(); return value; }) as T;
            entry.assertActive();
            return result;
        });
    };
    const definition = {
        ...def,
        defaultSize: { ...def.defaultSize },
        defaultMetadata: def.defaultMetadata && structuredClone(def.defaultMetadata),
        forceInteractive: forceInteractive && ((node) => invoke("forceInteractive", () => forceInteractive(readonlySnapshot(node)))),
        keepAspectRatio: keepAspectRatio && ((node) => invoke("keepAspectRatio", () => keepAspectRatio(readonlySnapshot(node)))),
        appearance: typeof appearance === "function" ? (node) => invoke("appearance", () => readonlySnapshot(nodeAppearanceSchema.parse(appearance(readonlySnapshot(node))))) : appearance,
        onDoubleClick: onDoubleClick && ((ctx) => invoke("onDoubleClick", () => {
            ctx.getNode(ctx.node.id);
            return onDoubleClick(ctx);
        })),
    } satisfies CanvasNodeDefinition;
    definitions.set(entry, definition);
    return definition;
}

export function getNodeDefinition(type: string) {
    const entry = pluginRegistry.getSnapshot(nodes).find((item) => item.value.type === type);
    return entry && definitionFor(entry);
}

export function readNodeResource(node: ReadonlyCanvasNode, mode: "render" | "execute" | "export" = "render", binding: ScopeBinding | null | undefined = pluginProjectBinding, slotId?: string) {
    if (!binding) {
        if (mode !== "render") throw new PluginError("PLUGIN_PROJECT_CHANGED");
        return null;
    }
    if (mode === "export") binding.signal.throwIfAborted();
    for (const { ctx, item, entry } of getPluginContributions(nodeResources, binding)) {
        try {
            const resource = pluginRegistry.track(entry, () => runPluginCallback(ctx, `${entry.point}/${entry.id}`, "resolve", () => {
                const result = item.resolve(readonlySnapshot(node), slotId);
                return result === null ? null : Object.freeze({ ...nodeResourceSchema.parse(result), signal: entry.signal, contributionId: entry.id });
            }));
            if (resource !== null) return resource;
        } catch (error) { if (mode !== "render") throw error; }
    }
    if (mode === "execute" && !getNodeDefinition(node.type)) throw new PluginError("PLUGIN_INACTIVE");
    return null;
}

export function resolveNodeTools(nodeContext: CanvasNodeContext): CanvasNodeToolbarItem[] {
    const tools: CanvasNodeToolbarItem[] = [];
    for (const { ctx, item, entry } of getPluginContributions(nodeTools, nodeContext.scope)) {
        try {
            const canvas = ctx.canvas();
            if (canvas.projectId !== nodeContext.scope.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
            const nodeId = nodeContext.node.id;
            const scope = bindCanvasScope(Object.freeze({ ...canvas.scope, signal: AbortSignal.any([nodeContext.scope.signal, canvas.scope.signal, entry.signal]) }), canvas.signal);
            const assertActive = () => { if (scope.signal.aborted) throw new PluginError("PLUGIN_INACTIVE"); };
            const transact: CanvasNodeContext["transact"] = async (ops, options) => {
                assertActive();
                const nodeOwner = capabilityCallers.get(nodeContext.scope.signal);
                if (!nodeOwner) throw new PluginError("PLUGIN_INACTIVE");
                const { signal, ...transaction } = options ?? {};
                return nodeOwner.track(() => pluginRegistry.track(entry, () => ctx.commands.execute(canvasApply, { ops, ...transaction }, { scope, signal })));
            };
            const context: CanvasNodeContext = Object.freeze({
                ...nodeContext, scope, commands: ctx.commands, images: ctx.images, media: ctx.media, models: canvas.models, storage: ctx.storage,
                getSnapshot: () => { assertActive(); return canvas.getSnapshot(); },
                subscribe: (listener) => {
                    assertActive();
                    const unsubscribe = canvas.subscribe(() => { if (!scope.signal.aborted) listener(); });
                    const close = () => { scope.signal.removeEventListener("abort", close); unsubscribe(); };
                    scope.signal.addEventListener("abort", close, { once: true });
                    return close;
                },
                getNode: (id: string) => { assertActive(); return canvasNodeIndex(canvas.getNodes()).get(id)?.node ?? null; },
                getNodes: () => { assertActive(); return canvas.getNodes(); },
                getConnections: () => { assertActive(); return canvas.getConnections(); },
                transact,
                getUpstream: () => { assertActive(); return canvasNeighbors(canvas.getSnapshot(), nodeId, "upstream", "node"); },
                getDownstream: () => { assertActive(); return canvasNeighbors(canvas.getSnapshot(), nodeId, "downstream", "node"); },
                updateMetadata: (metadata) => transact([{ type: "update_node", id: nodeId, metadata }]),
                updateNode: (patch) => transact([{ type: "update_node", id: nodeId, patch }]),
                openPanel: () => { assertActive(); nodeContext.openPanel(); },
                closePanel: () => { assertActive(); nodeContext.closePanel(); },
                setExpanded: (expanded) => { assertActive(); nodeContext.setExpanded(expanded); },
            });
            const resolved = pluginRegistry.track(entry, () => runPluginCallback(ctx, `${entry.point}/${entry.id}`, "resolve", () => {
                const action = item.resolve(context);
                return action === null ? null : resolvedNodeToolSchema.parse(action);
            }));
            if (!resolved) continue;
            tools.push({
                id: entry.id, title: resolved.title, label: resolved.label, icon: resolved.icon, active: resolved.active, danger: resolved.danger, defaultVisible: resolved.defaultVisible,
                disabled: resolved.disabled,
                onClick: () => pluginRegistry.track(entry, () => runPluginCallback(ctx, `${entry.point}/${entry.id}`, "execute", async () => {
                    if (!canvasNodeIndex(canvas.getNodes()).has(nodeId)) throw new PluginError("PLUGIN_NOT_FOUND");
                    await resolved.run();
                })),
            });
        } catch (error) {
            console.error(`[plugins] ${entry.pluginId} ${entry.point}/${entry.id} tools failed`, error);
        }
    }
    return tools;
}

export function getNodePluginId(type: string) {
    return pluginRegistry.getSnapshot(nodes).find((item) => item.value.type === type)?.pluginId ?? "builtin";
}

export function listNodeDefinitions() {
    return pluginRegistry.getSnapshot(nodes).map(definitionFor);
}

const FALLBACK_SPEC = { width: 340, height: 240, title: "节点", metadata: {} as CanvasNodeDefinition["defaultMetadata"] };

// Provide default size, title, and metadata shared by createCanvasNode and agent operations.
export function getNodeSpec(type: string) {
    const def = getNodeDefinition(type);
    if (!def) return FALLBACK_SPEC;
    return { width: def.defaultSize.width, height: def.defaultSize.height, title: def.title, metadata: def.defaultMetadata };
}

