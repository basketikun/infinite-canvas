import type { PluginContext } from "@infinite-canvas/plugin-sdk";
import { loadPalettes } from "./lib/palettes";
import { loadWorkspace } from "./lib/workspace";

export async function setup(ctx: PluginContext) {
    await Promise.all([loadPalettes(ctx), loadWorkspace(ctx)]);
}
