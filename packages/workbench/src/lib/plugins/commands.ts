import type { CanvasChangeSource, CanvasSession, Command, CommandContext, PluginCommand } from "@infinite-canvas/plugin-sdk";
import { commands } from "@infinite-canvas/plugin-sdk/builtin";
import { assertBinding, type RegisteredContribution, type ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import type { PluginScope } from "@infinite-canvas/plugin-sdk/scope";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { builtinPlugin, pluginRegistry } from "./registry";
import { canvasFor } from "./runtime";

type CommandOptions = { scope: ScopeBinding; signal?: AbortSignal; session?: CanvasSession; source?: CanvasChangeSource; owner?: PluginScope };

function prepareCommand<I, O>(command: Command<I, O>, input: I, options: CommandOptions) {
    const owner = options.owner ?? builtinPlugin.scope;
    owner.assertActive();
    assertBinding(options.scope, command.scope);
    const entry = pluginRegistry.query(commands, options.scope).find(item => item.id === command.id) as RegisteredContribution<PluginCommand<I, O>> | undefined;
    if (!entry) throw new PluginError("PLUGIN_NOT_FOUND");
    if (entry.value.command.scope !== command.scope) throw new PluginError("PLUGIN_CONTRACT_MISMATCH");
    const expected = command.input.safeParse(input);
    if (!expected.success) throw new PluginError("PLUGIN_CONTRACT_MISMATCH", { cause: expected.error });
    const parsed = entry.value.command.input === command.input ? expected : entry.value.command.input.safeParse(input);
    if (!parsed.success) throw new PluginError("PLUGIN_CONTRACT_MISMATCH", { cause: parsed.error });
    const signal = AbortSignal.any([owner.signal, options.scope.signal, entry.signal, ...(options.signal ? [options.signal] : [])]);
    signal.throwIfAborted();
    const scope = Object.freeze({ ...options.scope, signal });
    const needsCanvas = command.scope === "project" || command.scope === "view" && scope.projectId;
    const context: CommandContext = { scope, signal, canvas: needsCanvas ? canvasFor(owner, options.source ?? { kind: "ui" }, options.session, scope, entry) : null };
    return { owner, entry, context, input: parsed.data };
}

export function canExecuteCommand<I, O>(command: Command<I, O>, input: I, options: CommandOptions) {
    try {
        const prepared = prepareCommand(command, input, options);
        const enabled = prepared.entry.value.enabled?.(prepared.input, prepared.context) ?? true;
        prepared.context.signal.throwIfAborted();
        prepared.entry.assertActive();
        return enabled;
    } catch (error) {
        if (!(error instanceof PluginError)) console.error("[plugins] command availability", command.id, error);
        return false;
    }
}

/** 入口同步捕获场景并提交同步事务，异步结果与取消继续绑定原场景。 */
export async function executeCommand<I, O>(command: Command<I, O>, input: I, options: CommandOptions): Promise<O> {
    let prepared: ReturnType<typeof prepareCommand<I, O>> | undefined;
    try {
        prepared = prepareCommand(command, input, options);
        const { owner, entry, context, input: validated } = prepared;
        return await owner.track(() => pluginRegistry.track(entry, async () => {
            if (entry.value.enabled && !entry.value.enabled(validated, context)) throw new PluginError("PLUGIN_INACTIVE");
            context.signal.throwIfAborted();
            const value = await entry.value.run(validated, context);
            context.signal.throwIfAborted();
            const actual = entry.value.command.output.safeParse(value);
            if (!actual.success) throw new PluginError("PLUGIN_CONTRACT_MISMATCH", { cause: actual.error });
            const expected = command.output === entry.value.command.output ? actual : command.output.safeParse(value);
            if (!expected.success) throw new PluginError("PLUGIN_CONTRACT_MISMATCH", { cause: expected.error });
            context.signal.throwIfAborted();
            entry.assertActive();
            return expected.data;
        }));
    } catch (error) {
        console.error("[plugins] command", prepared?.entry.pluginId, command.id, error);
        const signal = prepared?.context.signal ?? options.signal ?? options.scope.signal;
        if (signal.aborted) throw signal.reason instanceof PluginError ? signal.reason : new PluginError("PLUGIN_INACTIVE", { cause: error });
        throw error instanceof PluginError ? error : new PluginError("PLUGIN_OPERATION_FAILED", { cause: error });
    }
}
