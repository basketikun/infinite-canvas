import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { logger } from "../utils/logger.js";
import { errorMessage, field } from "../utils/value.js";
import { CodexAppClient, CodexReportedError } from "./codex-client.js";
import { codexEventHistory } from "./codex-event-history.js";
import { settledTurnIds, summarizeCodexThread, threadMessages } from "./codex-history.js";
import type { CodexReasoningEffort } from "./codex-protocol.js";
import type { AgentAttachment, AgentEmit, AgentPermissionMode } from "./types.js";

type CodexRunOptions = { threadId?: string; cwd?: string; permissionMode?: AgentPermissionMode; model?: string; effort?: CodexReasoningEffort; appEmit?: AgentEmit; onStart?: () => void; onThread?: (threadId: string) => void; onTurn?: (turnId: string) => void; onFinish?: () => void };

let codexQueue: Promise<unknown> = Promise.resolve();
let codexApp: CodexAppClient | null = null;
let codexAppStart: Promise<CodexAppClient> | null = null;
/** 仅表示最近主动加载/选择的线程；运行中的 turn 身份由 CodexAppClient 自己维护。 */
let loadedThreadId = "";

export { summarizeCodexThread } from "./codex-history.js";

/** 将 Codex turn 加入串行队列并等待执行完成。 */
export async function runCodexTurn(prompt: string, lifecycleEmit: AgentEmit, attachments: AgentAttachment[] = [], options: CodexRunOptions = {}) {
    if (!prompt.trim()) return;
    codexQueue = codexQueue.catch(() => undefined).then(() => runCodexTurnNow(prompt, lifecycleEmit, attachments, options));
    await codexQueue;
}

/** 中断当前线程正在执行的 Codex turn。 */
export async function interruptCodexTurn(threadId?: string) {
    if (!codexApp) return false;
    return await codexApp.interruptCurrentTurn(threadId);
}

/** 回复当前 app-server 的待处理权限请求。 */
export async function resolveCodexApproval(requestId: string, decision: string) {
    return Boolean(codexApp?.resolveApproval(requestId, decision));
}

/** 创建新的 Codex 线程并记录当前线程 ID。 */
export async function startCodexThread(emit: AgentEmit, cwd?: string, permissionMode: AgentPermissionMode = "request") {
    const app = await getCodexApp(emit);
    const thread = await app.startThread(cwd, permissionMode);
    loadedThreadId = String(field(thread, "id") || "");
    return thread;
}

/** 恢复指定 Codex 线程并返回聊天历史。 */
export async function resumeCodexThread(emit: AgentEmit, threadId: string, cwd?: string, permissionMode: AgentPermissionMode = "request") {
    const app = await getCodexApp(emit);
    const thread = await resumeLoadedThread(app, threadId, cwd, permissionMode, true);
    const history = await loadCodexHistory(emit, threadId, cwd);
    const supplementalItems = await codexEventHistory.readThread(threadId);
    return { thread, messages: threadMessages(history.thread, app.planUpdates(threadId), supplementalItems), settledTurnIds: settledTurnIds(history.thread, supplementalItems), historyReady: history.historyReady };
}

