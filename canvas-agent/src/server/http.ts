import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";

import { runClaudeTurn } from "../agent/claude.js";
import { archiveCodexThread, interruptCodexTurn, listCodexModels, listCodexThreads, readCodexThread, resolveCodexApproval, resumeCodexThread, runCodexTurn, startCodexThread, summarizeCodexThread } from "../agent/codex.js";
import type { CodexReasoningEffort } from "../agent/codex-protocol.js";
import type { AgentAttachment, AgentPermissionMode } from "../agent/types.js";
import { AGENT_PROTOCOL_VERSION, CanvasSession } from "../canvas/session.js";
import { DEFAULT_PORT, ensureSiteWorkspace, loadConfig, saveConfig, updateSiteWorkspace, type CanvasAgentConfig } from "../config.js";
import { logger } from "../utils/logger.js";
import { checkVersions } from "../version-check.js";

/** 启动仅监听本机的 Canvas Agent HTTP 服务。 */
export function startHttpServer() {
    const config = loadConfig(true);
    const port = Number(process.env.PORT) || Number(new URL(config.url).port) || DEFAULT_PORT;
    config.url = `http://127.0.0.1:${port}`;
    saveConfig(config);

    const session = new CanvasSession();
    /** 将 Agent 事件广播到所属线程或全部网页。 */
    const emit = (type: string, payload: unknown) => {
        const scope = session.codexBusy ? session.codexEventScope : { threadId: "", turnId: "", sourceClientId: "" };
        const value = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : { value: payload };
        const threadId = String(value.threadId || value.thread_id || scope.threadId || ensureSiteWorkspace(config).activeThreadId || "");
        const turnId = String(value.turnId || value.turn_id || scope.turnId || "");
        const sourceClientId = String(value.sourceClientId || scope.sourceClientId || "");
        const data = {
            ...value,
            ...(threadId ? { threadId, thread_id: threadId } : {}),
            ...(turnId ? { turnId, turn_id: turnId } : {}),
            ...(sourceClientId ? { sourceClientId } : {}),
        };
        session.trackCodexEvent(type, data);
        threadId ? session.emitThread(type, threadId, data) : session.emitAll(type, data);
    };
    /** 保存并广播当前站点工作空间的活跃线程。 */
    const setActiveThread = (activeThreadId: string, payload: Record<string, unknown> = {}) => {
        const workspace = updateSiteWorkspace(config, { activeThreadId: activeThreadId || undefined });
        if (!session.codexBusy && session.codexThreadId !== activeThreadId) session.setCodexState({ threadId: activeThreadId, turnId: "" });
        session.emitThread("workspace_changed", activeThreadId, { ...payload, activeThreadId });
        return workspace;
    };
    let draftThreadStart: ReturnType<typeof startCodexThread> | null = null;
    const prepareDraftThread = (clientId: string, permission: AgentPermissionMode) => {
        if (draftThreadStart) return draftThreadStart;
        const workspace = ensureSiteWorkspace(config);
        emit("agent_bootstrap", { type: "codex.preparing", sourceClientId: clientId });
        const start = startCodexThread(emit, workspace.workspacePath, permission);
        draftThreadStart = start;
        void start.then((thread) => {
            if (draftThreadStart !== start) return;
            draftThreadStart = null;
            const threadId = String((thread as Record<string, unknown>).id || "");
            if (threadId && !ensureSiteWorkspace(config).activeThreadId) setActiveThread(threadId, { emptyThread: true, draftThread: true, sourceClientId: clientId });
        }).catch((error) => {
            if (draftThreadStart === start) draftThreadStart = null;
            emit("agent_bootstrap", { type: "codex.prepare_failed", sourceClientId: clientId, error: error instanceof Error ? error.message : String(error) });
        });
        return start;
    };
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "30mb" }));
    app.use((req, res, next) => {
        if (!logger.enabled) return next();
        const startedAt = Date.now();
        const url = requestUrl(req, config);
        res.on("finish", () => {
            if (req.method === "OPTIONS" || (res.statusCode < 400 && ["/health", "/canvas/state", "/canvas/activate"].includes(url.pathname))) return;
            logger.debug(`HTTP ${req.method} ${url.pathname}`, { status: res.statusCode, durationMs: Date.now() - startedAt });
        });
        next();
    });
    app.use((req, res, next) => {
        const url = requestUrl(req, config);
        if (!setCors(req, res, url, config)) return void res.status(403).json({ ok: false, error: "origin not allowed" });
        if (req.method === "OPTIONS") return void res.json({});
        next();
    });
    app.get("/health", (_req, res) => res.json(session.health()));
    app.get("/config", (_req, res) => res.json({ ok: true, protocolVersion: AGENT_PROTOCOL_VERSION, url: config.url, hasToken: true }));
    app.use((req, res, next) => {
        if (validToken(req, requestUrl(req, config), config.token)) return next();
        res.status(401).json({ ok: false, error: "invalid token" });
    });
    app.get("/events", (req, res) => {
        session.openEvents(requestUrl(req, config), res, ensureSiteWorkspace(config).activeThreadId || "");
    });
    app.post("/canvas/state", (req, res) => {
        session.updateState(req.body, String(req.query.clientId || "") || undefined);
        res.json({ ok: true });
    });
    app.post("/canvas/activate", (req, res) => {
        session.activateClient(String(req.query.clientId || ""));
        res.json({ ok: true });
    });
    app.post("/canvas/result", (req, res) => {
        const ok = session.resolveResult(String(req.query.clientId || ""), req.body);
        res.status(ok ? 200 : 409).json({ ok });
    });
    app.get("/agent/attachments/:attachmentId", route(async (req, res) => {
        const attachment = session.getTurnAttachment(String(req.query.clientId || ""), routeParam(req.params.attachmentId));
        const data = attachment.dataUrl.split(",", 2)[1];
        if (!data) throw new Error("图片附件内容无效");
        res.setHeader("Cache-Control", "no-store");
        res.type(attachment.type).send(Buffer.from(data, "base64"));
    }));
    app.post("/agent/local-file/reveal", route(async (req, res) => {
        const filePath = String(req.body?.path || "");
        if (!path.isAbsolute(filePath)) return res.status(400).json({ ok: false, error: "文件路径必须是绝对路径" });
        const file = await stat(filePath);
        await revealLocalFile(filePath, file.isDirectory());
        res.json({ ok: true });
    }));
    app.post("/agent/local-image", route(async (req, res) => {
        const filePath = String(req.body?.path || "");
        if (!path.isAbsolute(filePath) || !/\.(?:avif|gif|jpe?g|png|webp)$/i.test(filePath)) return res.status(400).json({ ok: false, error: "图片路径无效" });
        const file = await stat(filePath);
        if (!file.isFile()) return res.status(400).json({ ok: false, error: "图片文件无效" });
        res.setHeader("Cache-Control", "no-store");
        res.type(path.extname(filePath)).send(await readFile(filePath));
    }));
    app.post("/api/tools", route(async (req, res) => res.json({ ok: true, result: await session.callTool(req.body?.name, req.body?.input || {}) })));
    app.get("/agent/codex/workspace", (_req, res) => {
        const workspace = ensureSiteWorkspace(config);
        res.json({ ok: true, workspace });
    });
    app.get("/agent/codex/models", route(async (_req, res) => res.json({ ok: true, ...(await listCodexModels(emit)) })));
    app.get("/agent/codex/threads", route(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const result = await listCodexThreads(emit, { cwd: workspace.workspacePath, searchTerm: String(req.query.searchTerm || "") });
        res.json({ ok: true, workspace, ...result });
    }));
    app.post("/agent/codex/threads/new", codexMutation(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const thread = await startCodexThread(emit, workspace.workspacePath, permissionMode(req.body?.permissionMode));
        const activeThreadId = String((thread as Record<string, unknown>).id || "");
        const nextWorkspace = setActiveThread(activeThreadId, { emptyThread: true, sourceClientId: String(req.body?.clientId || "") });
        res.json({ ok: true, workspace: nextWorkspace, thread: summarizeCodexThread(thread), messages: [] });
    }));
    app.post("/agent/codex/threads/reset", codexMutation((req, res) => {
        const clientId = String(req.body?.clientId || "");
        const workspace = setActiveThread("", { emptyThread: true, draftThread: true, sourceClientId: clientId });
        void prepareDraftThread(clientId, permissionMode(req.body?.permissionMode));
        res.json({ ok: true, workspace });
    }));
    app.get("/agent/codex/threads/:threadId", route(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const threadId = routeParam(req.params.threadId);
        res.json({ ok: true, workspace, ...(await readCodexThread(emit, threadId, workspace.workspacePath)) });
    }));
    app.post("/agent/codex/history/ack", (req, res) => {
        const threadId = String(req.body?.threadId || "");
        const turnIds = Array.isArray(req.body?.turnIds) ? req.body.turnIds.map(String) : [];
        session.acknowledgeCodexHistory(threadId, turnIds);
        res.json({ ok: true });
    });
    app.post("/agent/codex/threads/:threadId/resume", codexMutation(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const threadId = routeParam(req.params.threadId);
        const result = await resumeCodexThread(emit, threadId, workspace.workspacePath, permissionMode(req.body?.permissionMode));
        const nextWorkspace = setActiveThread(threadId, { sourceClientId: String(req.body?.clientId || "") });
        res.json({ ok: true, workspace: nextWorkspace, ...result });
    }));
    app.post("/agent/codex/threads/:threadId/delete", codexMutation(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const threadId = routeParam(req.params.threadId);
        await archiveCodexThread(emit, threadId, workspace.workspacePath);
        setActiveThread(workspace.activeThreadId === threadId ? "" : workspace.activeThreadId || "", { sourceClientId: String(req.body?.clientId || "") });
        res.json({ ok: true });
    }));
    app.post("/agent/codex/turn", codexMutation(async (req, res) => {
        const attachments = Array.isArray(req.body?.attachments) ? (req.body.attachments as AgentAttachment[]) : [];
        const workspace = ensureSiteWorkspace(config);
        const prompt = String(req.body?.prompt || "");
        if (!prompt.trim()) return res.status(400).json({ ok: false, error: "请输入任务内容" });
        const clientId = String(req.body?.clientId || "");
        if (!clientId || !session.hasClient(clientId)) return res.status(409).json({ ok: false, error: "发起任务的网页已断开，请重新连接后再试" });
        const requestedThreadId = String(req.body?.threadId || "");
        const activeThreadId = workspace.activeThreadId || "";
        if (requestedThreadId !== activeThreadId) return res.status(409).json({ ok: false, error: "当前会话已在其他页面切换，请同步后重试" });
        const model = String(req.body?.model || "") || undefined;
        const effort = reasoningEffort(req.body?.effort);
        const messageId = String(req.body?.messageId || Date.now());
        const messageText = String(req.body?.messageText || prompt || `发送了 ${attachments.length} 张图片`);
        let threadId = activeThreadId;
        logger.info("Codex turn accepted", { threadId: req.body?.threadId, model: model || "default", reasoningEffort: effort || "default", promptLength: prompt.length, attachmentCount: attachments.length });
        session.bindClient(clientId);
        session.setCodexState({ busy: true, threadId, turnId: "" });
        try {
            let turnId = "";
            if (!threadId) {
                const thread = await prepareDraftThread(clientId, permissionMode(req.body?.permissionMode));
                threadId = String((thread as Record<string, unknown>).id || "");
                setActiveThread(threadId, { emptyThread: true, sourceClientId: clientId });
            }
            session.setCodexState({ busy: true, threadId, turnId: "" });
            const attachmentRefs = session.setTurnAttachments(clientId, attachments);
            session.emitThread("chat_message", threadId, {
                sourceClientId: clientId,
                message: { id: `${threadId}:pending:synthetic:user`, itemId: "synthetic:user", clientMessageId: messageId, threadId, turnId: "", role: "user", text: messageText },
            });
            let chatTurnId = "";
            /** 将包装层日志和兜底错误固定广播到当前 turn。 */
            const lifecycleEmit = (type: string, payload: unknown) => {
                const value = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : { value: payload };
                const eventThreadId = String(value.threadId || value.thread_id || threadId);
                const eventTurnId = String(value.turnId || value.turn_id || turnId);
                const sourceClientId = String(value.sourceClientId || clientId);
                session.emitThread(type, eventThreadId, {
                    ...value,
                    threadId: eventThreadId,
                    thread_id: eventThreadId,
                    ...(eventTurnId ? { turnId: eventTurnId, turn_id: eventTurnId } : {}),
                    ...(sourceClientId ? { sourceClientId } : {}),
                });
            };
            void runCodexTurn(withAttachmentContext(prompt, attachmentRefs), lifecycleEmit, attachments, {
                threadId,
                cwd: workspace.workspacePath,
                permissionMode: permissionMode(req.body?.permissionMode),
                model,
                effort,
                appEmit: emit,
                onStart: () => session.bindClient(clientId),
                onThread: (actualThreadId) => {
                    const threadChanged = actualThreadId !== threadId;
                    if (actualThreadId !== threadId) {
                        threadId = actualThreadId;
                        setActiveThread(threadId, { emptyThread: true, sourceClientId: clientId });
                    }
                    session.setCodexState({ busy: true, threadId, turnId: "" });
                    if (threadChanged) {
                        session.emitThread("chat_message", threadId, {
                            sourceClientId: clientId,
                            message: { id: `${threadId}:pending:synthetic:user`, itemId: "synthetic:user", clientMessageId: messageId, threadId, turnId: "", role: "user", text: messageText },
                        });
                    }
                },
                onTurn: (actualTurnId) => {
                    turnId = actualTurnId;
                    if (chatTurnId !== turnId) {
                        chatTurnId = turnId;
                        session.emitThread("chat_message", threadId, {
                            turnId,
                            sourceClientId: clientId,
                            message: { id: `${threadId}:${turnId}:synthetic:user`, itemId: "synthetic:user", clientMessageId: messageId, threadId, turnId, role: "user", text: messageText },
                        });
                    }
                    logger.info("Codex turn started", { threadId, turnId, model: model || "default", reasoningEffort: effort || "default" });
                    session.setCodexState({ busy: true, threadId, turnId });
                },
                onFinish: () => {
                    logger.info("Codex turn finished", { threadId, turnId });
                    session.clearTurnAttachments(clientId);
                    if (clientId) session.releaseClient(clientId);
                    session.setCodexState({ busy: false, threadId, turnId });
                },
            });
            res.json({ ok: true, threadId });
        } catch (error) {
            session.releaseClient(clientId);
            session.setCodexState({ busy: false, threadId, turnId: "" });
            throw error;
        }
    }));

    /** 将 Codex 写操作串行化，避免多窗口在异步请求期间交叉修改会话。 */
    function codexMutation(handler: (req: Request, res: Response) => unknown | Promise<unknown>) {
        return route(async (req, res) => {
            if (!session.beginCodexMutation()) return res.status(409).json({ ok: false, error: "Codex 正在运行或正在切换会话，请稍后重试" });
            try {
                return await handler(req, res);
            } finally {
                session.endCodexMutation();
            }
        });
    }
    app.post("/agent/codex/approval", route(async (req, res) => {
        const decision = String(req.body?.decision || "");
        if (!["accept", "acceptForSession", "decline", "cancel"].includes(decision)) return res.status(400).json({ ok: false, error: "无效的审批决定" });
        const ok = await resolveCodexApproval(String(req.body?.requestId || ""), decision);
        res.status(ok ? 200 : 409).json({ ok, ...(ok ? {} : { error: "审批请求已失效" }) });
    }));
    app.post("/agent/codex/interrupt", route(async (req, res) => res.json({ ok: await interruptCodexTurn(String(req.body?.threadId || "")) })));
    app.post("/agent/claude/turn", (req, res) => {
        runClaudeTurn(String(req.body?.prompt || ""), emit);
        res.json({ ok: true });
    });
    app.use((_req, res) => res.status(404).json({ ok: false, error: "not found" }));
    app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
        logger.error("HTTP request failed", { method: req.method, path: req.path, error });
        res.status(500).json({ ok: false, error: error.message });
    });

    app.listen(port, "127.0.0.1", () => {
        console.log("Infinite Canvas Agent");
        checkVersions();
        console.log(`Local URL: ${config.url}`);
        console.log(`Connect token: ${config.token}`);
        console.log("Codex MCP is not installed by this command.");
        console.log("Optional MCP add: codex mcp add infinite-canvas -- npx -y @basketikun/canvas-agent mcp");
        console.log("Remove manually added MCP: codex mcp remove infinite-canvas");
        if (logger.enabled) console.log(`Debug log: ${logger.filePath}`);
        logger.info("Canvas Agent started", { url: config.url, workspace: ensureSiteWorkspace(config).workspacePath, debugLog: logger.filePath });
    });
}

