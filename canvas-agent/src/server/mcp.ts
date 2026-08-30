import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { agentIdentityHeaders, type ExternalAgentIdentity } from "../agent/identity.js";
import { toolDescriptions, toolInputSchemas, toolNames, type ToolName } from "../canvas/schemas.js";
import { AGENT_PROMPT, loadConfig, type CanvasAgentConfig, VERSION } from "../config.js";

type CanvasAgentToolResponse = { ok?: boolean; result?: unknown; error?: string };

/** 启动通过标准输入输出通信的 MCP 服务。 */
export async function startMcpServer(identity: ExternalAgentIdentity) {
    const config = loadConfig(true);
    const server = new McpServer({ name: `canvas-agent-${identity.kind}`, version: VERSION }, { instructions: AGENT_PROMPT });
    toolNames.forEach((name) => registerCanvasTool(server, config, identity, name));
    await updateRegistration(config, identity, "register");
    const heartbeat = setInterval(() => void updateRegistration(config, identity, "register"), 15_000);
    heartbeat.unref();
    const unregister = async () => {
        clearInterval(heartbeat);
        await updateRegistration(config, identity, "unregister");
    };
    process.once("SIGINT", () => void unregister().finally(() => process.exit(0)));
    process.once("SIGTERM", () => void unregister().finally(() => process.exit(0)));
    process.once("exit", () => clearInterval(heartbeat));
    await server.connect(new StdioServerTransport());
}

/** 向 MCP Server 注册单个 Canvas Agent 工具。 */
function registerCanvasTool(server: McpServer, config: CanvasAgentConfig, identity: ExternalAgentIdentity, name: ToolName) {
    const schema = toolInputSchemas[name];
    server.registerTool(name, { description: toolDescriptions[name], inputSchema: schema.shape }, async (input: unknown) => {
        const result = await postCanvasAgentTool(config, identity, name, schema.parse(input));
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    });
}

/** 将 MCP 工具调用转发到本地 Canvas Agent HTTP 服务。 */
async function postCanvasAgentTool(config: CanvasAgentConfig, identity: ExternalAgentIdentity, name: ToolName, input: unknown) {
    const res = await fetch(`${config.url}/api/tools`, { method: "POST", headers: { "content-type": "application/json", "x-canvas-agent-token": config.token, ...agentIdentityHeaders(identity) }, body: JSON.stringify({ name, input }) });
    const body = (await res.json()) as CanvasAgentToolResponse;
    if (!body.ok) throw new Error(JSON.stringify(body));
    return body.result;
}

async function updateRegistration(config: CanvasAgentConfig, identity: ExternalAgentIdentity, action: "register" | "unregister") {
    try {
        await fetch(`${config.url}/agents/${action}`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-canvas-agent-token": config.token, ...agentIdentityHeaders(identity) },
        });
    } catch {}
}
