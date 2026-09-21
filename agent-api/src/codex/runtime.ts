import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

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
    conversationId: string;
    runId: string;
    threadId: string;
    signal: AbortSignal;
    emit: (event: AdapterEvent) => Promise<void>;
};

type ThreadResult = { thread?: { id?: string } };
type TurnResult = { turn?: { id?: string } };

export class CodexRuntimeAdapter implements RuntimeAdapter {
    private readonly runtimes = new Map<string, Promise<CodexRuntime>>();
    private readonly live = new Map<string, CodexRuntime>();
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
        const runtime = this.live.get(claims.runtimeId);
        if (!runtime || claims.runtimeId !== runtimeKey(claims) || runtime.instanceId !== claims.instanceId) {
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
        const runtime = this.live.get(claims.runtimeId);
        if (!runtime) throw new AppError("运行时 token 无效", 401, "invalid_runtime_token");
        return runtime.applyCanvas(claims, operations, summary);
    }

    private getOrCreate(ctx: RequestContext) {
        const id = runtimeKey(ctx);
        const existing = this.runtimes.get(id);
        if (existing) return existing;
        const created = this.spawn(ctx, id).catch((error) => {
            this.runtimes.delete(id);
            this.live.delete(id);
            throw error;
        });
        this.runtimes.set(id, created);
        return created;
    }

    private async spawn(ctx: RequestContext, id: string) {
        const paths = projectRuntimePaths(this.config.runtimeRoot, ctx);
        await mkdir(paths.workspace, { recursive: true });
        await mkdir(paths.codexHome, { recursive: true });
        await mkdir(paths.tmp, { recursive: true });
        const instanceId = randomUUID();
        const token = this.config.tokens.create({ ...ctx, runtimeId: id, instanceId });
        const transport = await this.createTransport({ ctx, paths, token, runtimeId: id });
        const runtime = new CodexRuntime(ctx, paths, this.config, instanceId, transport);
        runtime.onClosed(() => {
            if (this.live.get(id) !== runtime) return;
            this.live.delete(id);
            this.runtimes.delete(id);
        });
        await runtime.initialize();
        this.live.set(id, runtime);
        return runtime;
    }
}

export class CodexRuntime {
    private readonly client: CodexJsonRpcClient;
    private readonly turns = new Map<string, ActiveTurn>();
    private readonly turnsByThread = new Map<string, ActiveTurn>();
    private readonly pendingTurns = new Map<string, (error?: Error) => void>();
    private readonly completedTurns = new Map<string, Error | null>();
    private closeHandler: (() => void) | null = null;

    constructor(
        readonly ctx: RequestContext,
        readonly paths: ProjectRuntimePaths,
        private readonly config: CodexRuntimeConfig,
        readonly instanceId: string,
        transport: CodexTransport,
    ) {
        this.client = new CodexJsonRpcClient(transport);
        this.client.onNotification((method, params) => {
            const turn = turnForNotification(this.turns, this.turnsByThread, params);
            if (turn) {
                const event = mapCodexNotification(method, params);
                if (event) void turn.emit(event);
            }
            this.dispatchTerminal(method, params);
        });
        this.client.onServerRequest((id, method) => {
            this.client.respond(id, { decision: /mcp/i.test(method) ? "approve" : "decline" });
        });
        this.client.onClosed(() => {
            for (const finish of [...this.pendingTurns.values()]) finish(new Error("Codex runtime 已退出"));
            this.turns.clear();
            this.turnsByThread.clear();
            this.closeHandler?.();
        });
    }

    onClosed(handler: () => void) {
        this.closeHandler = handler;
    }

    async initialize() {
        await this.client.request("initialize", {
            clientInfo: { name: "agent-api", title: "Research Canvas Agent API", version: "0.1.0" },
            capabilities: { experimentalApi: true, requestAttestation: false },
        });
        this.client.notify("initialized");
    }

    async runTurn(input: RuntimeExecutionInput) {
        const turn: ActiveTurn = { conversationId: input.conversationId, runId: input.runId, threadId: "", signal: input.signal, emit: input.emit };
        this.turns.set(input.conversationId, turn);
        let turnId = "";
        const onAbort = () => {
            if (turn.threadId && turnId) void this.client.request("turn/interrupt", { threadId: turn.threadId, turnId }).catch(() => {});
        };
        input.signal.addEventListener("abort", onAbort, { once: true });
        try {
            const conversation = await input.store.readConversation(input.ctx, input.conversationId);
            turn.threadId = await this.ensureThread(input, conversation.codexThreadId);
            this.turnsByThread.set(turn.threadId, turn);
            const started = await this.client.request("turn/start", {
                threadId: turn.threadId,
                input: [{ type: "text", text: input.prompt, text_elements: [] }],
                approvalPolicy: "on-request",
                sandboxPolicy: { type: "readOnly" },
            }) as TurnResult;
            turnId = started.turn?.id || "";
            if (!turnId) throw new Error("Codex 未返回 turn");
            await input.store.bindCodexTurn(input.ctx, input.conversationId, input.runId, turnId);
            await this.waitForTurn(input.signal, turn.threadId, turnId);
        } finally {
            input.signal.removeEventListener("abort", onAbort);
            this.turns.delete(input.conversationId);
            if (turn.threadId) this.turnsByThread.delete(turn.threadId);
        }
    }

