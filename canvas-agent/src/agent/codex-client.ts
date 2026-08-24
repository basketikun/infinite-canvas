import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAgentLogWriter } from "../utils/agent-runtime.js";
import { VERSION } from "../config.js";
import { logger } from "../utils/logger.js";
import { field, type JsonRecord } from "../utils/value.js";
import { codexEventHistory, type CodexEventHistory } from "./codex-event-history.js";
import type { CodexNotificationParams, CodexPlanUpdate, CodexReasoningEffort, CodexRequestMethod, CodexRequestParams, CodexRequestResult, CodexSkillSelector, CodexTurnInput } from "./codex-protocol.js";
import type { AgentEmit, AgentPermissionMode } from "./types.js";

type AgentEvent = JsonRecord & { type: string; usage?: unknown };
type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void; silent?: boolean };
type ActiveTurn = PendingRequest & { threadId: string; turnId: string; prompt: string; messageText?: string };
type ItemDeltaParams = { threadId: string; turnId: string; itemId: string; delta: string; summaryIndex?: number };
type PendingDelta = { delta: string; itemType: string; params: ItemDeltaParams; timer: ReturnType<typeof setTimeout> };
type ApprovalRequest = { id: number; method: string; params: JsonRecord; decision?: string };
type PendingTurnStart = { threadId: string; prompt: string; messageText?: string; turnId?: string; onTurn?: (turnId: string) => void };

const canvasAgentMcp = canvasAgentMcpCommand();
const require = createRequire(import.meta.url);
const STREAM_UPDATE_INTERVAL_MS = 40;
const supplementalItemTypes = new Set(["agent_message", "reasoning", "plan", "mcp_tool_call", "command_execution", "file_change", "dynamic_tool_call", "collab_tool_call", "web_search", "image_view", "image_generation", "context_compaction"]);
const SKILL_DRAFT_INSTRUCTIONS = "你只负责根据已提供的对话或画布快照生成可编辑的 Codex Skill 草稿。不要调用任何工具，不要执行命令，不要读取文件，不要访问网络，不要修改任何状态。严格按 outputSchema 返回结果，并排除凭证、密钥、Token、本地路径、临时错误、调试日志和一次性结果。";

/** 表示错误已经通过 app-server 终态或进程事件通知过网页。 */
export class CodexReportedError extends Error {
    override name = "CodexReportedError";
}

/** 封装 Codex app-server 的 JSON-RPC 通信与事件转换。 */
export class CodexAppClient {
    private nextId = 1;
    private buffer = "";
    private currentThreadId = "";
    private currentTurnId = "";
    private pendingTurnStart?: PendingTurnStart;
    private startedTurnKeys = new Set<string>();
    private textByItem = new Map<string, string>();
    private reasoningTextByItem = new Map<string, Map<number, string>>();
    private lastUsage: unknown = null;
    private pending = new Map<number, PendingRequest>();
    private activeTurns = new Map<string, ActiveTurn>();
    private completedTurns = new Map<string, Error | null>();
    private completedTurnResults = new Map<string, unknown>();
    private pendingDeltas = new Map<string, PendingDelta>();
    private startedItems = new Map<string, JsonRecord>();
    private itemSequences = new Map<string, number>();
    private nextItemSequences = new Map<string, number>();
    private plansByTurn = new Map<string, CodexPlanUpdate>();
    private approvalRequests = new Map<string, ApprovalRequest>();
    private finalizingTurns = new Map<string, Promise<void>>();
    private skillReloads = new Map<string, Promise<CodexRequestResult<"skills/list">>>();
    private silentThreadIds = new Set<string>();
    private structuredOutputByTurn = new Map<string, string>();
    private pendingSilentThreadStarts = new Set<symbol>();
    private pendingThreadStartedNotifications: JsonRecord[] = [];
    private pendingPreheatThreadStarts = 0;
    private preheatingThreadIds = new Set<string>();
    private failing = false;
    private failureMessage = "";

    /** 保存 app-server 子进程和事件出口。 */
    private constructor(private child: ChildProcess, private emit: AgentEmit, private eventHistory: Pick<CodexEventHistory, "record" | "recordTurn"> = codexEventHistory) {}

