import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { agentToolCallSchema, agentToolDescriptorSchema, agentToolNameSchema, type AgentToolDescriptor } from "@infinite-canvas/shared/canvas/tools/plugin-tools";
import { isToolName, parseToolInput } from "@infinite-canvas/shared/canvas/tools/tools";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { toolDescriptions, toolInputSchemas, toolNames } from "@infinite-canvas/shared/canvas/tools/schemas";
import { canvasToolError } from "@infinite-canvas/shared/canvas/tools/errors";
import { logger } from "../utils/logger.js";
import { AGENT_PROMPT, loadConfig, VERSION } from "../config.js";

type CallTool = (name: string, input: unknown, clientId?: string, projectId?: string, signal?: AbortSignal) => Promise<unknown>;
const routing = { projectId: z.string().optional().describe("首次读取返回的项目 ID；后续传入可阻止误操作切换后的画布。") };
const builtins: Tool[] = toolNames.map(name => {
    const readOnlyHint = ["canvas_get_state", "canvas_get_nodes", "canvas_list_models", "canvas_list_references", "canvas_view_image", "generation_get_status", "prompts_search", "assets_list"].includes(name);
    return { name, description: toolDescriptions[name], inputSchema: toJsonSchemaCompat(toolInputSchemas[name].extend(routing)) as Tool["inputSchema"],
        annotations: { readOnlyHint, ...(readOnlyHint && { destructiveHint: false, idempotentHint: true }) } };
});

export function createCanvasMcpServer(callTool: CallTool, listPlugins: (signal: AbortSignal) => Promise<AgentToolDescriptor[]> = async () => []) {
    const server = new Server({ name: "infinite-canvas", version: VERSION }, { capabilities: { tools: {} }, instructions: AGENT_PROMPT });
    server.setRequestHandler(ListToolsRequestSchema, async (_, { signal }) => {
        const plugins = (await listPlugins(signal)).map(({ name, description, binding, inputSchema, outputSchema, readOnly }) => ({
            name, description, outputSchema, annotations: { readOnlyHint: readOnly },
            inputSchema: { type: "object" as const, properties: { binding: { type: "string", enum: [binding] }, input: inputSchema,
                projectId: { type: "string" } }, required: ["binding", "input"], additionalProperties: false },
        }));
        return { tools: [...builtins, ...plugins] };
    });
    server.setRequestHandler(CallToolRequestSchema, async ({ params }, { signal }) => {
        try {
            const { projectId, ...args } = z.object(routing).passthrough().parse(params.arguments ?? {});
            const plugin = !isToolName(params.name);
            if (plugin && !agentToolNameSchema.safeParse(params.name).success) throw new Error("UNKNOWN_TOOL");
            const input = isToolName(params.name) ? parseToolInput(params.name, args) : agentToolCallSchema.parse(args);
            const result = await callTool(params.name, input, undefined, projectId, signal);
            const { image, ...rest } = (result ?? {}) as { image?: { data: string; mimeType: string } };
            return { content: [...(image ? [{ type: "image" as const, data: image.data, mimeType: image.mimeType }] : []), { type: "text", text: JSON.stringify(image ? rest : result) }], ...(plugin && { structuredContent: result as Record<string, unknown> }) };
        } catch (error) {
            logger.error("Canvas MCP tool failed", { name: params.name, error });
            return { isError: true, content: [{ type: "text", text: JSON.stringify(canvasToolError(error)) }] };
        }
    });
    return server;
}

export async function startMcpServer() {
    const config = loadConfig(true);
    async function request(path: string, input: unknown, signal?: AbortSignal) {
        const response = await fetch(new URL(path, config.url), {
            method: "POST", signal, headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
        });
        const body = await response.json() as { result: unknown; error?: { code: string } };
        if (!response.ok) throw new Error(body.error?.code ?? "CANVAS_TOOL_FAILED");
        return body.result;
    }
    const server = createCanvasMcpServer(
        (name, input, clientId, projectId, signal) => request("/api/tools", { name, input, clientId, projectId }, signal),
        async signal => agentToolDescriptorSchema.array().parse(await request("/api/tools/list", {}, signal)),
    );
    await server.connect(new StdioServerTransport());
}