    async applyCanvas(claims: RuntimeTokenClaims, operations: unknown[], summary: string) {
        const turn = claims.conversationId ? this.turns.get(claims.conversationId) : undefined;
        if (!turn) throw new AppError("当前没有正在运行的 Agent turn", 409, "run_not_active");
        const mutation = this.config.canvas.requestMutation(this.ctx, turn.signal);
        await turn.emit({
            type: "canvas.tool.requested",
            itemId: mutation.callId,
            payload: { callId: mutation.callId, summary, operations },
        });
        return mutation.result;
    }

    private async ensureThread(input: RuntimeExecutionInput, existing: string | null) {
        const params = threadParams(this.paths.workspace, this.mcpConfig(input.conversationId), existing || undefined);
        if (existing) {
            const resumed = await this.client.request("thread/resume", params) as ThreadResult;
            return resumed.thread?.id || existing;
        }
        const started = await this.client.request("thread/start", params) as ThreadResult;
        const id = started.thread?.id;
        if (!id) throw new Error("Codex 未返回 thread");
        await input.store.bindCodexThread(input.ctx, input.conversationId, id);
        return id;
    }

    private waitForTurn(signal: AbortSignal, threadId: string, turnId: string) {
        const key = `${threadId}:${turnId}`;
        return new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (error?: Error) => {
                if (settled) return;
                settled = true;
                this.pendingTurns.delete(key);
                signal.removeEventListener("abort", onAbort);
                if (error) reject(error);
                else if (signal.aborted) reject(new AppError("运行已停止", 409, "run_aborted"));
                else resolve();
            };
            const onAbort = () => finish();
            signal.addEventListener("abort", onAbort, { once: true });
            if (this.completedTurns.has(key)) {
                finish(this.completedTurns.get(key) || undefined);
                return;
            }
            this.pendingTurns.set(key, finish);
        });
    }

    private dispatchTerminal(method: string, params: unknown) {
        const terminal = terminalTurn(method, params);
        if (!terminal) return;
        const key = `${terminal.threadId}:${terminal.turnId}`;
        const error = method === "turn/failed" ? new Error("Agent 运行失败") : null;
        this.completedTurns.set(key, error);
        this.pendingTurns.get(key)?.(error || undefined);
    }

    private mcpConfig(conversationId: string) {
        return {
            mcp_servers: {
                "coresearch-canvas": {
                    command: this.config.mcp.command,
                    args: this.config.mcp.args,
                    env: {
                        CORESEARCH_RUNTIME_URL: this.config.mcp.loopbackUrl,
                        CORESEARCH_RUNTIME_TOKEN: this.config.tokens.create({ ...this.ctx, runtimeId: runtimeKey(this.ctx), instanceId: this.instanceId, conversationId }),
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

function terminalTurn(method: string, params: unknown) {
    if (method !== "turn/completed" && method !== "turn/failed") return null;
    const value = params && typeof params === "object" ? params as JsonObject : {};
    const turn = value.turn && typeof value.turn === "object" ? value.turn as JsonObject : {};
    const turnId = typeof turn.id === "string" ? turn.id : typeof value.turnId === "string" ? value.turnId : "";
    const threadId = typeof value.threadId === "string" ? value.threadId : "";
    if (!turnId || !threadId) return null;
    return { threadId, turnId };
}

function turnForNotification(turns: Map<string, ActiveTurn>, byThread: Map<string, ActiveTurn>, params: unknown) {
    const value = params && typeof params === "object" ? params as JsonObject : {};
    const threadId = typeof value.threadId === "string" ? value.threadId : "";
    if (threadId && byThread.has(threadId)) return byThread.get(threadId);
    if (turns.size === 1) return [...turns.values()][0];
    return undefined;
}

export function runtimeKey(ctx: Pick<RequestContext, "userId" | "projectId">) {
    return `${ctx.userId}:${ctx.projectId}`;
}