    /** 启动并初始化 Codex app-server。 */
    static async start(emit: AgentEmit, onExit: () => void) {
        logger.info("Starting Codex app-server", { executable: process.execPath, codex: codexBin() });
        const child = spawn(process.execPath, [codexBin(), "app-server", "--stdio"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
        const client = new CodexAppClient(child, emit);
        let stopped = false;
        const stop = () => {
            if (stopped) return;
            stopped = true;
            onExit();
        };
        child.stdout?.on("data", (chunk) => client.read(chunk.toString()));
        const stderr = createAgentLogWriter((text) => {
            logger.warn("Codex app-server stderr", { text });
            emit("agent_log", { text });
        }, (text) => text.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+/, ""));
        child.stderr?.on("data", (chunk) => {
            if (client.skillDraftActive) return stderr.clear();
            stderr.write(chunk.toString());
        });
        child.on("error", (error) => {
            stderr.flush();
            logger.error("Codex app-server process error", error);
            emit("agent_error", { message: error.message });
            client.failAll(error.message, true);
            stop();
        });
        child.on("exit", (code) => {
            stderr.flush();
            logger.warn("Codex app-server exited", { code });
            client.failAll(`Codex app-server exited: ${code ?? 0}`);
            stop();
            emit("agent_log", { text: `Codex app-server exited: ${code ?? 0}` });
        });
        await client.request("initialize", { clientInfo: { name: "canvas-agent", title: "Infinite Canvas Agent", version: VERSION }, capabilities: { experimentalApi: true, requestAttestation: false } });
        client.notify("initialized");
        return client;
    }

    /** 创建新的 Codex 线程。 */
    async startThread(cwd?: string, permissionMode: AgentPermissionMode = "request", preheat = false) {
        if (preheat) this.pendingPreheatThreadStarts += 1;
        let threadId = "";
        try {
            const { thread } = await this.request("thread/start", { ...threadSettings(permissionMode), ...(cwd ? { cwd } : {}), threadSource: "user" });
            if (!thread.id) throw new Error("Codex app-server 没有返回 thread id");
            threadId = thread.id;
            if (preheat) {
                this.preheatingThreadIds.add(threadId);
                await this.completeMcpPreheat(threadId);
            }
            return thread;
        } finally {
            if (preheat) this.pendingPreheatThreadStarts -= 1;
            if (threadId) this.preheatingThreadIds.delete(threadId);
        }
    }

    /** 创建不会持久化或向网页广播的草稿线程。 */
    async startSkillDraftThread(cwd: string) {
        return await this.startSilentThread("thread/start", { ...skillDraftThreadSettings(cwd), threadSource: "user" });
    }

    /** 从指定对话派生不会持久化或向网页广播的草稿线程。 */
    async forkSkillDraftThread(threadId: string, cwd: string) {
        return await this.startSilentThread("thread/fork", { ...skillDraftThreadSettings(cwd), threadId, threadSource: "user" });
    }

    /** 恢复已有 Codex 线程。 */
    async resumeThread(threadId: string, cwd?: string, permissionMode: AgentPermissionMode = "request", preheat = false) {
        if (preheat) this.pendingPreheatThreadStarts += 1;
        try {
            if (preheat) this.preheatingThreadIds.add(threadId);
            const { thread } = await this.request("thread/resume", { threadId, ...threadSettings(permissionMode), ...(cwd ? { cwd } : {}) });
            if (!thread.id) throw new Error("Codex app-server 没有返回 thread id");
            if (preheat) await this.completeMcpPreheat(thread.id);
            return thread;
        } finally {
            if (preheat) this.pendingPreheatThreadStarts -= 1;
            if (preheat) this.preheatingThreadIds.delete(threadId);
        }
    }

    /** 以 app-server 的权威 MCP 清单响应作为预热完成边界。 */
    private async completeMcpPreheat(threadId: string) {
        const result = await this.request("mcpServerStatus/list", { threadId, limit: 100, detail: "toolsAndAuthOnly" });
        this.emit("agent_bootstrap", { type: "mcp.complete", phase: "preheat", threadId, services: result.data.map(({ name, authStatus }) => ({ name, authStatus })) });
    }

    /** 查询 Codex 线程列表。 */
    listThreads(params: CodexRequestParams<"thread/list">) {
        return this.request("thread/list", params);
    }

    /** 读取指定 Codex 线程。 */
    readThread(threadId: string, includeTurns = true) {
        return this.request("thread/read", { threadId, includeTurns });
    }

    /** 归档指定 Codex 线程。 */
    archiveThread(threadId: string) {
        return this.request("thread/archive", { threadId });
    }

    /** 释放临时草稿线程的 App Server 订阅和进程内缓存。 */
    async closeSkillDraftThread(threadId: string) {
        try {
            if (!this.failing) await this.request("thread/unsubscribe", { threadId }, true);
        } finally {
            this.silentThreadIds.delete(threadId);
            const prefix = `${threadId}\0`;
            [...this.structuredOutputByTurn.keys()].filter((key) => key.startsWith(prefix)).forEach((key) => this.structuredOutputByTurn.delete(key));
        }
    }

    /** 查询当前账号可用的 Codex 模型。 */
    listModels() {
        return this.request("model/list", { limit: 100, includeHidden: false });
    }

    /** 查询指定工作空间可发现的 Codex Skills。 */
    listSkills(cwd: string, forceReload = false) {
        if (!forceReload) return this.request("skills/list", { cwds: [cwd] });
        const key = process.platform === "win32" ? path.resolve(cwd).toLowerCase() : path.resolve(cwd);
        const current = this.skillReloads.get(key);
        if (current) return current;
        const reload = this.request("skills/list", { cwds: [cwd], forceReload: true });
        this.skillReloads.set(key, reload);
        const clear = () => {
            if (this.skillReloads.get(key) === reload) this.skillReloads.delete(key);
        };
        void reload.then(clear, clear);
        return reload;
    }

    /** 修改一个已发现 Skill 的启用状态。 */
    setSkillEnabled(path: string, enabled: boolean) {
        return this.request("skills/config/write", { path, enabled });
    }

    /** 返回指定线程在当前进程中收到的最新任务计划。 */
    planUpdates(threadId: string) {
        return [...this.plansByTurn.values()].filter((item) => item.threadId === threadId);
    }

    /** 清理已归档线程的任务计划缓存。 */
    clearPlanUpdates(threadId: string) {
        this.plansByTurn.forEach((item, key) => {
            if (item.threadId === threadId) this.plansByTurn.delete(key);
        });
    }

    /** 启动一个 Codex turn 并等待完成通知。 */
    async startTurn(threadId: string, prompt: string, images: string[], permissionMode: AgentPermissionMode, model?: string, effort?: CodexReasoningEffort, onTurn?: (turnId: string) => void, skill?: CodexSkillSelector, messageText?: string, outputSchema?: JsonRecord) {
        this.preheatingThreadIds.delete(threadId);
        this.currentThreadId = threadId;
        this.currentTurnId = "";
        this.lastUsage = null;
        const pendingStart: PendingTurnStart = { threadId, prompt, messageText, onTurn };
        this.pendingTurnStart = pendingStart;
        try {
            const { turn } = await this.request("turn/start", { threadId, input: codexInput(prompt, images, skill), ...(outputSchema ? skillDraftTurnSettings() : turnSettings(permissionMode)), ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(outputSchema ? { outputSchema } : {}) }, Boolean(outputSchema));
            const turnId = turn.id;
            if (!turnId) throw new Error("Codex app-server 没有返回 turn id");
            pendingStart.turnId = turnId;
            this.currentTurnId = turnId;
            this.notifyTurnStarted(threadId, turnId, pendingStart);
            const turnKey = turnCacheKey(threadId, turnId);
            const completed = this.completedTurns.get(turnKey);
            if (this.completedTurns.has(turnKey)) {
                this.completedTurns.delete(turnKey);
                const result = this.completedTurnResults.get(turnKey);
                this.completedTurnResults.delete(turnKey);
                this.currentThreadId = "";
                this.currentTurnId = "";
                if (completed) throw completed;
                return result;
            }
            return await new Promise((resolve, reject) => this.activeTurns.set(turnKey, { resolve, reject, threadId, turnId, prompt, messageText }));
        } catch (error) {
            if (!this.currentTurnId) this.currentThreadId = "";
            throw error;
        } finally {
            if (this.pendingTurnStart === pendingStart) this.pendingTurnStart = undefined;
            if (pendingStart.turnId) this.startedTurnKeys.delete(turnCacheKey(threadId, pendingStart.turnId));
        }
    }

    /** 在静默线程中生成结构化输出。 */
    async generateSkillDraft(threadId: string, prompt: string, outputSchema: JsonRecord, model?: string, effort?: CodexReasoningEffort) {
        this.silentThreadIds.add(threadId);
        const result = await this.startTurn(threadId, prompt, [], "request", model, effort, undefined, undefined, undefined, outputSchema);
        const output = String(field(result, "output") || "").trim();
        if (!output) throw new Error("Codex 没有返回 Skill 草稿");
        return output;
    }

    /** 中断当前正在运行且属于指定线程的 Codex turn。 */
    async interruptCurrentTurn(requestedThreadId?: string) {
        const threadId = this.currentThreadId;
        const turnId = this.currentTurnId;
        if (!threadId || !turnId || (requestedThreadId && requestedThreadId !== threadId)) return false;
        try {
            logger.warn("Interrupting active Codex turn", { threadId, turnId });
            await this.request("turn/interrupt", { threadId, turnId });
            return true;
        } catch (error) {
            logger.warn("Failed to interrupt Codex turn", { error, threadId, turnId });
            return false;
        }
    }

    /** 回复网页端已经确认的 Codex 权限请求。 */
    resolveApproval(requestId: string, decision: string) {
        const request = this.approvalRequests.get(requestId);
        if (!request) return false;
        if (request.decision) return true;
        request.decision = decision;
        const permissions = field(request.params, "permissions") || field(request.params, "requestedPermissions");
        const accepted = decision === "accept" || decision === "acceptForSession";
        const result = request.method === "item/permissions/requestApproval"
            ? { permissions: accepted ? permissions || {} : {}, scope: decision === "acceptForSession" ? "session" : "turn" }
            : { decision };
        this.write({ id: request.id, result });
        return true;
    }

    /** 标记下一次临时线程创建，使早于请求响应到达的通知也不会外泄。 */
    private async startSilentThread<Method extends "thread/start" | "thread/fork">(method: Method, params: CodexRequestParams<Method>) {
        const pendingStart = Symbol();
        this.pendingSilentThreadStarts.add(pendingStart);
        try {
            const result = await this.request(method, params, true);
            const thread = result.thread;
            if (!thread.id) throw new Error("Codex app-server 没有返回 thread id");
            this.silentThreadIds.add(thread.id);
            return thread;
        } finally {
            this.pendingSilentThreadStarts.delete(pendingStart);
            if (!this.pendingSilentThreadStarts.size) this.flushPendingThreadStartedNotifications();
        }
    }

    /** 发送 JSON-RPC 请求并保存待处理 Promise。 */
    private request<Method extends CodexRequestMethod>(method: Method, params: CodexRequestParams<Method>, silent = false) {
        if (this.failing) return Promise.reject(new CodexReportedError(this.failureMessage || "Codex app-server 已停止")) as Promise<CodexRequestResult<Method>>;
        const id = this.nextId++;
        this.write({ id, method, params }, silent);
        return new Promise<CodexRequestResult<Method>>((resolve, reject) => this.pending.set(id, { resolve: (result) => resolve(result as CodexRequestResult<Method>), reject, silent }));
    }

    /** 发送无需响应的 JSON-RPC 通知。 */
    private notify(method: string, params?: unknown) {
        this.write(params === undefined ? { method } : { method, params });
    }

    /** 将 JSON-RPC 消息写入 app-server 标准输入。 */
    private write(value: unknown, silent = false) {
        const method = String(field(value, "method") || "");
        const params = field(value, "params");
        if (method && !silent) logger.debug(`Codex ${method}`, { id: field(value, "id"), threadId: field(params, "threadId") });
        this.child.stdin?.write(`${JSON.stringify(value)}\n`);
    }

    /** 按行解析 app-server 标准输出。 */
    private read(chunk: string) {
        this.buffer += chunk;
        const lines = this.buffer.split(/\r?\n/);
        this.buffer = lines.pop() || "";
        lines.filter(Boolean).forEach((line) => {
            try {
                this.handle(JSON.parse(line) as JsonRecord);
            } catch (error) {
                if (!this.skillDraftActive) {
                    logger.warn("Invalid Codex app-server output", { error, line });
                    this.emit("agent_log", { text: line });
                }
            }
        });
    }

    /** 分派单条 JSON-RPC 响应、请求或通知。 */
    private handle(message: JsonRecord) {
        const id = Number(message.id);
        if (message.error && this.pending.has(id)) {
            const error = String(field(message.error, "message") || "Codex request failed");
            if (!this.pending.get(id)?.silent) {
                if (/not materialized yet.*includeTurns/i.test(error)) logger.debug("Codex thread has no messages yet", { id });
                else logger.warn("Codex request failed", { id, error });
            }
            return this.reject(id, error);
        }
        if (this.pending.has(id)) return this.resolve(id, message.result);
        if (typeof message.method === "string" && "id" in message) return this.answerServerRequest(message);
        if (typeof message.method === "string") this.handleNotification(message.method, (message.params || {}) as JsonRecord);
    }

    /** 转换并广播 app-server 通知。 */
    private handleNotification(method: string, params: JsonRecord) {
        if (this.handleSilentNotification(method, params)) return;
        if (method === "skills/changed") {
            this.emit("skills_changed", {});
            return;
        }
        if (method === "serverRequest/resolved") {
            const requestId = String(field(params, "requestId") || "");
            const request = requestId ? this.approvalRequests.get(requestId) : undefined;
            if (request) {
                this.approvalRequests.delete(requestId);
                this.emit("codex_approval_resolved", { ...request.params, ...params, requestId, decision: request.decision });
            }
            return;
        }
        if (method === "mcpServer/startupStatus/updated") {
            const value = params as unknown as CodexNotificationParams<"mcpServer/startupStatus/updated">;
            const threadId = value.threadId || this.currentThreadId;
            this.emit("agent_bootstrap", {
                type: "mcp.startup",
                phase: this.pendingPreheatThreadStarts > 0 || this.preheatingThreadIds.has(threadId) ? "preheat" : "runtime",
                threadId,
                name: value.name,
                status: value.status,
                error: value.error,
                failureReason: value.failureReason,
            });
            return;
        }
        const turnEvent = method.startsWith("turn/") || method.startsWith("item/") || method === "thread/tokenUsage/updated" || method === "error";
        if (turnEvent) {
            const threadId = String(field(params, "threadId") || this.currentThreadId);
            const turnId = String(field(params, "turnId") || field(field(params, "turn"), "id") || this.currentTurnId);
            if (method === "turn/started") {
                this.currentThreadId = threadId;
                this.currentTurnId = turnId;
                this.notifyTurnStarted(threadId, turnId);
            }
            params = { ...params, ...(threadId ? { threadId } : {}), ...(turnId ? { turnId } : {}) };
        }
        if (method === "item/agentMessage/delta") {
            const value = params as unknown as CodexNotificationParams<"item/agentMessage/delta">;
            return this.emitDelta("agent_message", value);
        }
        if (method === "item/plan/delta") return this.emitDelta("plan", params as unknown as CodexNotificationParams<"item/plan/delta">);
        if (method === "item/reasoning/summaryTextDelta") return this.emitDelta("reasoning", params as unknown as CodexNotificationParams<"item/reasoning/summaryTextDelta">);
        if (method === "item/commandExecution/outputDelta") return this.emitDelta("command_execution", params as unknown as CodexNotificationParams<"item/commandExecution/outputDelta">);
        if (method === "turn/plan/updated") {
            const value = params as unknown as CodexNotificationParams<"turn/plan/updated">;
            const update: CodexPlanUpdate = { ...value, threadId: value.threadId || "" };
            if (update.threadId && update.turnId) this.plansByTurn.set(turnCacheKey(update.threadId, update.turnId), update);
            params = update as unknown as JsonRecord;
        }
        if (method === "thread/tokenUsage/updated") {
            this.lastUsage = normalizeUsage(params as unknown as CodexNotificationParams<"thread/tokenUsage/updated">);
            this.emit("agent_event", { agent: "codex", type: "usage.updated", usage: this.lastUsage, ...codexEventScope(params) });
            return;
        }
        const event = normalizeCodexNotification(method, params);
        if (!event) return;
        const eventScope = codexEventScope(params);
        if (event.type === "item.started" || event.type === "item.completed") {
            const item = field(event, "item") as JsonRecord | undefined;
            const id = String(field(item, "id") || "");
            const threadId = String(field(event, "thread_id") || this.currentThreadId);
            const turnId = String(field(event, "turn_id") || this.currentTurnId);
            const key = itemCacheKey({ threadId, turnId, itemId: id });
            if (id && threadId && turnId && event.type === "item.started") {
                this.assignItemSequence(threadId, turnId, id);
                this.startedItems.set(key, item || {});
            }
            if (id && event.type === "item.completed") {
                const started = this.startedItems.get(key);
                if (started) event.item = mergeDefinedRecord(started, item || {});
                this.startedItems.delete(key);
            }
        }
        if (event.type === "item.completed") {
            const item = field(event, "item") as JsonRecord | undefined;
            const id = String(field(item, "id") || "");
            const key = itemCacheKey({ threadId: String(field(event, "thread_id") || this.currentThreadId), turnId: String(field(event, "turn_id") || this.currentTurnId), itemId: id });
            this.flushDelta(key);
            const streamedText = this.textByItem.get(key);
            if ((item?.type === "agent_message" || item?.type === "plan") && streamedText && !String(item.text || "").trim()) item.text = streamedText;
            if (item?.type === "reasoning" && streamedText && !readableCodexText(field(item, "summary"))) item.summary = streamedText;
            if (item?.type === "command_execution" && streamedText && !String(item.aggregatedOutput || "").trim()) item.aggregatedOutput = streamedText;
            const threadId = String(field(event, "thread_id") || this.currentThreadId);
            const turnId = String(field(event, "turn_id") || this.currentTurnId);
            if (id && threadId && turnId && item && supplementalItemTypes.has(String(item.type || ""))) {
                const sequence = this.assignItemSequence(threadId, turnId, id);
                void this.eventHistory.record({ threadId, turnId, itemId: id, sequence, item }).catch((error) => logger.warn("Failed to persist Codex event history", { threadId, turnId, itemId: id, error }));
            }
            if (id) {
                this.textByItem.delete(key);
                this.reasoningTextByItem.delete(key);
            }
        }
        let turnPersistence: Promise<void> | undefined;
        if (event.type === "turn.completed") {
            const turn = field(params, "turn");
            const turnId = String(field(turn, "id") || field(params, "turnId") || "");
            const threadId = String(field(params, "threadId") || field(event, "thread_id") || "");
            const planKey = turnCacheKey(threadId, turnId);
            const plan = this.plansByTurn.get(planKey);
            if (plan) this.plansByTurn.set(planKey, { ...plan, turnStatus: String(field(turn, "status") || "completed") });
            if (threadId && turnId) {
                const pendingStart = this.pendingTurnStart?.threadId === threadId && (!this.pendingTurnStart.turnId || this.pendingTurnStart.turnId === turnId) ? this.pendingTurnStart : undefined;
                const turnRecord = {
                    ...(turn && typeof turn === "object" && !Array.isArray(turn) ? turn as JsonRecord : { id: turnId, status: field(turn, "status") || "completed" }),
                    ...(pendingStart?.prompt ? { input: pendingStart.prompt } : {}),
                    ...(pendingStart?.messageText ? { messageText: pendingStart.messageText } : {}),
                };
                turnPersistence = this.eventHistory.recordTurn({ threadId, turnId, turn: turnRecord }).catch((error) => logger.warn("Failed to persist Codex turn history", { threadId, turnId, error }));
                this.finalizingTurns.set(planKey, turnPersistence);
            }
            this.finishTurnDeltas(threadId, turnId);
        }
        if (event.type === "turn.completed") {
            event.usage = this.lastUsage;
            const complete = () => this.completeTurn(event, params, eventScope);
            if (turnPersistence) void turnPersistence.then(complete);
            else complete();
            return;
        }
        this.emit("agent_event", { agent: "codex", ...event });
    }

    /** 草稿线程存续期间隐藏 app-server 自身输出，避免混入网页诊断日志。 */
    private get skillDraftActive() {
        return this.pendingSilentThreadStarts.size > 0 || this.silentThreadIds.size > 0;
    }

    /** 消化临时草稿线程事件，不广播、不落补充历史。 */
    private handleSilentNotification(method: string, params: JsonRecord) {
        if (method === "thread/started") {
            const thread = field(params, "thread");
            const threadId = String(field(thread, "id") || "");
            if (!threadId) return false;
            if (this.silentThreadIds.has(threadId)) return true;
            if (!this.pendingSilentThreadStarts.size) return false;
            this.pendingThreadStartedNotifications.push(params);
            return true;
        }
        if (!(method === "error" || method.startsWith("turn/") || method.startsWith("item/") || method === "thread/tokenUsage/updated")) return false;
        const threadId = String(field(params, "threadId") || this.currentThreadId);
        if (!threadId || !this.silentThreadIds.has(threadId)) return false;
        const turnId = String(field(params, "turnId") || field(field(params, "turn"), "id") || this.currentTurnId);
        if (method === "turn/started") {
            this.currentThreadId = threadId;
            this.currentTurnId = turnId;
            this.notifyTurnStarted(threadId, turnId);
            return true;
        }
        if (method === "item/agentMessage/delta") {
            const itemId = String(field(params, "itemId") || "");
            if (itemId && turnId) {
                const key = itemCacheKey({ threadId, turnId, itemId });
                this.textByItem.set(key, `${this.textByItem.get(key) || ""}${String(field(params, "delta") || "")}`);
            }
            return true;
        }
        if (method === "item/completed") {
            const item = normalizeItem(field(params, "item"));
            const itemId = String(field(item, "id") || "");
            const key = itemCacheKey({ threadId, turnId, itemId });
            if (item.type === "agent_message" && turnId) {
                const text = String(item.text || this.textByItem.get(key) || "").trim();
                if (text) this.structuredOutputByTurn.set(turnCacheKey(threadId, turnId), text);
            }
            if (itemId) this.textByItem.delete(key);
            return true;
        }
        if (method !== "turn/completed") return true;
        const turn = field(params, "turn") as CodexNotificationParams<"turn/completed">["turn"];
        const completedTurnId = String(field(turn, "id") || turnId);
        const turnKey = turnCacheKey(threadId, completedTurnId);
        const output = this.structuredOutputByTurn.get(turnKey) || "";
        this.structuredOutputByTurn.delete(turnKey);
        this.finishTurnDeltas(threadId, completedTurnId);
        const failure = turn.error ? new CodexReportedError(turn.error.message || "Codex turn failed") : null;
        const pending = this.activeTurns.get(turnKey);
        const result = { output };
        if (pending) {
            this.activeTurns.delete(turnKey);
            failure ? pending.reject(failure) : pending.resolve(result);
        } else if (completedTurnId) {
            this.completedTurns.set(turnKey, failure);
            this.completedTurnResults.set(turnKey, result);
        }
        if (completedTurnId === this.currentTurnId) {
            this.currentThreadId = "";
            this.currentTurnId = "";
        }
        return true;
    }

    /** 请求响应确定静默线程 ID 后，重新分流早到的启动通知。 */
    private flushPendingThreadStartedNotifications() {
        const notifications = this.pendingThreadStartedNotifications.splice(0);
        notifications.forEach((params) => this.handleNotification("thread/started", params));
    }

    /** 补充历史落盘后再广播 turn 终态，确保界面完成状态可跨 Agent 重启恢复。 */
    private completeTurn(event: AgentEvent, params: JsonRecord, eventScope: ReturnType<typeof codexEventScope>) {
        const turn = (params as unknown as CodexNotificationParams<"turn/completed">).turn;
        const turnId = turn.id;
        const turnKey = turnCacheKey(String(field(params, "threadId") || field(event, "thread_id") || ""), turnId);
        this.finalizingTurns.delete(turnKey);
        this.emit("agent_event", { agent: "codex", ...event });
        const pending = this.activeTurns.get(turnKey);
        const error = turn.error;
        const failure = error ? new CodexReportedError(error.message || "Codex turn failed") : null;
        if (pending) {
            this.activeTurns.delete(turnKey);
            failure ? pending.reject(failure) : pending.resolve(event);
        } else if (turnId) {
            this.completedTurns.set(turnKey, failure);
        }
        if (turnId === this.currentTurnId) {
            this.currentThreadId = "";
            this.currentTurnId = "";
        }
        this.emit("agent_done", { agent: "codex", usage: event.usage, ...eventScope });
    }

    /** 合并并广播 Agent 文本或执行输出增量。 */
    private emitDelta(itemType: string, params: ItemDeltaParams) {
        params = { ...params, threadId: params.threadId || this.currentThreadId, turnId: params.turnId || this.currentTurnId };
        const key = itemCacheKey(params);
        this.textByItem.set(key, itemType === "reasoning" ? this.appendReasoningText(key, params) : `${this.textByItem.get(key) || ""}${params.delta}`);
        const pending = this.pendingDeltas.get(key);
        if (pending) {
            pending.delta += params.delta;
            pending.itemType = itemType;
            pending.params = params;
            return;
        }
        this.pendingDeltas.set(key, {
            delta: params.delta,
            itemType,
            params,
            timer: setTimeout(() => this.flushDelta(key), STREAM_UPDATE_INTERVAL_MS),
        });
    }

    /** 合并短时间内的文本增量，减少 SSE 传输和前端渲染次数。 */
    private flushDelta(key: string) {
        const pending = this.pendingDeltas.get(key);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pendingDeltas.delete(key);
        if (pending.delta) this.emit("agent_event", { agent: "codex", type: "item.updated", item: { id: pending.params.itemId, type: pending.itemType, delta: pending.delta }, ...codexEventScope(pending.params as unknown as JsonRecord) });
    }

    /** 按 Codex summaryIndex 保存 reasoning 分段，顺序与线程历史一致。 */
    private appendReasoningText(key: string, params: ItemDeltaParams) {
        const segments = this.reasoningTextByItem.get(key) || new Map<number, string>();
        this.reasoningTextByItem.set(key, segments);
        return appendReasoningDelta(segments, params.summaryIndex, params.delta);
    }

    /** turn 结束时发送最后一批增量并清理未收到 item.completed 的缓存。 */
    private finishTurnDeltas(threadId: string, turnId: string) {
        const prefix = `${turnCacheKey(threadId, turnId)}\0`;
        [...this.pendingDeltas.keys()].filter((key) => key.startsWith(prefix)).forEach((key) => this.flushDelta(key));
        [...this.textByItem.keys()].filter((key) => key.startsWith(prefix)).forEach((key) => this.textByItem.delete(key));
        [...this.reasoningTextByItem.keys()].filter((key) => key.startsWith(prefix)).forEach((key) => this.reasoningTextByItem.delete(key));
        [...this.startedItems.keys()].filter((key) => key.startsWith(prefix)).forEach((key) => this.startedItems.delete(key));
        [...this.itemSequences.keys()].filter((key) => key.startsWith(prefix)).forEach((key) => this.itemSequences.delete(key));
        this.nextItemSequences.delete(turnCacheKey(threadId, turnId));
    }

    /** 为一个 turn 内的 item 固定开始顺序，完成通知只更新内容。 */
    private assignItemSequence(threadId: string, turnId: string, itemId: string) {
        const key = itemCacheKey({ threadId, turnId, itemId });
        const existing = this.itemSequences.get(key);
        if (existing !== undefined) return existing;
        const turnKey = turnCacheKey(threadId, turnId);
        const sequence = (this.nextItemSequences.get(turnKey) || 0) + 1;
        this.nextItemSequences.set(turnKey, sequence);
        this.itemSequences.set(key, sequence);
        return sequence;
    }

    /** 在通知或 turn/start 响应到达时回调一次 turn 启动状态。 */
    private notifyTurnStarted(threadId: string, turnId: string, fallback?: PendingTurnStart) {
        if (!threadId || !turnId) return;
        const pending = this.pendingTurnStart;
        const registration = pending?.threadId === threadId && (!pending.turnId || pending.turnId === turnId) ? pending : fallback;
        if (registration && !registration.turnId) registration.turnId = turnId;
        const key = turnCacheKey(threadId, turnId);
        if (this.startedTurnKeys.has(key)) return;
        if (!registration) return;
        this.startedTurnKeys.add(key);
        registration.onTurn?.(turnId);
    }

    /** 自动回复 app-server 发起的授权或交互请求。 */
    private answerServerRequest(message: JsonRecord) {
        const method = String(message.method);
        const params = (field(message, "params") as JsonRecord) || {};
        const threadId = String(field(params, "threadId") || this.currentThreadId);
        if (this.silentThreadIds.has(threadId)) {
            const result = method === "item/permissions/requestApproval" ? { permissions: {}, scope: "turn" } : { decision: "decline" };
            this.write({ id: message.id, result });
            return;
        }
        if (["item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval"].includes(method)) {
            const requestId = String(message.id);
            this.approvalRequests.set(requestId, { id: Number(message.id), method, params });
            this.emit("codex_approval", { requestId, method, ...params });
            return;
        }
        const result = method === "mcpServer/elicitation/request" ? { action: "accept", content: {}, _meta: null } : { decision: "decline" };
        this.write({ id: message.id, result });
        this.emit("agent_event", { agent: "codex", type: "server.request", method, params, result });
    }

    /** 完成指定 JSON-RPC 请求。 */
    private resolve(id: number, result: unknown) {
        const pending = this.pending.get(id);
        if (pending) (this.pending.delete(id), pending.resolve(result));
    }

    /** 拒绝指定 JSON-RPC 请求。 */
    private reject(id: number, message: string) {
        const pending = this.pending.get(id);
        if (pending) (this.pending.delete(id), pending.reject(new Error(message)));
    }

    /** 拒绝进程退出时仍未完成的请求与 turn。 */
    private failAll(message: string, reported = false) {
        if (this.failing) return;
        this.failing = true;
        this.failureMessage = message;
        this.approvalRequests.forEach((request, requestId) => this.emit("codex_approval_resolved", { ...request.params, requestId, decision: request.decision || "cancel" }));
        const failedTurns = new Map<string, { threadId: string; turnId: string; prompt: string; messageText?: string }>();
        this.activeTurns.forEach(({ threadId, turnId, prompt, messageText }, key) => {
            if (this.silentThreadIds.has(threadId)) return;
            if (!this.finalizingTurns.has(key)) failedTurns.set(key, { threadId, turnId, prompt, messageText });
        });
        const pendingStart = this.pendingTurnStart;
        if (pendingStart?.turnId && !this.silentThreadIds.has(pendingStart.threadId)) {
            const key = turnCacheKey(pendingStart.threadId, pendingStart.turnId);
            if (!this.finalizingTurns.has(key) && !failedTurns.has(key)) failedTurns.set(key, { threadId: pendingStart.threadId, turnId: pendingStart.turnId, prompt: pendingStart.prompt, messageText: pendingStart.messageText });
        }
        const finalizing = [...this.finalizingTurns.values()];
        const persistence = [...failedTurns.values()].map(({ threadId, turnId, prompt, messageText }) => {
            const turn = { id: turnId, status: "failed", error: { message }, ...(prompt ? { input: prompt } : {}), ...(messageText ? { messageText } : {}) };
            return this.eventHistory.recordTurn({ threadId, turnId, turn }).catch((historyError) => logger.warn("Failed to persist Codex turn failure", { threadId, turnId, error: historyError }));
        });
        const error = reported || failedTurns.size || finalizing.length ? new CodexReportedError(message) : new Error(message);
        this.pendingDeltas.forEach((item) => clearTimeout(item.timer));
        this.pendingDeltas.clear();
        this.textByItem.clear();
        this.reasoningTextByItem.clear();
        this.startedItems.clear();
        this.itemSequences.clear();
        this.nextItemSequences.clear();
        this.plansByTurn.clear();
        this.completedTurns.clear();
        this.completedTurnResults.clear();
        this.approvalRequests.clear();
        this.silentThreadIds.clear();
        this.pendingSilentThreadStarts.clear();
        this.pendingThreadStartedNotifications.length = 0;
        this.structuredOutputByTurn.clear();
        this.pendingTurnStart = undefined;
        this.startedTurnKeys.clear();
        this.lastUsage = null;
        this.currentThreadId = "";
        this.currentTurnId = "";
        void Promise.all([...finalizing, ...persistence]).then(() => {
            failedTurns.forEach(({ threadId, turnId, prompt, messageText }) => {
                const turn = { id: turnId, status: "failed", error: { message }, ...(prompt ? { input: prompt } : {}), ...(messageText ? { messageText } : {}) };
                this.emit("agent_event", { agent: "codex", type: "turn.completed", status: "failed", error: { message }, thread_id: threadId, turn_id: turnId, turn });
                this.emit("agent_done", { agent: "codex", status: "failed", error: { message }, thread_id: threadId, turn_id: turnId });
            });
            this.pending.forEach((item) => item.reject(error));
            this.activeTurns.forEach((item) => item.reject(error));
            this.pending.clear();
            this.activeTurns.clear();
            this.finalizingTurns.clear();
        });
    }
}

/** 将 Codex 的字符串、摘要数组或文本对象转换为展示文本。 */
function readableCodexText(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) return value.map(readableCodexText).filter(Boolean).join("\n");
    if (!value || typeof value !== "object") return "";
    return readableCodexText(field(value, "text"));
}