/** 查询当前工作空间中的 Codex 线程。 */
export async function listCodexThreads(emit: AgentEmit, options: { cwd: string; searchTerm?: string; limit?: number }) {
    const app = await getCodexApp(emit);
    const result = await app.listThreads({
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

/** 查询当前账号可用于新任务的 Codex 模型。 */
export async function listCodexModels(emit: AgentEmit) {
    return await (await getCodexApp(emit)).listModels();
}

/** 读取指定 Codex 线程及其聊天历史。 */
export async function readCodexThread(emit: AgentEmit, threadId: string, cwd?: string) {
    const app = await getCodexApp(emit);
    const history = await loadCodexHistory(emit, threadId, cwd);
    const supplementalItems = await codexEventHistory.readThread(threadId);
    return { thread: summarizeCodexThread(history.thread), messages: threadMessages(history.thread, app.planUpdates(threadId), supplementalItems), settledTurnIds: settledTurnIds(history.thread, supplementalItems), historyReady: history.historyReady };
}

/** 归档指定 Codex 线程。 */
export async function archiveCodexThread(emit: AgentEmit, threadId: string, cwd?: string) {
    const app = await getCodexApp(emit);
    try {
        await loadCodexThread(emit, threadId, cwd, false);
    } catch (error) {
        if (!isRecoverableThreadError(error)) throw error;
        await resumeLoadedThread(app, threadId, cwd, "request", false);
    }
    await app.archiveThread(threadId);
    app.clearPlanUpdates(threadId);
    await codexEventHistory.removeThread(threadId);
    if (loadedThreadId === threadId) loadedThreadId = "";
}

/** 判断线程异常是否允许自动新建线程后重试。 */
export function isRecoverableThreadError(error: unknown) {
    return /thread not loaded|no rollout found/i.test(errorMessage(error));
}

/** 执行一次 Codex turn，并负责附件临时文件和线程恢复。 */
async function runCodexTurnNow(prompt: string, lifecycleEmit: AgentEmit, attachments: AgentAttachment[], options: CodexRunOptions) {
    let files: string[] = [];
    try {
        options.onStart?.();
        files = await writeAttachmentFiles(attachments);
        const app = await getCodexApp(options.appEmit || lifecycleEmit);
        let threadId = await ensureCodexThread(app, options, lifecycleEmit);
        options.onThread?.(threadId);
        try {
            await app.startTurn(threadId, prompt, files, options.permissionMode || "request", options.model, options.effort, options.onTurn);
        } catch (error) {
            if (!isRecoverableThreadError(error)) throw error;
            lifecycleEmit("agent_log", { text: `Codex thread unavailable, starting a new thread: ${errorMessage(error)}` });
            loadedThreadId = "";
            threadId = await ensureCodexThread(app, { cwd: options.cwd }, lifecycleEmit);
            options.onThread?.(threadId);
            await app.startTurn(threadId, prompt, files, options.permissionMode || "request", options.model, options.effort, options.onTurn);
        }
    } catch (error) {
        logger.error("Codex turn failed", error);
        if (!(error instanceof CodexReportedError)) lifecycleEmit("agent_error", { message: errorMessage(error) });
    } finally {
        options.onFinish?.();
        await Promise.all(files.map((file) => fs.unlink(file).catch(() => undefined)));
    }
}

/** 恢复请求线程或创建新的 Codex 线程。 */
async function ensureCodexThread(app: CodexAppClient, options: CodexRunOptions, emit: AgentEmit) {
    if (options.threadId) {
        if (options.threadId === loadedThreadId) return loadedThreadId;
        try {
            await resumeLoadedThread(app, options.threadId, options.cwd, options.permissionMode || "request", true);
            return loadedThreadId;
        } catch (error) {
            if (!isRecoverableThreadError(error)) throw error;
            emit("agent_log", { text: `Codex thread unavailable, starting a new thread: ${errorMessage(error)}` });
            loadedThreadId = "";
        }
    }
    if (!loadedThreadId) {
        const thread = await app.startThread(options.cwd, options.permissionMode || "request");
        loadedThreadId = String(field(thread, "id") || "");
    }
    return loadedThreadId;
}

/** 从 app-server 读取线程并校验工作空间。 */
async function loadCodexThread(emit: AgentEmit, threadId: string, cwd: string | undefined, includeTurns: boolean) {
    const app = await getCodexApp(emit);
    const result = await app.readThread(threadId, includeTurns);
    const thread = field(result, "thread") || {};
    assertThreadWorkspace(thread, cwd);
    return thread;
}

/** 读取线程历史，并显式标记 Codex 是否已经物化 turns。 */
async function loadCodexHistory(emit: AgentEmit, threadId: string, cwd?: string) {
    try {
        return { thread: await loadCodexThread(emit, threadId, cwd, true), historyReady: true };
    } catch (error) {
        if (/not materialized yet.*includeTurns/i.test(errorMessage(error))) return { thread: await loadCodexThread(emit, threadId, cwd, false), historyReady: false };
        if (!isRecoverableThreadError(error)) throw error;
        const app = await getCodexApp(emit);
        const thread = await resumeLoadedThread(app, threadId, cwd, "request", false);
        try {
            return { thread: await loadCodexThread(emit, threadId, cwd, true), historyReady: true };
        } catch (historyError) {
            if (/not materialized yet.*includeTurns/i.test(errorMessage(historyError))) return { thread, historyReady: false };
            throw historyError;
        }
    }
}

/** 恢复线程并统一校验工作空间与进程内活动线程。 */
async function resumeLoadedThread(app: CodexAppClient, threadId: string, cwd?: string, permissionMode: AgentPermissionMode = "request", updateLoaded = true) {
    const thread = await app.resumeThread(threadId, cwd, permissionMode);
    assertThreadWorkspace(thread, cwd);
    if (updateLoaded) loadedThreadId = String(field(thread, "id") || threadId);
    return thread;
}

/** 获取已启动的 Codex app-server 客户端。 */
async function getCodexApp(emit: AgentEmit) {
    if (codexApp) return codexApp;
    codexAppStart ||= CodexAppClient.start(emit, () => {
        codexApp = null;
        loadedThreadId = "";
    });
    try {
        codexApp = await codexAppStart;
        return codexApp;
    } finally {
        codexAppStart = null;
    }
}

/** 校验线程是否属于指定工作空间。 */
function assertThreadWorkspace(thread: unknown, cwd?: string) {
    if (!cwd || threadInWorkspace(thread, cwd)) return;
    throw new Error("该 Codex 会话不属于当前画布工作空间");
}

/** 判断线程工作目录是否与当前工作空间一致。 */
function threadInWorkspace(thread: unknown, cwd: string) {
    const threadCwd = String(field(thread, "cwd") || "");
    return Boolean(threadCwd && path.resolve(threadCwd) === path.resolve(cwd));
}

/** 将图片附件写入临时文件供 Codex 读取。 */
async function writeAttachmentFiles(attachments: AgentAttachment[]) {
    return await Promise.all(attachments.filter((item) => item.dataUrl?.startsWith("data:image/")).map(writeAttachmentFile));
}

/** 将单个 Data URL 图片附件写入临时文件。 */
async function writeAttachmentFile(item: AgentAttachment) {
    const [, meta = "", data = ""] = item.dataUrl?.match(/^data:([^;]+);base64,(.+)$/) || [];
    if (!data) throw new Error(`图片附件无效：${item.name || "未命名图片"}`);
    const file = path.join(os.tmpdir(), `infinite-canvas-${Date.now()}-${Math.random().toString(16).slice(2)}.${imageExt(meta || item.type)}`);
    await fs.writeFile(file, Buffer.from(data, "base64"));
    return file;
}

/** 根据图片 MIME 类型返回临时文件扩展名。 */
function imageExt(type = "") {
    if (type.includes("png")) return "png";
    if (type.includes("webp")) return "webp";
    return "jpg";
}
