import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { AGENT_PROMPT, VERSION } from "./config.js";
import type { AgentAttachment, AgentEmit } from "./types.js";

type Json = Record<string, unknown>;
type AgentEvent = Json & { type: string; usage?: unknown };
type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type CodexRunOptions = { threadId?: string; cwd?: string };
type AgentHistoryMessage = { id: string; role: "user" | "assistant" | "tool" | "error"; title?: string; text: string; detail?: unknown; streamId?: string };

let codexQueue: Promise<unknown> = Promise.resolve();
let codexApp: CodexAppClient | null = null;
let codexThreadId = "";
const canvasAgentMcp = canvasAgentMcpCommand();
const require = createRequire(import.meta.url);

export function withAgentPrompt(prompt: string) {
    return prompt.trim() ? `${AGENT_PROMPT}\n\n用户请求：${prompt}` : "";
}

export async function runCodexTurn(prompt: string, emit: AgentEmit, attachments: AgentAttachment[] = [], options: CodexRunOptions = {}) {
    if (!prompt.trim()) return;
    codexQueue = codexQueue.catch(() => undefined).then(() => runCodexTurnNow(prompt, emit, attachments, options));
    await codexQueue;
}

export function interruptCodexTurn() {
    if (!codexApp) return false;
    return codexApp.interruptCurrentTurn();
}

async function runCodexTurnNow(prompt: string, emit: AgentEmit, attachments: AgentAttachment[], options: CodexRunOptions) {
    let files: string[] = [];
    try {
        files = await writeAttachmentFiles(attachments);
        codexApp ||= await CodexAppClient.start(emit);
        let threadId = await ensureCodexThread(codexApp, options, emit);
        try {
            await codexApp.startTurn(threadId, prompt, files);
        } catch (error) {
            if (!isRecoverableThreadError(error)) throw error;
            emit("agent_log", { text: `Codex thread unavailable, starting a new thread: ${errorMessage(error)}` });
            codexThreadId = "";
            threadId = await ensureCodexThread(codexApp, { cwd: options.cwd }, emit);
            await codexApp.startTurn(threadId, prompt, files);
        }
    } catch (error) {
        emit("agent_error", { message: errorMessage(error) });
    } finally {
        await Promise.all(files.map((file) => fs.unlink(file).catch(() => undefined)));
    }
}

export async function startCodexThread(emit: AgentEmit, cwd?: string) {
    codexApp ||= await CodexAppClient.start(emit);
    const thread = await codexApp.startThread(cwd);
    codexThreadId = String(field(thread, "id") || "");
    return thread;
}

export async function resumeCodexThread(emit: AgentEmit, threadId: string, cwd?: string) {
    codexApp ||= await CodexAppClient.start(emit);
    await loadCodexThread(emit, threadId, cwd, false);
    const thread = await codexApp.resumeThread(threadId, cwd);
    assertThreadWorkspace(thread, cwd);
    codexThreadId = String(field(thread, "id") || threadId);
    return { thread, messages: threadMessages(thread) };
}

export async function listCodexThreads(emit: AgentEmit, options: { cwd: string; searchTerm?: string; limit?: number }) {
    codexApp ||= await CodexAppClient.start(emit);
    const result = await codexApp.listThreads({
        limit: options.limit || 40,
        sortKey: "updated_at",
        sortDirection: "desc",
        sourceKinds: ["cli", "vscode", "appServer", "exec"],
        cwd: options.cwd,
        ...(options.searchTerm ? { searchTerm: options.searchTerm } : {}),
    });
    const data = Array.isArray(field(result, "data")) ? (field(result, "data") as unknown[]).map(summarizeCodexThread).filter((thread) => threadInWorkspace(thread, options.cwd)) : [];
    return { data, nextCursor: field(result, "nextCursor") || null, backwardsCursor: field(result, "backwardsCursor") || null };
}

export async function readCodexThread(emit: AgentEmit, threadId: string, cwd?: string) {
    const thread = await loadCodexThread(emit, threadId, cwd, true);
    return { thread: summarizeCodexThread(thread), messages: threadMessages(thread) };
}

export async function verifyCodexThreadWorkspace(emit: AgentEmit, threadId: string, cwd: string) {
    await loadCodexThread(emit, threadId, cwd, false);
}

