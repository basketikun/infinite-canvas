import type { PluginCanvas, PluginContext, PluginMenuItem, PluginMenuTarget } from "@infinite-canvas/plugin-sdk";
import { readonlySnapshot } from "@infinite-canvas/plugin-sdk/readonly-snapshot";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { commands as commandPoint, menus, panels, pluginMenuItemSchema } from "@infinite-canvas/plugin-sdk/builtin";
import { z } from "zod";
import { canvasFor, getPluginContributions, pluginProjectBinding, runPluginCallback } from "@workbench/lib/plugins/runtime";
import { builtinPlugin, pluginRegistry } from "@workbench/lib/plugins/registry";
import { usePluginStore } from "@workbench/stores/use-plugin-store";
import { getMenuViewOwner, type MenuViewOwner } from "./menu-view";

const menuItemsSchema = z.array(pluginMenuItemSchema);

function runMenuAction(ctx: PluginContext, canvas: PluginCanvas, id: string, action: () => unknown, assertActive: () => void) {
    const assert = () => { canvas.signal.throwIfAborted(); assertActive(); };
    assert();
    return runPluginCallback(ctx, id, "run", () => {
        const result = action();
        if (result && typeof (result as Promise<unknown>).then === "function") {
            return Promise.resolve(result).then((value) => { assert(); return value; });
        }
        assert();
        return result;
    });
}

export function resolvePluginMenu(target: PluginMenuTarget, defaults: readonly PluginMenuItem[], binding: ScopeBinding | null = pluginProjectBinding) {
    if (defaults.some((item) => item.type === "content")) throw new PluginError("PLUGIN_CONTRACT_MISMATCH");
    const selectedIds = target.location === "canvas.selectionToolbar" ? [...target.nodeIds] : null;
    const selectionCanvas = selectedIds && binding && !binding.signal.aborted ? canvasFor(builtinPlugin.scope, { kind: "ui" }, undefined, binding) : null;
    const assertTargetActive = () => {
        if (!selectionCanvas) return;
        const current = selectionCanvas.getSelectedIds();
        if (current.length !== selectedIds!.length || selectedIds!.some((id) => !current.includes(id))) throw new PluginError("PLUGIN_INACTIVE");
    };
    let items = [...defaults];
    let contentOwners = new Map<PluginMenuItem, MenuViewOwner>();
    const extensions = binding ? getPluginContributions(menus, binding) : [];
    for (const { ctx, item, entry } of extensions) {
        if (!item.locations.includes(target.location)) continue;
        try {
            const canvas = ctx.canvas();
            const props = { ctx, canvas, target: readonlySnapshot(target) };
            const label = `${entry.point}/${entry.id}`;
            const output = runPluginCallback(ctx, label, "transform", () => pluginRegistry.track(entry, () => item.transform({ ...props, items: Object.freeze(items.map((value) => Object.freeze({ ...value }))) })));
            if (output && typeof (output as unknown as Promise<unknown>).then === "function") {
                void Promise.resolve(output).catch((error) => console.error(`[plugins] ${entry.pluginId} ${label} async transform failed`, error));
                throw new PluginError("PLUGIN_CONTRACT_MISMATCH");
            }
            const next = menuItemsSchema.parse(output);
            if (new Set(next.map((value) => value.id)).size !== next.length) throw new PluginError("PLUGIN_CONTRACT_MISMATCH");
            const previous = new Map(items.map((value) => [value.id, value]));
            const nextOwners = new Map<PluginMenuItem, MenuViewOwner>();
            const nextItems = next.map((value) => {
                if (value.type === "content") {
                    const prior = previous.get(value.id);
                    const priorOwner = prior && contentOwners.get(prior);
                    const owner = prior?.type === "content" && prior.Content === value.Content && priorOwner
                        ? priorOwner
                        : getMenuViewOwner(entry, value.id, value.Content, binding!, target.location, priorOwner);
                    nextOwners.set(value, owner);
                    return Object.freeze(value);
                }
                if (value.type === "separator") return Object.freeze(value);
                return Object.freeze({
                    ...value,
                    run: () => runMenuAction(ctx, canvas, `${label}/${value.id}`, () => pluginRegistry.track(entry, value.run), entry.assertActive),
                });
            });
            items = nextItems;
            contentOwners = nextOwners;
        } catch (error) {
            console.error(`[plugins] ${entry.pluginId} ${entry.point}/${entry.id} transform failed`, error);
        }
    }
    const visible: PluginMenuItem[] = [];
    for (const item of items) {
        if (item.hidden || (item.type === "separator" && (!visible.length || visible.at(-1)?.type === "separator"))) continue;
        visible.push(item);
    }
    if (visible.at(-1)?.type === "separator") visible.pop();
    return {
        items: selectionCanvas ? visible.map((item) => item.type !== "action" ? item : {
            ...item,
            run: () => {
                assertTargetActive();
                return item.run();
            },
        }) : visible,
        contentOwners: contentOwners as ReadonlyMap<PluginMenuItem, MenuViewOwner>,
        assertTargetActive,
    };
}

