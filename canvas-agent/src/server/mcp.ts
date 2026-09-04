import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { toolDescriptions, toolInputSchemas, toolNames, type ToolName } from "../canvas/schemas.js";
import { AGENT_PROMPT, CLARIFICATION_TIMEOUT_MS, loadConfig, type CanvasAgentConfig, VERSION } from "../config.js";

type CanvasAgentToolResponse = { ok?: boolean; result?: unknown; error?: string };

/** 启动通过标准输入输出通信的 MCP 服务。 */
export async function startMcpServer() {
    const config = loadConfig(true);
    const server = new McpServer({ name: "canvas-agent", version: VERSION }, { instructions: AGENT_PROMPT });
    toolNames.forEach((name) => registerCanvasTool(server, config, name));
    registerAskUserTool(server);
    await server.connect(new StdioServerTransport());
}

const clarificationOptionSchema = z.object({
    value: z.string().trim().min(1).max(200),
    label: z.string().trim().min(1).max(200),
    description: z.string().trim().max(500).optional(),
}).strict();

const clarificationQuestionSchema = z.object({
    id: z.string().trim().min(1).max(64).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
    label: z.string().trim().min(1).max(500),
    description: z.string().trim().max(1000).optional(),
    kind: z.enum(["single", "multiple", "text"]),
    options: z.array(clarificationOptionSchema).min(1).max(12).optional(),
    required: z.boolean().optional(),
    placeholder: z.string().trim().max(300).optional(),
}).strict().superRefine((question, context) => {
    if (question.kind === "text" && question.options) context.addIssue({ code: "custom", path: ["options"], message: "文本问题不能包含选项" });
    if (question.kind !== "text" && !question.options) context.addIssue({ code: "custom", path: ["options"], message: "选项问题必须包含选项" });
    if (question.options && new Set(question.options.map((option) => option.value)).size !== question.options.length) context.addIssue({ code: "custom", path: ["options"], message: "选项值不能重复" });
});

const askUserObjectSchema = z.object({
    message: z.string().trim().max(2000).optional(),
    questions: z.array(clarificationQuestionSchema).min(1).max(5),
}).strict();

const askUserInputSchema = askUserObjectSchema.superRefine((input, context) => {
    if (new Set(input.questions.map((question) => question.id)).size !== input.questions.length) context.addIssue({ code: "custom", path: ["questions"], message: "问题 ID 不能重复" });
});

/** 通过 MCP 标准 elicitation 暂停当前 turn，等待网页端的业务澄清卡片回传答案。 */
function registerAskUserTool(server: McpServer) {
    server.registerTool("ask_user", {
        description: "信息不足且继续执行会影响结果时，向用户发起 1 至 5 个澄清问题。single 为单选，multiple 为多选，text 为自由输入。调用后必须等待用户回答或取消，不能自行假设答案。",
        inputSchema: askUserObjectSchema.shape,
    }, async (input: unknown) => {
        const value = askUserInputSchema.parse(input);
        const questions = value.questions.map((question) => ({ ...question, required: question.required ?? true }));
        const requestedSchema = {
            type: "object" as const,
            properties: Object.fromEntries(questions.map((question) => [question.id, clarificationFieldSchema(question)])),
            required: questions.filter((question) => question.required).map((question) => question.id),
        };
        const result = await server.server.elicitInput({
            mode: "form",
            message: value.message || "请补充以下创作信息。",
            requestedSchema,
            _meta: { "infinite-canvas/clarification": { questions } },
        }, { timeout: CLARIFICATION_TIMEOUT_MS, maxTotalTimeout: CLARIFICATION_TIMEOUT_MS });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], isError: result.action !== "accept" };
    });
}

function clarificationFieldSchema(question: z.infer<typeof clarificationQuestionSchema> & { required: boolean }) {
    const base = { title: question.label, ...(question.description ? { description: question.description } : {}) };
    if (question.kind === "text") return { type: "string" as const, ...base, ...(question.required ? { minLength: 1 } : {}) };
    const options = question.options || [];
    if (question.kind === "multiple") return { type: "array" as const, ...base, ...(question.required ? { minItems: 1 } : {}), maxItems: options.length, items: { anyOf: options.map((option) => ({ const: option.value, title: option.label })) } };
    return { type: "string" as const, ...base, oneOf: options.map((option) => ({ const: option.value, title: option.label })) };
}

/** 向 MCP Server 注册单个 Canvas Agent 工具。 */
function registerCanvasTool(server: McpServer, config: CanvasAgentConfig, name: ToolName) {
    const schema = toolInputSchemas[name];
    server.registerTool(name, { description: toolDescriptions[name], inputSchema: schema.shape }, async (input: unknown) => {
        const result = await postCanvasAgentTool(config, name, schema.parse(input));
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    });
}

/** 将 MCP 工具调用转发到本地 Canvas Agent HTTP 服务。 */
async function postCanvasAgentTool(config: CanvasAgentConfig, name: ToolName, input: unknown) {
    const res = await fetch(`${config.url}/api/tools`, { method: "POST", headers: { "content-type": "application/json", "x-canvas-agent-token": config.token }, body: JSON.stringify({ name, input }) });
    const body = (await res.json()) as CanvasAgentToolResponse;
    if (!body.ok) throw new Error(body.error || "tool call failed");
    return body.result;
}
