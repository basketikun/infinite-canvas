import { z } from "zod";
import type { PluginScopeKind } from "@infinite-canvas/shared/plugins";
import type { PluginCanvas } from "./types";
import type { ScopeBinding } from "./runtime/contracts";

export type Command<I, O> = Readonly<{ id: string; scope: PluginScopeKind; input: z.ZodType<I>; output: z.ZodType<O> }>;
export type CommandContext = { readonly scope: ScopeBinding; readonly signal: AbortSignal; readonly canvas: PluginCanvas | null };
export type PluginCommand<I = unknown, O = unknown> = {
    command: Command<I, O>;
    title: string;
    locations?: Array<"canvas.extensions" | "canvas.toolbar" | "canvas.contextMenu">;
    enabled?: (input: I, context: CommandContext) => boolean;
    run: (input: I, context: CommandContext) => O | Promise<O>;
};
export interface PluginCommands {
    execute<I, O>(command: Command<I, O>, input: I, options: { scope: ScopeBinding; signal?: AbortSignal }): Promise<O>;
    canExecute<I, O>(command: Command<I, O>, input: I, options: { scope: ScopeBinding }): boolean;
}

const schema = z.custom<z.ZodType>((value) => typeof value?.safeParse === "function");
export const commandSchema = z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*:[^:\s]+$/),
    scope: z.enum(["application", "workspace", "project", "view"]),
    input: schema,
    output: schema,
}).strict();

/** 公共契约不携带实现；消费者通过稳定 ID 调用已登记的命令。 */
export function defineCommand<I, O>(definition: Command<I, O>): Command<I, O> {
    return Object.freeze(commandSchema.parse(definition)) as Command<I, O>;
}