/** 将异步 Express 路由异常交给统一错误处理中间件。 */
function route(handler: (req: Request, res: Response) => Promise<unknown>) {
    return (req: Request, res: Response, next: NextFunction) => void handler(req, res).catch(next);
}

/** 从 Express 路由参数中读取单个字符串。 */
function routeParam(value: string | string[]) {
    return Array.isArray(value) ? value[0] || "" : value;
}

function permissionMode(value: unknown): AgentPermissionMode {
    return value === "automatic" || value === "full" ? value : "request";
}

function reasoningEffort(value: unknown): CodexReasoningEffort | undefined {
    return value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max" || value === "ultra" ? value : undefined;
}

/** 使用当前操作系统的文件管理器定位本地文件。 */
function revealLocalFile(filePath: string, isDirectory: boolean) {
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
    const args = process.platform === "darwin"
        ? ["-R", filePath]
        : process.platform === "win32"
            ? [isDirectory ? filePath : `/select,${filePath}`]
            : [isDirectory ? filePath : path.dirname(filePath)];
    return new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { detached: true, stdio: "ignore" });
        child.once("spawn", () => {
            child.unref();
            resolve();
        });
        child.once("error", reject);
    });
}

/** 结合服务配置解析当前请求 URL。 */
function requestUrl(req: Request, config: CanvasAgentConfig) {
    return new URL(req.originalUrl || req.url || "/", config.url);
}

