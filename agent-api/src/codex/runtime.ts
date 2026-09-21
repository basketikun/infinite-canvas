import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { CanvasBridge } from "../canvas-bridge.js";
import { AppError } from "../errors.js";
import { projectRuntimePaths, type ProjectRuntimePaths } from "../project-paths.js";
import type { AdapterEvent, RuntimeAdapter, RuntimeExecutionInput } from "../runtime.js";
import type { RuntimeTokenClaims, RuntimeTokenService } from "../runtime-token.js";
import type { JsonObject, RequestContext } from "../types.js";
import { CodexJsonRpcClient, type CodexTransport } from "./client.js";
import { mapCodexNotification } from "./events.js";
import { spawnCodexProcess } from "./process.js";

export type CodexMcpConfig = {
    command: string;
    args: string[];
    loopbackUrl: string;
};

export type CodexSpawnContext = {
    ctx: RequestContext;
    paths: ProjectRuntimePaths;
    token: string;
    runtimeId: string;
};

export type CodexRuntimeConfig = {
    bin: string;
    apiKey: string;
    runtimeRoot: string;
    tokens: RuntimeTokenService;
    canvas: CanvasBridge;
    mcp: CodexMcpConfig;
    createTransport?: (input: CodexSpawnContext) => Promise<CodexTransport> | CodexTransport;
};

type ActiveTurn = {
    ctx: RequestContext;
    conversationId: string;
    runId: string;
    signal: AbortSignal;
    emit: (event: AdapterEvent) => Promise<void>;
};

type ThreadResult = { thread?: { id?: string } };
type TurnResult = { turn?: { id?: string } };

export class CodexRuntimeAdapter implements RuntimeAdapter {
    private readonly runtimes = new Map<string, Promise<CodexRuntime>>();
    private readonly createTransport: NonNullable<CodexRuntimeConfig["createTransport"]>;

    constructor(private readonly config: CodexRuntimeConfig) {
        this.createTransport = config.createTransport || ((input) => spawnCodexProcess({
            bin: config.bin,
            cwd: input.paths.workspace,
            codexHome: input.paths.codexHome,
            apiKey: config.apiKey,
        }));
    }

    async execute(input: RuntimeExecutionInput) {
        const runtime = await this.getOrCreate(input.ctx);
        await runtime.runTurn(input);
    }

    parseLiveToken(token: string) {
        const claims = this.config.tokens.parse(token);
        if (claims.runtimeId !== runtimeKey(claims) || !this.runtimes.has(claims.runtimeId)) {
            throw new AppError("运行时 token 无效", 401, "invalid_runtime_token");
        }
        return claims;
    }

    async readCanvas(token: string) {
        const claims = this.parseLiveToken(token);
        return this.config.canvas.readSnapshot(claims);
    }

    async applyCanvas(token: string, operations: unknown[], summary: string) {
        const claims = this.parseLiveToken(token);
        const runtime = await this.runtimes.get(claims.runtimeId);
        if (!runtime) throw new AppError("运行时 token 无效", 401, "invalid_runtime_token");
        return runtime.applyCanvas(operations, summary);
    }

    private getOrCreate(ctx: RequestContext) {
        const id = runtimeKey(ctx);
        const existing = this.runtimes.get(id);
        if (existing) return existing;
        const created = this.spawn(ctx).catch((error) => {
            this.runtimes.delete(id);
            throw error;
        });
        this.runtimes.set(id, created);
        return created;
    }

    private async spawn(ctx: RequestContext) {
        const paths = projectRuntimePaths(this.config.runtimeRoot, ctx);
        await mkdir(paths.workspace, { recursive: true });
        await mkdir(paths.codexHome, { recursive: true });
        await mkdir(paths.tmp, { recursive: true });
        try {
            await writeFile(path.join(paths.workspace, "AGENTS.md"), "You are the research Agent for the current Project. Use canvas tools. Do not guess userId, projectId, or file paths.\n", { flag: "wx" });
        } catch {
            // already initialized
        }
        const runtimeId = runtimeKey(ctx);
        const token = this.config.tokens.create({ ...ctx, runtimeId });
        const transport = await this.createTransport({ ctx, paths, token, runtimeId });
        const runtime = new CodexRuntime(ctx, paths, this.config, token, transport);
        await runtime.initialize();
        return runtime;
    }
}

export class CodexRuntime {
    private readonly client: CodexJsonRpcClient;
    private activeTurn: ActiveTurn | null = null;
    private turnWaiter: ((method: string, params: unknown) => void) | null = null;

    constructor(
        readonly ctx: RequestContext,
        readonly paths: ProjectRuntimePaths,
        private readonly config: CodexRuntimeConfig,
        private readonly token: string,
        transport: CodexTransport,
    ) {
        this.client = new CodexJsonRpcClient(transport);
        this.client.onNotification((method, params) => {
            if (this.activeTurn) {
                const event = mapCodexNotification(method, params);
                if (event) void this.activeTurn.emit(event);
            }
            this.turnWaiter?.(method, params);
        });
        this.client.onServerRequest((id, method) => {
            this.client.respond(id, { decision: /mcp/i.test(method) ? "approve" : "decline" });
        });
    }

