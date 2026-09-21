import { AppError } from "../errors.js";
import type { JsonObject } from "../types.js";

type JsonRpcRequest = {
    jsonrpc?: string;
    id?: number | string | null;
    method?: string;
    params?: unknown;
};

async function main() {
    const url = required("CORESEARCH_RUNTIME_URL");
    const token = required("CORESEARCH_RUNTIME_TOKEN");
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
        buffer += String(chunk);
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
            const text = line.trim();
            if (!text) continue;
            void handle(url, token, JSON.parse(text) as JsonRpcRequest).catch((error) => {
                const id = (JSON.parse(text) as JsonRpcRequest).id ?? null;
                write({ jsonrpc: "2.0", id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } });
            });
        }
    });
}

async function handle(url: string, token: string, message: JsonRpcRequest) {
    const id = message.id ?? null;
    if (message.method === "initialize") {
        write({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "coresearch-canvas", version: "0.1.0" } } });
        return;
    }
    if (message.method === "notifications/initialized") return;
    if (message.method === "tools/list") {
        write({ jsonrpc: "2.0", id, result: { tools: [
            { name: "canvas_get_state", description: "读取当前 Project 的画布快照。不要传 Project 或路径。", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
            { name: "canvas_apply_ops", description: "向当前 Project 的浏览器提出画布修改，必须等待用户确认。", inputSchema: { type: "object", properties: { ops: { type: "array", items: { type: "object" } }, summary: { type: "string" } }, required: ["ops", "summary"], additionalProperties: false } },
        ] } });
        return;
    }
    if (message.method === "tools/call") {
        const params = isObject(message.params) ? message.params : {};
        const args = isObject(params.arguments) ? params.arguments : {};
        const name = String(params.name || "");
        const result = name === "canvas_get_state"
            ? await post(url, token, "/canvas/read", {})
            : name === "canvas_apply_ops"
                ? await post(url, token, "/canvas/apply", { operations: args.ops, summary: args.summary })
                : (() => { throw new AppError("未知画布工具", 400, "unknown_tool"); })();
        write({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
        return;
    }
    if (id !== null) write({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method ${message.method || ""}` } });
}

async function post(base: string, token: string, pathName: string, body: JsonObject) {
    const response = await fetch(`${base.replace(/\/$/, "")}${pathName}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    });
    const payload = await response.json() as { error?: { message?: string }; snapshot?: unknown; result?: unknown };
    if (!response.ok) throw new Error(payload.error?.message || "画布工具调用失败");
    return payload.snapshot ?? payload.result ?? payload;
}

function write(value: unknown) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
}

function required(name: string) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`缺少环境变量 ${name}`);
    return value;
}

function isObject(value: unknown): value is JsonObject {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("project-canvas-mcp.ts") || process.argv[1]?.endsWith("project-canvas-mcp.js")) {
    void main();
}
