import type { PluginAppearance, PluginContext } from "@infinite-canvas/plugin-sdk";
import { themes } from "@infinite-canvas/plugin-sdk/builtin";
import { presets } from "./presets";

export let palettes: Record<string, PluginAppearance> = {};
const releases = new Map<string, () => void>();

function registerPalette(ctx: PluginContext, id: string, palette: PluginAppearance | null) {
    ctx.signal.throwIfAborted();
    const next = { ...palettes };
    if (palette) next[id] = palette;
    else delete next[id];
    palettes = next;
    releases.get(id)?.();
    releases.set(id, ctx.extensions.contribute(themes, { id, value: palette ?? presets.find((preset) => preset.id === id)! }));
}

export async function loadPalettes(ctx: PluginContext) {
    const saved = await Promise.all(presets.map(async ({ id }) => ({ id, palette: await ctx.storage.get<PluginAppearance>(`palette:${id}`) })));
    for (const { id, palette } of saved) registerPalette(ctx, id, palette);
}

export async function storePalette(ctx: PluginContext, id: string, palette: PluginAppearance | null) {
    if (palette) await ctx.storage.set(`palette:${id}`, palette);
    else await ctx.storage.remove(`palette:${id}`);
    registerPalette(ctx, id, palette);
}