/** 设置跨域响应头并记录通过 token 授权的来源。 */
function setCors(req: Request, res: Response, url: URL, config: CanvasAgentConfig) {
    const origin = req.headers.origin;
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type,x-canvas-agent-token");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    if (!origin || req.method === "OPTIONS" || url.pathname === "/health" || url.pathname === "/config") return true;
    config.origins ||= [];
    if (validToken(req, url, config.token) && !config.origins.includes(origin)) {
        config.origins.push(origin);
        saveConfig(config);
    }
    res.setHeader("Vary", "Origin");
    return config.origins.includes(origin);
}

/** 校验请求查询参数或请求头中的连接 token。 */
function validToken(req: Request, url: URL, token: string) {
    const header = req.headers["x-canvas-agent-token"];
    return url.searchParams.get("token") === token || header === token || (Array.isArray(header) && header.includes(token));
}

/** 向 Agent 提示词追加本轮图片附件引用说明。 */
function withAttachmentContext(prompt: string, attachments: Array<{ id: string; name: string }>) {
    if (!attachments.length) return prompt;
    const list = attachments.map((item, index) => `${index + 1}. attachmentId=${item.id}, name=${JSON.stringify(item.name)}`).join("\n");
    return `${prompt}\n\n本轮可用图片附件（顺序与图片输入一致）：\n${list}\n需要把附件放入画布或作为生成参考图时，先调用 canvas_create_attachment_nodes，再使用返回的画布节点 ID 创建生成流程。`;
}