    async initialize() {
        await this.client.request("initialize", {
            clientInfo: { name: "agent-api", title: "Research Canvas Agent API", version: "0.1.0" },
            capabilities: { experimentalApi: true, requestAttestation: false },
        });
        this.client.notify("initialized");
    }

    async runTurn(input: RuntimeExecutionInput) {
        this.activeTurn = { ctx: input.ctx, conversationId: input.conversationId, runId: input.runId, signal: input.signal, emit: input.emit };
        let threadId = "";
        let turnId = "";
        const onAbort = () => {
            if (threadId && turnId) void this.client.request("turn/interrupt", { threadId, turnId }).catch(() => {});
        };
        input.signal.addEventListener("abort", onAbort, { once: true });
        try {
            const conversation = await input.store.readConversation(input.ctx, input.conversationId);
            threadId = await this.ensureThread(input, conversation.codexThreadId);
            const started = await this.client.request("turn/start", {
                threadId,
                input: [{ type: "text", text: input.prompt, text_elements: [] }],
                approvalPolicy: "on-request",
                sandboxPolicy: { type: "readOnly", networkAccess: true },
            }) as TurnResult;
            turnId = started.turn?.id || "";
            if (!turnId) throw new Error("Codex 未返回 turn");
            await input.store.bindCodexTurn(input.ctx, input.conversationId, input.runId, turnId);
            await this.waitForTurn(input.signal, threadId, turnId);
        } finally {
            input.signal.removeEventListener("abort", onAbort);
            this.activeTurn = null;
            this.turnWaiter = null;
        }
    }

    async applyCanvas(operations: unknown[], summary: string) {
        if (!this.activeTurn) throw new AppError("当前没有正在运行的 Agent turn", 409, "run_not_active");
        const mutation = this.config.canvas.requestMutation(this.activeTurn.ctx, this.activeTurn.signal);
        await this.activeTurn.emit({
            type: "canvas.tool.requested",
            itemId: mutation.callId,
            payload: { callId: mutation.callId, summary, operations },
        });
        return mutation.result;
    }

    private async ensureThread(input: RuntimeExecutionInput, existing: string | null) {
        if (existing) {
            try {
                const resumed = await this.client.request("thread/resume", threadParams(this.paths.workspace, this.mcpConfig(), existing)) as ThreadResult;
                return resumed.thread?.id || existing;
            } catch {
                // start a replacement thread when resume fails
            }
        }
        const started = await this.client.request("thread/start", threadParams(this.paths.workspace, this.mcpConfig())) as ThreadResult;
        const id = started.thread?.id;
        if (!id) throw new Error("Codex 未返回 thread");
        await input.store.bindCodexThread(input.ctx, input.conversationId, id);
        return id;
    }

    private waitForTurn(signal: AbortSignal, threadId: string, turnId: string) {
        return new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (error?: Error) => {
                if (settled) return;
                settled = true;
                this.turnWaiter = null;
                signal.removeEventListener("abort", onAbort);
                if (error) reject(error);
                else if (signal.aborted) reject(new AppError("运行已停止", 409, "run_aborted"));
                else resolve();
            };
            const onAbort = () => finish();
            signal.addEventListener("abort", onAbort, { once: true });
            this.turnWaiter = (method, params) => {
                if (!isTurnTerminal(method, params, threadId, turnId)) return;
                finish(method === "turn/failed" ? new Error("Agent 运行失败") : undefined);
            };
        });
    }

    private mcpConfig() {
        return {
            model_reasoning_summary: "auto",
            mcp_servers: {
                "coresearch-canvas": {
                    command: this.config.mcp.command,
                    args: this.config.mcp.args,
                    env: {
                        CORESEARCH_RUNTIME_URL: this.config.mcp.loopbackUrl,
                        CORESEARCH_RUNTIME_TOKEN: this.token,
                    },
                    default_tools_approval_mode: "approve",
                },
            },
        };
    }
}

function threadParams(cwd: string, config: JsonObject, threadId?: string) {
    return {
        ...(threadId ? { threadId } : { threadSource: "user" }),
        cwd,
        sandbox: "read-only",
        approvalPolicy: "on-request",
        config,
    };
}

function isTurnTerminal(method: string, params: unknown, threadId: string, turnId: string) {
    if (method !== "turn/completed" && method !== "turn/failed") return false;
    const value = params && typeof params === "object" ? params as JsonObject : {};
    const turn = value.turn && typeof value.turn === "object" ? value.turn as JsonObject : {};
    const completedId = typeof turn.id === "string" ? turn.id : typeof value.turnId === "string" ? value.turnId : "";
    const completedThread = typeof value.threadId === "string" ? value.threadId : threadId;
    return completedThread === threadId && completedId === turnId;
}

export function runtimeKey(ctx: Pick<RequestContext, "userId" | "projectId">) {
    return `${ctx.userId}:${ctx.projectId}`;
}