/** 合并单个 reasoning 分段增量并按 summaryIndex 输出。 */
export function appendReasoningDelta(segments: Map<number, string>, summaryIndex: number | undefined, delta: string) {
    const index = Number.isInteger(summaryIndex) ? Number(summaryIndex) : 0;
    segments.set(index, `${segments.get(index) || ""}${delta}`);
    return [...segments.entries()].sort(([left], [right]) => left - right).map(([, text]) => text.trim()).filter(Boolean).join("\n");
}

/** 生成仅供进程内缓存使用的完整 turn 与 item 作用域键。 */
function itemCacheKey(scope: { threadId: string; turnId: string; itemId: string }) {
    return `${turnCacheKey(scope.threadId, scope.turnId)}\0${scope.itemId}`;
}

function turnCacheKey(threadId: string, turnId: string) {
    return `${threadId}\0${turnId}`;
}

/** 生成 Codex 调用 Canvas Agent MCP 的启动命令。 */
function canvasAgentMcpCommand() {
    const current = process.argv.find((arg) => /index\.(t|j)s$/.test(arg)) || "";
    const entry = path.resolve(current || fileURLToPath(new URL("../index.js", import.meta.url)));
    const tsx = path.join(path.dirname(entry), "..", "node_modules", "tsx", "dist", "cli.mjs");
    return entry.endsWith(".ts") ? { command: process.execPath, args: [tsx, entry, "mcp"] } : { command: process.execPath, args: [entry, "mcp"] };
}

