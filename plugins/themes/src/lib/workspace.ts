import type { PluginContext, PluginNavigationEntry, PluginNavigationItem } from "@infinite-canvas/plugin-sdk";
import { navigation } from "@infinite-canvas/plugin-sdk/builtin";
import { workspaceNavigation } from "../navigation/workspace";

export type Workspace = { hidden: string[]; order: string[] };
export const standard: Workspace = { hidden: [], order: [] };
let current = standard;
let releaseNavigation: (() => void) | undefined;
const listeners = new Set<() => void>();
export const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
export const snapshot = () => current;
/** 导航变换最近收到的可见入口，供导航设置页列出；其他来源已隐藏的入口不列出。 */
export let entries: readonly PluginNavigationEntry[] = [];
export const rememberEntries = (items: readonly PluginNavigationItem[]) => { entries = items.filter((item) => !item.hidden).map(({ id, title }) => ({ id, title })); };

function applyWorkspace(ctx: PluginContext, workspace: Workspace) {
    ctx.signal.throwIfAborted();
    const next = structuredClone(workspace);
    releaseNavigation?.();
    releaseNavigation = ctx.extensions.contribute(navigation, { id: "themes:navigation", value: workspaceNavigation(next.hidden, next.order) });
    current = next;
    for (const listener of listeners) listener();
}

export async function loadWorkspace(ctx: PluginContext) {
    applyWorkspace(ctx, await ctx.storage.get<Workspace>("workspace") ?? standard);
}

export async function saveWorkspace(ctx: PluginContext, workspace: Workspace) {
    await ctx.storage.set("workspace", workspace);
    applyWorkspace(ctx, workspace);
}
