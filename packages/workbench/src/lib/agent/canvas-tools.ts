import { nanoid } from "nanoid";
import { tool, zodSchema, type ToolSet } from "ai";
import { useAgentStore } from "@workbench/stores/use-agent-store";
import { buildCanvasToolRequest } from "@infinite-canvas/shared/canvas/tools/operations";
import { compactCanvasState, readCanvasNodes, summarizeCanvasChanges, parseToolInput } from "@infinite-canvas/shared/canvas/tools/tools";
import { toolDescriptions, toolInputSchemas, toolNames, type ToolName } from "@infinite-canvas/shared/canvas/tools/schemas";
import { canvasToolError } from "@infinite-canvas/shared/canvas/tools/errors";
import type { CanvasAgentOp } from "@infinite-canvas/shared/canvas/tools/types";
import { isSiteTool, readViewImage, runSiteTool } from "./agent-site-tools";
import { discoverAgentTools } from "./plugin-tools";
import { pluginProjectBinding } from "@workbench/lib/plugins/runtime";

export async function executeCanvasTool(name: ToolName, input: unknown, projectId: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const context = useAgentStore.getState().canvasContext;
    if (context?.snapshot.projectId !== projectId) throw new Error("CANVAS_CHANGED");
    const args = parseToolInput(name, input) as Record<string, unknown>;
    const { snapshot } = context;
    if (name === "canvas_get_state") return compactCanvasState(snapshot, args);
    if (name === "canvas_get_nodes") return readCanvasNodes(snapshot, (args as { ids: string[] }).ids);
    if (isSiteTool(name)) return runSiteTool(name, args, { canvasSnapshot: snapshot, signal });
    const request = buildCanvasToolRequest(name, args, snapshot, nanoid);
    const ops = request.input.ops as CanvasAgentOp[];
    const next = await context.applyOps(ops);
    signal?.throwIfAborted();
    if (useAgentStore.getState().canvasContext?.applyOps !== context.applyOps) throw new Error("CANVAS_CHANGED");
    useAgentStore.getState().setCanvasContext({ ...context, snapshot: next });
    return summarizeCanvasChanges(snapshot, next, ops);
}

export async function createCanvasTools(projectId: string, signal?: AbortSignal): Promise<ToolSet> {
    const builtins = Object.fromEntries(toolNames.map((name) => [name, tool({
        description: toolDescriptions[name],
        inputSchema: zodSchema(toolInputSchemas[name]),
        ...(name === "canvas_view_image" && {
            toModelOutput: async ({ output }: { output: unknown }) => {
                const { ok, result } = output as { ok: boolean; result?: { storageKey: string } };
                if (!ok || !result) return { type: "json" as const, value: output as never };
                const image = await readViewImage(result.storageKey);
                return { type: "content" as const, value: [{ type: "file" as const, mediaType: image.mimeType, data: { type: "data" as const, data: image.data } }] };
            },
        }),
        execute: async (input, { abortSignal }) => {
            try {
                return { ok: true, result: await executeCanvasTool(name, input, projectId, abortSignal) };
            } catch (error) {
                return { ok: false, error: canvasToolError(error) };
            }
        },
    })]));
    const plugins = await discoverAgentTools(pluginProjectBinding?.projectId === projectId ? projectId : undefined, signal);
    return { ...builtins, ...Object.fromEntries(plugins.map(({ descriptor, inputSchema, execute }) => [descriptor.name, tool({
        description: descriptor.description, inputSchema: zodSchema(inputSchema),
        execute: async (input, { abortSignal }) => {
            try { return { ok: true, result: await execute(input, abortSignal) }; }
            catch (error) { return { ok: false, error: canvasToolError(error) }; }
        },
    })])) };
}