/** 生成 Codex app-server 使用的 MCP 配置。 */
function codexConfig(permissionMode: AgentPermissionMode) {
    return { model_reasoning_summary: "auto", ...(permissionMode === "automatic" ? { approvals_reviewer: "auto_review" } : {}), mcp_servers: { "infinite-canvas": { command: canvasAgentMcp.command, args: canvasAgentMcp.args, default_tools_approval_mode: "approve", startup_timeout_sec: 20, tool_timeout_sec: 90 } } };
}

function threadSettings(permissionMode: AgentPermissionMode) {
    return { approvalPolicy: permissionMode === "full" ? "never" as const : "on-request" as const, sandbox: permissionMode === "full" ? "danger-full-access" as const : "workspace-write" as const, config: codexConfig(permissionMode) };
}

function skillDraftThreadSettings(cwd: string) {
    return {
        approvalPolicy: "never" as const,
        sandbox: "read-only" as const,
        config: { model_reasoning_summary: "auto", mcp_servers: {} },
        cwd,
        developerInstructions: SKILL_DRAFT_INSTRUCTIONS,
        ephemeral: true,
    };
}

function turnSettings(permissionMode: AgentPermissionMode) {
    return {
        approvalPolicy: permissionMode === "full" ? "never" as const : "on-request" as const,
        sandboxPolicy: permissionMode === "full" ? { type: "dangerFullAccess" as const } : { type: "workspaceWrite" as const, networkAccess: false },
    };
}