export async function archiveCodexThread(emit: AgentEmit, threadId: string, cwd?: string) {
    codexApp ||= await CodexAppClient.start(emit);
    await loadCodexThread(emit, threadId, cwd, false);
    await codexApp.archiveThread(threadId);
}

export function runClaudeTurn(prompt: string, emit: AgentEmit) {
    if (!prompt.trim()) return;
    const child = spawnAgent("claude", ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--allowedTools", "mcp__infinite-canvas__*", prompt], ["ignore", "pipe", "pipe"], emit);
    if (!child) return;
    pipeJsonLines(child, emit, "claude");
}

async function ensureCodexThread(app: CodexAppClient, options: CodexRunOptions, emit: AgentEmit) {
    if (options.threadId) {
        if (options.threadId === codexThreadId) return codexThreadId;
        try {
            const result = await app.readThread(options.threadId, false);
            assertThreadWorkspace(field(result, "thread") || {}, options.cwd);
            const thread = await app.resumeThread(options.threadId, options.cwd);
            assertThreadWorkspace(thread, options.cwd);
            codexThreadId = String(field(thread, "id") || options.threadId);
            return codexThreadId;
        } catch (error) {
            if (!isRecoverableThreadError(error)) throw error;
            emit("agent_log", { text: `Codex thread unavailable, starting a new thread: ${errorMessage(error)}` });
        }
    }
    if (!codexThreadId) {
        const thread = await app.startThread(options.cwd);
        codexThreadId = String(field(thread, "id") || "");
    }
    return codexThreadId;
}

function isRecoverableThreadError(error: unknown) {
    return /thread not loaded|no rollout found/i.test(errorMessage(error));
}

class CodexAppClient {
    private nextId = 1;
    private buffer = "";
    private textByItem = new Map<string, string>();
    private deltaCount = 0;
    private lastUsage: unknown = null;
    private pending = new Map<number, PendingRequest>();
    private activeTurns = new Map<string, PendingRequest>();
    private completedTurns = new Map<string, Error | null>();

    private constructor(private child: ChildProcess, private emit: AgentEmit) {}

    static async start(emit: AgentEmit) {
        const child = spawn(process.execPath, [codexBin(), "app-server", "--stdio"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
        const client = new CodexAppClient(child, emit);
        child.stdout?.on("data", (chunk) => client.read(chunk.toString()));
        child.stderr?.on("data", (chunk) => emit("agent_log", { text: chunk.toString() }));
        child.on("error", (error) => emit("agent_error", { message: error.message }));
        child.on("exit", (code) => {
            client.failAll(`Codex app-server exited: ${code ?? 0}`);
            codexApp = null;
            codexThreadId = "";
            emit("agent_log", { text: `Codex app-server exited: ${code ?? 0}` });
        });
        await client.request("initialize", { clientInfo: { name: "canvas-agent", title: "Infinite Canvas Agent", version: VERSION }, capabilities: { experimentalApi: true, requestAttestation: false } });
        client.notify("initialized");
        return client;
    }

    async startThread(cwd?: string) {
        const result = await this.request("thread/start", { approvalPolicy: "never", sandbox: "workspace-write", config: codexConfig(), ...(cwd ? { cwd } : {}), threadSource: "user" });
        const thread = field(result, "thread") as Json | undefined;
        const id = String(field(thread, "id") || "");
        if (!id) throw new Error("Codex app-server 没有返回 thread id");
        return thread || {};
    }

    async resumeThread(threadId: string, cwd?: string) {
        const result = await this.request("thread/resume", { threadId, approvalPolicy: "never", sandbox: "workspace-write", config: codexConfig(), ...(cwd ? { cwd } : {}) });
        const thread = field(result, "thread") as Json | undefined;
        const id = String(field(thread, "id") || "");
        if (!id) throw new Error("Codex app-server 没有返回 thread id");
        return thread || {};
    }

    listThreads(params: Json) {
        return this.request("thread/list", params);
    }

    readThread(threadId: string, includeTurns = true) {
        return this.request("thread/read", { threadId, includeTurns });
    }

    archiveThread(threadId: string) {
        return this.request("thread/archive", { threadId });
    }

    async startTurn(threadId: string, prompt: string, images: string[]) {
        const result = await this.request("turn/start", { threadId, input: codexInput(prompt, images), approvalPolicy: "never" });
        const turnId = String(field(field(result, "turn"), "id") || "");
        if (!turnId) throw new Error("Codex app-server 没有返回 turn id");
        const completed = this.completedTurns.get(turnId);
        if (this.completedTurns.has(turnId)) {
            this.completedTurns.delete(turnId);
            if (completed) throw completed;
            return;
        }
        await new Promise((resolve, reject) => this.activeTurns.set(turnId, { resolve, reject }));
    }

    interruptCurrentTurn() {
        if (this.activeTurns.size === 0) return false;
        try {
            this.child.kill("SIGINT");
            return true;
        } catch {
            return false;
        }
    }

    private request(method: string, params: unknown) {
        const id = this.nextId++;
        this.write({ id, method, params });
        return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    }

    private notify(method: string, params?: unknown) {
        this.write(params === undefined ? { method } : { method, params });
    }

    private write(value: unknown) {
        this.child.stdin?.write(`${JSON.stringify(value)}\n`);
    }

    private read(chunk: string) {
        this.buffer += chunk;
        const lines = this.buffer.split(/\r?\n/);
        this.buffer = lines.pop() || "";
        lines.filter(Boolean).forEach((line) => {
            try {
                this.handle(JSON.parse(line) as Json);
            } catch {
                this.emit("agent_log", { text: line });
            }
        });
    }

    private handle(message: Json) {
        const id = Number(message.id);
        if (message.error && this.pending.has(id)) return this.reject(id, String(field(message.error, "message") || "Codex request failed"));
        if (this.pending.has(id)) return this.resolve(id, message.result);
        if (typeof message.method === "string" && "id" in message) return this.answerServerRequest(message);
        if (typeof message.method === "string") this.handleNotification(message.method, (message.params || {}) as Json);
    }

    private handleNotification(method: string, params: Json) {
        if (method === "item/agentMessage/delta") return this.emitDelta(params);
        if (method === "thread/tokenUsage/updated") this.lastUsage = normalizeUsage(params);
        const event = normalizeCodexNotification(method, params);
        if (!event) return;
        if (event.type === "turn.completed") event.usage = this.lastUsage;
        this.emit("agent_event", { agent: "codex", ...event });
        if (event.type === "turn.completed") {
            const turnId = String(field(params, "turnId") || field(field(params, "turn"), "id") || "");
            const pending = this.activeTurns.get(turnId);
            const error = field(field(params, "turn"), "error");
            if (pending) {
                this.activeTurns.delete(turnId);
                error ? pending.reject(new Error(String(field(error, "message") || "Codex turn failed"))) : pending.resolve(event);
            } else if (turnId) {
                this.completedTurns.set(turnId, error ? new Error(String(field(error, "message") || "Codex turn failed")) : null);
            }
            this.emit("agent_event", { agent: "codex", type: "stream.summary", delta_count: this.deltaCount });
            this.deltaCount = 0;
            this.emit("agent_done", { agent: "codex", usage: event.usage });
        }
    }

    private emitDelta(params: Json) {
        const id = String(field(params, "itemId") || "");
        const text = `${this.textByItem.get(id) || ""}${String(field(params, "delta") || "")}`;
        this.deltaCount += 1;
        this.textByItem.set(id, text);
        this.emit("agent_event", { agent: "codex", type: "item.updated", item: { id, type: "agent_message", text } });
    }

    private answerServerRequest(message: Json) {
        const method = String(message.method);
        const result = method === "mcpServer/elicitation/request" ? { action: "accept", content: {}, _meta: null } : { decision: "decline" };
        this.write({ id: message.id, result });
        this.emit("agent_event", { agent: "codex", type: "server.request", method, params: message.params, result });
    }

    private resolve(id: number, result: unknown) {
        const pending = this.pending.get(id);
        if (pending) (this.pending.delete(id), pending.resolve(result));
    }

    private reject(id: number, message: string) {
        const pending = this.pending.get(id);
        if (pending) (this.pending.delete(id), pending.reject(new Error(message)));
    }

    failAll(message: string) {
        [...this.pending.values(), ...this.activeTurns.values()].forEach((item) => item.reject(new Error(message)));
        this.pending.clear();
        this.activeTurns.clear();
    }
}

function canvasAgentMcpCommand() {
    const current = process.argv.find((arg) => /index\.(t|j)s$/.test(arg)) || "";
    const entry = path.resolve(current || fileURLToPath(new URL("./index.js", import.meta.url)));
    const tsx = path.join(path.dirname(entry), "..", "node_modules", "tsx", "dist", "cli.mjs");
    return entry.endsWith(".ts") ? { command: process.execPath, args: [tsx, entry, "mcp"] } : { command: process.execPath, args: [entry, "mcp"] };
}

function codexConfig() {
    return { mcp_servers: { "infinite-canvas": { command: canvasAgentMcp.command, args: canvasAgentMcp.args, default_tools_approval_mode: "approve", startup_timeout_sec: 20, tool_timeout_sec: 90 } } };
}

function codexInput(prompt: string, images: string[]) {
    return [{ type: "text", text: prompt, text_elements: [] }, ...images.map((file) => ({ type: "localImage", path: file }))];
}

function normalizeCodexNotification(method: string, params: Json): AgentEvent | null {
    if (method === "thread/started") return { type: "thread.started", thread_id: field(field(params, "thread"), "id") };
    if (method === "turn/started") return { type: "turn.started" };
    if (method === "turn/completed") return { type: "turn.completed", usage: null };
    if (method === "item/started") return { type: "item.started", item: normalizeItem(field(params, "item")) };
    if (method === "item/completed") return { type: "item.completed", item: normalizeItem(field(params, "item")) };
    if (method === "error") return { type: "error", message: field(params, "message") };
    return null;
}

async function loadCodexThread(emit: AgentEmit, threadId: string, cwd: string | undefined, includeTurns: boolean) {
    codexApp ||= await CodexAppClient.start(emit);
    const result = await codexApp.readThread(threadId, includeTurns);
    const thread = field(result, "thread") || {};
    assertThreadWorkspace(thread, cwd);
    return thread;
}

function assertThreadWorkspace(thread: unknown, cwd?: string) {
    if (!cwd || threadInWorkspace(thread, cwd)) return;
    throw new Error("该 Codex 会话不属于当前画布工作空间");
}

function threadInWorkspace(thread: unknown, cwd: string) {
    const threadCwd = String(field(thread, "cwd") || "");
    return Boolean(threadCwd && path.resolve(threadCwd) === path.resolve(cwd));
}

function normalizeItem(item: unknown) {
    const value = item && typeof item === "object" ? { ...(item as Json) } : {};
    if (value.type === "agentMessage") value.type = "agent_message";
    if (value.type === "mcpToolCall") value.type = "mcp_tool_call";
    if (value.type === "agent_message" && typeof value.id === "string") value.text = String(value.text || "");
    if ("arguments" in value) value.arguments = parseMaybeJson(value.arguments);
    return value;
}

function normalizeUsage(params: Json) {
    const total = field(field(params, "tokenUsage"), "total") as Json | undefined;
    return {
        input_tokens: field(total, "inputTokens"),
        cached_input_tokens: field(total, "cachedInputTokens"),
        output_tokens: field(total, "outputTokens"),
        reasoning_output_tokens: field(total, "reasoningOutputTokens"),
    };
}

function parseMaybeJson(value: unknown) {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function field(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as Json)[key] : undefined;
}

export function summarizeCodexThread(thread: unknown) {
    return {
        id: String(field(thread, "id") || ""),
        sessionId: String(field(thread, "sessionId") || ""),
        preview: displayUserText(String(field(thread, "preview") || "")),
        name: stringOrNull(field(thread, "name")),
        cwd: String(field(thread, "cwd") || ""),
        status: String(field(thread, "status") || ""),
        source: field(thread, "source"),
        threadSource: field(thread, "threadSource"),
        createdAt: Number(field(thread, "createdAt") || 0),
        updatedAt: Number(field(thread, "updatedAt") || 0),
    };
}

function threadMessages(thread: unknown): AgentHistoryMessage[] {
    const turns = arrayValue(field(thread, "turns"));
    const messages: AgentHistoryMessage[] = [];
    turns.forEach((turn, turnIndex) => {
        arrayValue(field(turn, "items")).forEach((item, itemIndex) => {
            const type = String(field(item, "type") || "");
            const id = String(field(item, "id") || `${turnIndex}-${itemIndex}`);
            if (type === "userMessage") {
                const text = displayUserText(userInputText(field(item, "content")));
                if (text) messages.push({ id, role: "user", text });
            }
            if (type === "agentMessage") {
                const text = String(field(item, "text") || "").trim();
                if (text) messages.push({ id, role: "assistant", title: "Codex", text, streamId: id });
            }
            if (type === "mcpToolCall") {
                const tool = String(field(item, "tool") || "工具调用");
                const error = field(field(item, "error"), "message");
                messages.push({ id, role: error ? "error" : "tool", title: toolName(tool), text: error ? String(error) : `${toolName(tool)} ${String(field(item, "status") || "完成")}`, detail: item });
            }
            if (type === "commandExecution") {
                const command = String(field(item, "command") || "").trim();
                if (command) messages.push({ id, role: "tool", title: "命令", text: command, detail: { cwd: field(item, "cwd"), status: field(item, "status"), exitCode: field(item, "exitCode") } });
            }
            if (type === "fileChange") messages.push({ id, role: "tool", title: "文件变更", text: "Codex 修改了文件", detail: item });
        });
    });
    return messages.filter((item) => item.text).slice(-120);
}

function userInputText(content: unknown) {
    return arrayValue(content)
        .map((item) => {
            const type = String(field(item, "type") || "");
            if (type === "text") return String(field(item, "text") || "");
            if (type === "image" || type === "localImage") return "图片附件";
            if (type === "mention") return `@${String(field(item, "name") || "文件")}`;
            return "";
        })
        .filter(Boolean)
        .join("\n");
}

function displayUserText(text: string) {
    const value = text.trim();
    const marker = "用户请求：";
    const index = value.lastIndexOf(marker);
    return (index >= 0 ? value.slice(index + marker.length) : value).trim();
}

function arrayValue(value: unknown) {
    return Array.isArray(value) ? value : [];
}

function stringOrNull(value: unknown) {
    return typeof value === "string" && value.trim() ? value : null;
}

function toolName(name: string) {
    if (name === "canvas_apply_ops") return "画布操作";
    if (name === "canvas_get_state") return "读取画布";
    if (name === "canvas_get_selection") return "读取选区";
    if (name === "canvas_export_snapshot") return "导出快照";
    if (name === "canvas_create_text_node") return "创建文本";
    if (name === "canvas_create_image_prompt_flow") return "创建生图流程";
    if (name === "canvas_create_generation_flow") return "创建生成流程";
    if (name === "canvas_generate_text") return "生成文本";
    if (name === "canvas_generate_image") return "生成图片";
    if (name === "canvas_generate_video") return "生成视频";
    if (name === "canvas_generate_audio") return "生成音频";
    if (name === "canvas_run_generation") return "触发生成";
    return name;
}

async function writeAttachmentFiles(attachments: AgentAttachment[]) {
    return await Promise.all(attachments.filter((item) => item.dataUrl?.startsWith("data:image/")).map(writeAttachmentFile));
}

async function writeAttachmentFile(item: AgentAttachment) {
    const [, meta = "", data = ""] = item.dataUrl?.match(/^data:([^;]+);base64,(.+)$/) || [];
    if (!data) throw new Error(`图片附件无效：${item.name || "未命名图片"}`);
    const file = path.join(os.tmpdir(), `infinite-canvas-${Date.now()}-${Math.random().toString(16).slice(2)}.${imageExt(meta || item.type)}`);
    await fs.writeFile(file, Buffer.from(data, "base64"));
    return file;
}

function imageExt(type = "") {
    if (type.includes("png")) return "png";
    if (type.includes("webp")) return "webp";
    return "jpg";
}

function codexBin() {
    return path.join(path.dirname(require.resolve("@openai/codex/package.json")), "bin", "codex.js");
}

function pipeJsonLines(child: ReturnType<typeof spawn>, emit: AgentEmit, agent: string) {
    let out = "";
    child.stdout?.on("data", (chunk) => {
        out += chunk.toString();
        const lines = out.split(/\r?\n/);
        out = lines.pop() || "";
        lines.filter(Boolean).forEach((line) => {
            try {
                emit("agent_event", { agent, ...JSON.parse(line) });
            } catch {
                emit("agent_event", { agent, type: "raw", text: line });
            }
        });
    });
    child.stderr?.on("data", (chunk) => emit("agent_log", { text: chunk.toString() }));
    child.on("error", (error) => emit("agent_error", { message: error.message }));
    child.on("close", (code) => emit("agent_done", { agent, code }));
}

function spawnAgent(name: string, args: string[], stdio: StdioOptions, emit: AgentEmit) {
    try {
        return spawn(name, args, { stdio, shell: process.platform === "win32", windowsHide: true });
    } catch (error) {
        emit("agent_error", { message: errorMessage(error) });
        return null;
    }
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
