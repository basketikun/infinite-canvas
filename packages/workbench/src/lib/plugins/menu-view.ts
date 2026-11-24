import type { PluginMenu, PluginMenuItem, PluginMenuTarget } from "@infinite-canvas/plugin-sdk";
import { menus } from "@infinite-canvas/plugin-sdk/builtin";
import { assertBinding, type RegisteredContribution, type ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { PluginScope } from "@infinite-canvas/plugin-sdk/scope";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { getPluginContributions } from "./runtime";

export type MenuViewOwner = {
    entry: RegisteredContribution<PluginMenu>;
    Content: Extract<PluginMenuItem, { type: "content" }>["Content"];
    binding: ScopeBinding;
    location: PluginMenuTarget["location"];
    previous?: MenuViewOwner;
    assertActive: () => void;
};

const owners = new WeakMap<RegisteredContribution<PluginMenu>, Map<string, MenuViewOwner>>();

export function getMenuViewOwner(entry: MenuViewOwner["entry"], id: string, Content: MenuViewOwner["Content"], binding: ScopeBinding, location: PluginMenuTarget["location"], previous?: MenuViewOwner): MenuViewOwner {
    let entries = owners.get(entry);
    if (!entries) owners.set(entry, entries = new Map());
    const key = `${location}:${id}`;
    const cached = entries.get(key);
    if (cached?.Content === Content && cached.previous === previous) return cached;
    const owner: MenuViewOwner = {
        entry, Content, binding, location, previous,
        assertActive: () => {
            assertBinding(binding, "project");
            entry.assertActive();
            previous?.assertActive();
        },
    };
    entries.set(key, owner);
    return owner;
}

export function createMenuView(owner: MenuViewOwner, parentBinding: ScopeBinding, viewId: string) {
    owner.assertActive();
    assertBinding(parentBinding, "project");
    if (parentBinding.workspaceId !== owner.binding.workspaceId || parentBinding.projectId !== owner.binding.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
    const scope = new PluginScope();
    const signals = new Set([parentBinding.signal]);
    for (let current: MenuViewOwner | undefined = owner; current; current = current.previous) {
        signals.add(current.binding.signal);
        signals.add(current.entry.signal);
    }
    const close = () => {
        scope.cancel();
        void scope.close().catch((error) => console.error(`[plugins] ${owner.entry.pluginId} ${owner.entry.point}/${owner.entry.id} menu view cleanup failed`, error));
    };
    const release = () => {
        for (const signal of signals) signal.removeEventListener("abort", close);
        scope.signal.removeEventListener("abort", release);
    };
    scope.signal.addEventListener("abort", release, { once: true });
    scope.add(release);
    for (const signal of signals) signal.addEventListener("abort", close, { once: true });
    try {
        if ([...signals].some((signal) => signal.aborted)) throw new PluginError("PLUGIN_SCOPE_CLOSED");
        const binding: ScopeBinding = Object.freeze({ ...parentBinding, kind: "view", viewId, signal: scope.signal });
        const contribution = getPluginContributions(menus, binding, scope).find(({ entry }) => entry.id === owner.entry.id && entry.instanceId === owner.entry.instanceId);
        owner.assertActive();
        if (!contribution) throw new PluginError("PLUGIN_INACTIVE");
        return { scope, ctx: contribution.ctx, canvas: contribution.ctx.canvas() };
    } catch (error) {
        close();
        throw error;
    }
}