function skillDraftTurnSettings() {
    return { approvalPolicy: "never" as const, sandboxPolicy: { type: "readOnly" as const, networkAccess: false } };
}

/** 将文本、本地图片和显式 Skill 转换为 Codex turn 输入。 */
function codexInput(prompt: string, images: string[], skill?: CodexSkillSelector): CodexTurnInput[] {
    const text = skill && !mentionsSkill(prompt, skill.name) ? `$${skill.name} ${prompt}` : prompt;
    return [
        { type: "text", text, text_elements: [] },
        ...images.map<CodexTurnInput>((file) => ({ type: "localImage", path: file })),
        ...(skill ? [{ type: "skill", ...skill } as CodexTurnInput] : []),
    ];
}

function mentionsSkill(prompt: string, name: string) {
    return new RegExp(`\\$${name}(?![A-Za-z0-9_-]|:[A-Za-z0-9_-])`).test(prompt);
}

/** 将 app-server 通知转换为前端使用的 Agent 事件。 */
function normalizeCodexNotification(method: string, params: JsonRecord): AgentEvent | null {
    const scope = codexEventScope(params);
    if (method === "thread/started") return { type: "thread.started", ...scope };
    if (method === "turn/started") return { type: "turn.started", ...scope };
    if (method === "turn/completed") return { type: "turn.completed", status: field(field(params, "turn"), "status"), error: field(field(params, "turn"), "error"), usage: null, duration_ms: field(field(params, "turn"), "durationMs"), ...scope };
    if (method === "turn/plan/updated") return { type: "plan.updated", explanation: field(params, "explanation"), plan: field(params, "plan"), ...scope };
    if (method === "item/started") return { type: "item.started", item: normalizeItem(field(params, "item")), ...scope };
    if (method === "item/completed") return { type: "item.completed", item: normalizeItem(field(params, "item")), ...scope };
    if (method === "error") return { type: "error", message: field(field(params, "error"), "message"), ...scope };
    return null;
}