builtinPlugin.extensions.contribute(menus, {
    id: "builtin:canvas-command-menus",
    value: {
        id: "builtin:canvas-command-menus",
        locations: ["canvas.nodeContext", "canvas.toolbar", "canvas.extensions"],
        transform: ({ ctx: menuContext, target, items }) => {
            if (target.location !== "canvas.nodeContext" && target.location !== "canvas.extensions" && target.location !== "canvas.toolbar") return items;
            const location = target.location === "canvas.nodeContext" ? "canvas.contextMenu" : target.location;
            const actions: PluginMenuItem[] = [];
            for (const { ctx, item, entry } of getPluginContributions(commandPoint, menuContext.scope)) {
                if (!item.locations?.includes(location)) continue;
                try {
                    const canvas = ctx.canvas();
                    actions.push({
                        id: entry.id,
                        type: "action",
                        title: item.title,
                        showLabel: true,
                        disabled: !ctx.commands.canExecute(item.command, undefined, { scope: canvas.scope }),
                        run: () => runMenuAction(ctx, canvas, `${entry.point}/${entry.id}`, () => ctx.commands.execute(item.command, undefined, { scope: canvas.scope, signal: canvas.signal }), entry.assertActive),
                    });
                } catch (error) {
                    console.error(`[plugins] ${entry.pluginId} ${entry.point}/${entry.id} unavailable`, error);
                }
            }
            if (target.location === "canvas.extensions") {
                const project = pluginProjectBinding;
                const sources = pluginRegistry.getSnapshot(panels);
                for (const { ctx, item, entry } of getPluginContributions(panels, menuContext.scope)) {
                    try {
                        const canvas = ctx.canvas();
                        const source = sources.find((candidate) => candidate.id === entry.id);
                        if (!project || project.projectId !== canvas.projectId || !source) continue;
                        actions.push({
                            id: `panel:${entry.id}`,
                            type: "action",
                            title: item.title,
                            showLabel: true,
                            active: usePluginStore.getState().panel?.entry === source,
                            run: () => runMenuAction(ctx, canvas, `${entry.point}/${entry.id}`, () => {
                                if (pluginProjectBinding !== project) throw new PluginError("PLUGIN_PROJECT_CHANGED");
                                usePluginStore.getState().openPanel(source, project);
                            }, entry.assertActive),
                        });
                    } catch (error) {
                        console.error(`[plugins] ${entry.pluginId} ${entry.point}/${entry.id} unavailable`, error);
                    }
                }
            }
            const result = [...items];
            const anchor = target.location === "canvas.toolbar" ? "builtin:create:separator" : "builtin:delete";
            const index = result.findIndex((item) => item.id === anchor);
            result.splice(index < 0 ? result.length : index, 0, ...actions);
            return result;
        },
    },
});
