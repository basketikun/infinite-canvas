import type { PluginApplicationAction, PluginApplicationActions, PluginApplicationActionsTarget, PluginContext } from "@infinite-canvas/plugin-sdk";
import { applicationActions, applicationActionSchema } from "@infinite-canvas/plugin-sdk/builtin";
import { assertBinding, type RegisteredContribution, type ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { z } from "zod";
import { pluginRegistry } from "./registry";
import { getPluginContributions, runPluginCallback } from "./runtime";

type ResolvedApplicationAction = { item: PluginApplicationAction; ctx: PluginContext; entry: RegisteredContribution<PluginApplicationActions>; assertActive: () => void };
const actionsSchema = z.array(applicationActionSchema);

export function resolveApplicationActions(target: PluginApplicationActionsTarget, binding: ScopeBinding): ResolvedApplicationAction[] {
    assertBinding(binding, "view");
    if (binding.projectId !== undefined) throw new PluginError("PLUGIN_CONTRACT_MISMATCH");
    if (target.region === "canvas-leading" && (target.variant !== "canvas" || !target.canvasScope)) throw new PluginError("PLUGIN_CONTRACT_MISMATCH");
    const canvasScope = target.canvasScope && Object.freeze({ ...target.canvasScope });
    if (canvasScope) {
        if (target.variant !== "canvas" || canvasScope.workspaceId !== binding.workspaceId) throw new PluginError("PLUGIN_CONTRACT_MISMATCH");
        assertBinding(canvasScope, "project");
    }
    const targetSnapshot = Object.freeze({ ...target, ...(canvasScope ? { canvasScope } : {}) });
    let resolved: ResolvedApplicationAction[] = [];
    for (const { ctx, item, entry } of getPluginContributions(applicationActions, binding)) {
        const label = `${entry.point}/${entry.id}`;
        const assertOwner = () => { assertBinding(binding, "view"); if (canvasScope) assertBinding(canvasScope, "project"); entry.assertActive(); };
        try {
            const items = Object.freeze(resolved.map((row) => row.item));
            const output = runPluginCallback(ctx, label, "transform", () => pluginRegistry.track(entry, () => item.transform({ ctx, target: targetSnapshot, items })));
            if (output && typeof (output as unknown as Promise<unknown>).then === "function") {
                void Promise.resolve(output).catch((error) => console.error(`[plugins] ${entry.pluginId} ${label} async transform failed`, error));
                throw new PluginError("PLUGIN_CONTRACT_MISMATCH");
            }
            const next = actionsSchema.parse(output);
            if (new Set(next.map((action) => action.id)).size !== next.length) throw new PluginError("PLUGIN_CONTRACT_MISMATCH");
            const previous = new Map(resolved.map((row) => [row.item.id, row]));
            resolved = next.map((action): ResolvedApplicationAction => {
                const prior = previous.get(action.id);
                const unchanged = prior && (
                    action.type === "action" && prior.item.type === "action" && action.run === prior.item.run ||
                    action.type === "route" && prior.item.type === "route" && action.to === prior.item.to ||
                    action.type === "external" && prior.item.type === "external" && action.href === prior.item.href ||
                    action.type === "content" && prior.item.type === "content" && action.content === prior.item.content
                );
                if (unchanged) return { ...prior, item: Object.freeze(action) };
                const assertActive = () => { assertOwner(); prior?.assertActive(); };
                const result = action.type === "action" ? {
                    ...action,
                    run: () => runPluginCallback(ctx, `${label}/${action.id}`, "run", () => pluginRegistry.track(entry, () => {
                        assertActive();
                        const value = action.run();
                        if (value && typeof (value as Promise<unknown>).then === "function") return Promise.resolve(value).then((result) => { assertActive(); return result; }, (error) => { assertActive(); throw error; });
                        assertActive();
                        return value;
                    })),
                } : action;
                return { item: Object.freeze(result), ctx, entry, assertActive };
            });
        } catch (error) {
            console.error(`[plugins] ${entry.pluginId} ${label} transform failed`, error);
        }
    }
    return resolved.filter(({ item }) => !item.hidden);
}