/** 提取 Codex 事件所属的线程和 turn。 */
function codexEventScope(params: JsonRecord) {
    const threadId = String(field(params, "threadId") || field(field(params, "thread"), "id") || "");
    const turnId = String(field(params, "turnId") || field(field(params, "turn"), "id") || "");
    return { ...(threadId ? { thread_id: threadId } : {}), ...(turnId ? { turn_id: turnId } : {}) };
}

/** 统一 app-server item 的类型和参数格式。 */
function normalizeItem(item: unknown) {
    const value = item && typeof item === "object" ? { ...(item as JsonRecord) } : {};
    if (value.type === "agentMessage") value.type = "agent_message";
    if (value.type === "mcpToolCall") value.type = "mcp_tool_call";
    if (value.type === "commandExecution") value.type = "command_execution";
    if (value.type === "fileChange") value.type = "file_change";
    if (value.type === "dynamicToolCall") value.type = "dynamic_tool_call";
    if (value.type === "collabToolCall" || value.type === "collabAgentToolCall") value.type = "collab_tool_call";
    if (value.type === "webSearch") value.type = "web_search";
    if (value.type === "imageView") value.type = "image_view";
    if (value.type === "imageGeneration") value.type = "image_generation";
    if (value.type === "contextCompaction") value.type = "context_compaction";
    if (value.type === "agent_message" && typeof value.id === "string") value.text = String(value.text || "");
    if ("arguments" in value) value.arguments = parseMaybeJson(value.arguments);
    return value;
}

function mergeDefinedRecord(started: JsonRecord, completed: JsonRecord) {
    const merged = { ...started };
    Object.entries(completed).forEach(([key, value]) => {
        if (value !== undefined) merged[key] = value;
    });
    return merged;
}

/** 将 Codex token usage 转换为前端字段。 */
function normalizeUsage(params: CodexNotificationParams<"thread/tokenUsage/updated">) {
    const last = params.tokenUsage.last;
    return {
        input_tokens: last.inputTokens,
        cached_input_tokens: last.cachedInputTokens,
        output_tokens: last.outputTokens,
        reasoning_output_tokens: last.reasoningOutputTokens,
    };
}

/** 尝试将字符串解析为 JSON，失败时保留原值。 */
function parseMaybeJson(value: unknown) {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

/** 定位当前依赖中 Codex CLI 的执行文件。 */
function codexBin() {
    return path.join(path.dirname(require.resolve("@openai/codex/package.json")), "bin", "codex.js");
}
