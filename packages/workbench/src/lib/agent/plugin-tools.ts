import { zodSchema } from "ai";
import { agentTools, commands } from "@infinite-canvas/plugin-sdk/builtin";
import { agentToolCallSchema, agentToolDescriptorSchema } from "@infinite-canvas/shared/canvas/tools/plugin-tools";
import { pluginJsonSchema } from "@infinite-canvas/shared/plugins";
import { pluginRegistry, workspaceBinding } from "@workbench/lib/plugins/registry";
import { getPluginContributions, pluginProjectBinding } from "@workbench/lib/plugins/runtime";
import { usePluginStore } from "@workbench/stores/use-plugin-store";

const catalogs = new WeakMap<object, WeakMap<object, { command: object; token: string }>>();

function agentBinding(projectId?: string) {
    if (!projectId) return workspaceBinding;
    if (!pluginProjectBinding || pluginProjectBinding.projectId !== projectId || pluginProjectBinding.signal.aborted) throw new Error("CANVAS_CHANGED");
    return pluginProjectBinding;
}

function available(binding: ReturnType<typeof agentBinding>) {
    let tokens = catalogs.get(binding);
    if (!tokens) { tokens = new WeakMap(); catalogs.set(binding, tokens); }
    const targets = pluginRegistry.query(commands, binding);
    return getPluginContributions(agentTools, binding).flatMap(({ ctx, entry, item }) => {
        if (item.command.scope === "project" && !binding.projectId) return [];
        const target = targets.find(row => row.id === item.command.id && row.value.command.scope === item.command.scope);
        if (!target) return [];
        let saved = tokens.get(entry);
        if (saved?.command !== target) {
            saved = { command: target, token: crypto.randomUUID() };
            tokens.set(entry, saved);
        }
        const name = (item.readOnly ? "plugin_read_" : "plugin_call_") + entry.id.replace(":", "_");
        const descriptor = agentToolDescriptorSchema.safeParse({
            name, description: item.description, binding: saved.token, readOnly: Boolean(item.readOnly),
            inputSchema: zodSchema(item.command.input).jsonSchema, outputSchema: zodSchema(item.command.output).jsonSchema,
        });
        if (!descriptor.success) return [];
        const execute = async (input: unknown, caller?: AbortSignal) => {
            const parsed = item.command.input.safeParse(input);
            if (!parsed.success) throw new Error("INVALID_ARGUMENTS");
            if (agentBinding(binding.projectId) !== binding) throw new Error("CANVAS_CHANGED");
            target.assertActive();
            const project = new AbortController();
            const unsubscribe = binding.projectId ? usePluginStore.subscribe(() => {
                if (pluginProjectBinding !== binding) project.abort(new Error("CANVAS_CHANGED"));
            }) : undefined;
            const signal = AbortSignal.any([entry.signal, target.signal, project.signal, ...(caller ? [caller] : [])]);
            try {
                return await pluginRegistry.track(entry, async () => {
                    const result = await ctx.commands.execute(item.command, input, { scope: ctx.scope, signal });
                    signal.throwIfAborted();
                    if (agentBinding(binding.projectId) !== binding) throw new Error("CANVAS_CHANGED");
                    return pluginJsonSchema.parse(result);
                });
            } finally { unsubscribe?.(); }
        };
        return [{ descriptor: descriptor.data, inputSchema: item.command.input, execute }];
    });
}

export async function discoverAgentTools(projectId?: string, signal?: AbortSignal) {
    const binding = agentBinding(projectId);
    signal?.throwIfAborted();
    signal?.throwIfAborted();
    if (agentBinding(projectId) !== binding) throw new Error("CANVAS_CHANGED");
    return available(binding);
}

export function callDiscoveredAgentTool(name: string, args: unknown, projectId?: string, signal?: AbortSignal) {
    const call = agentToolCallSchema.parse(args);
    const found = available(agentBinding(projectId)).find(row => row.descriptor.name === name && row.descriptor.binding === call.binding);
    if (!found) throw new Error("UNKNOWN_TOOL");
    return found.execute(call.input, signal);
}
