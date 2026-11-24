import type { PluginNavigationEntry } from "@infinite-canvas/plugin-sdk";
import { navigation, navigationItemSchema } from "@infinite-canvas/plugin-sdk/builtin";
import { assertBinding, type ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { z } from "zod";
import { pluginRegistry } from "./registry";
import { getPluginContributions, runPluginCallback } from "./runtime";

const itemsSchema = z.array(navigationItemSchema);

export function resolveNavigation<T extends PluginNavigationEntry>(catalog: readonly T[], binding: ScopeBinding): readonly (T & { hidden?: boolean })[] {
    assertBinding(binding, "view");
    if (binding.projectId !== undefined) throw new PluginError("PLUGIN_CONTRACT_MISMATCH");
    let resolved: readonly (T & { hidden?: boolean })[] = Object.freeze(catalog.map((item) => Object.freeze({ ...item })));
    for (const { ctx, item, entry } of getPluginContributions(navigation, binding)) {
        const label = `${entry.point}/${entry.id}`;
        try {
            const items = Object.freeze(resolved.map(({ id, title, hidden }) => Object.freeze({ id, title, hidden })));
            const output = runPluginCallback(ctx, label, "transform", () => pluginRegistry.track(entry, () => item.transform({ ctx, items })));
            if (output && typeof (output as unknown as Promise<unknown>).then === "function") {
                void Promise.resolve(output).catch((error) => console.error(`[plugins] ${entry.pluginId} ${label} async transform failed`, error));
                throw new PluginError("PLUGIN_CONTRACT_MISMATCH");
            }
            const parsed = itemsSchema.safeParse(output);
            if (!parsed.success) throw new PluginError("PLUGIN_CONTRACT_MISMATCH", { cause: parsed.error });
            const previous = new Map(resolved.map((row) => [row.id, row]));
            const ids = new Set(parsed.data.map((row) => row.id));
            if (parsed.data.length !== previous.size || ids.size !== previous.size || [...ids].some((id) => !previous.has(id))) throw new PluginError("PLUGIN_CONTRACT_MISMATCH");
            entry.assertActive();
            resolved = Object.freeze(parsed.data.map(({ id, title, hidden }) => Object.freeze({ ...previous.get(id)!, title, hidden })));
        } catch (error) {
            console.error(`[plugins] ${entry.pluginId} ${label} transform failed`, error);
        }
    }
    return resolved;
}
