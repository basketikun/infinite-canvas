import express, { type NextFunction, type Request, type Response } from "express";

import { DEFAULT_PORT, ensureSiteWorkspace, loadConfig, saveConfig, updateSiteWorkspace, type CanvasAgentConfig } from "./config.js";
import { CanvasSession } from "./canvas-session.js";
import { archiveCodexThread, interruptCodexTurn, isRecoverableThreadError, listCodexThreads, readCodexThread, resumeCodexThread, runClaudeTurn, runCodexTurn, startCodexThread, summarizeCodexThread, verifyCodexThreadWorkspace, withAgentPrompt } from "./agents.js";
import type { AgentAttachment } from "./types.js";

export function startHttpServer() {
    const config = loadConfig(true);
    const port = Number(process.env.PORT) || Number(new URL(config.url).port) || DEFAULT_PORT;
    config.url = `http://127.0.0.1:${port}`;
    saveConfig(config);

    const session = new CanvasSession();
    const emit = (type: string, payload: unknown) => {
        const data = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : { value: payload };
        const threadId = String(data.threadId || data.thread_id || ensureSiteWorkspace(config).activeThreadId || "");
        threadId ? session.emitThread(type, threadId, data) : session.emitAll(type, data);
    };
    const setActiveThread = (activeThreadId: string, payload: Record<string, unknown> = {}) => {
        const workspace = updateSiteWorkspace(config, { activeThreadId: activeThreadId || undefined });
        session.emitThread("workspace_changed", activeThreadId, { ...payload, activeThreadId });
        return workspace;
    };
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "30mb" }));
    app.use((req, res, next) => {
        const url = requestUrl(req, config);
        if (!setCors(req, res, url, config)) return void res.status(403).json({ ok: false, error: "origin not allowed" });
        if (req.method === "OPTIONS") return void res.json({});
        next();
    });
    app.get("/health", (_req, res) => res.json(session.health()));
    app.get("/config", (_req, res) => res.json({ ok: true, url: config.url, hasToken: true }));
    app.use((req, res, next) => {
        if (validToken(req, requestUrl(req, config), config.token)) return next();
        res.status(401).json({ ok: false, error: "invalid token" });
    });
    app.get("/events", (req, res) => session.openEvents(requestUrl(req, config), res));
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
    app.post("/api/tools", route(async (req, res) => res.json({ ok: true, result: await session.callTool(req.body?.name, req.body?.input || {}) })));
    app.get("/agent/codex/workspace", (_req, res) => {
        const workspace = ensureSiteWorkspace(config);
        res.json({ ok: true, workspace });
    });
    app.get("/agent/codex/threads", route(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const result = await listCodexThreads(emit, { cwd: workspace.workspacePath, searchTerm: String(req.query.searchTerm || "") });
        res.json({ ok: true, workspace, ...result });
    }));
    app.post("/agent/codex/threads/new", route(async (_req, res) => {
        if (session.codexBusy) return res.status(409).json({ ok: false, error: "Codex 正在运行，请等待当前任务完成" });
        const workspace = ensureSiteWorkspace(config);
        const thread = await startCodexThread(emit, workspace.workspacePath);
        const activeThreadId = String((thread as Record<string, unknown>).id || "");
        const nextWorkspace = setActiveThread(activeThreadId, { emptyThread: true });
        res.json({ ok: true, workspace: nextWorkspace, thread: summarizeCodexThread(thread), messages: [] });
    }));
    app.get("/agent/codex/threads/:threadId", route(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const threadId = routeParam(req.params.threadId);
        try {
            res.json({ ok: true, workspace, ...(await readCodexThread(emit, threadId, workspace.workspacePath)) });
        } catch (error) {
            if (workspace.activeThreadId !== threadId || !isRecoverableThreadError(error)) throw error;
            res.json({ ok: true, workspace, thread: { id: threadId, preview: "", cwd: workspace.workspacePath }, messages: [] });
        }
    }));
    app.post("/agent/codex/threads/:threadId/resume", route(async (req, res) => {
        if (session.codexBusy) return res.status(409).json({ ok: false, error: "Codex 正在运行，请等待当前任务完成" });
        const workspace = ensureSiteWorkspace(config);
        const threadId = routeParam(req.params.threadId);
        const result = await resumeCodexThread(emit, threadId, workspace.workspacePath);
        const nextWorkspace = setActiveThread(threadId);
        res.json({ ok: true, workspace: nextWorkspace, ...result });
    }));
    app.post("/agent/codex/threads/:threadId/delete", route(async (req, res) => {
        if (session.codexBusy) return res.status(409).json({ ok: false, error: "Codex 正在运行，请等待当前任务完成" });
        const workspace = ensureSiteWorkspace(config);
        const threadId = routeParam(req.params.threadId);
        await archiveCodexThread(emit, threadId, workspace.workspacePath);
        setActiveThread(workspace.activeThreadId === threadId ? "" : workspace.activeThreadId || "");
        res.json({ ok: true });
    }));
    app.post("/agent/codex/turn", route(async (req, res) => {
        if (session.codexBusy) return res.status(409).json({ ok: false, error: "Codex 正在运行，请等待当前任务完成" });
        const attachments = Array.isArray(req.body?.attachments) ? (req.body.attachments as AgentAttachment[]) : [];
        const workspace = ensureSiteWorkspace(config);
        const prompt = String(req.body?.prompt || "");
        if (!prompt.trim()) return res.status(400).json({ ok: false, error: "请输入任务内容" });
        const clientId = String(req.body?.clientId || "");
        session.setCodexState({ busy: true, threadId: String(req.body?.threadId || workspace.activeThreadId || ""), turnId: "" });
        try {
            let threadId = String(req.body?.threadId || workspace.activeThreadId || "");
            let turnId = "";
            if (!threadId) {
                const thread = await startCodexThread(emit, workspace.workspacePath);
                threadId = String((thread as Record<string, unknown>).id || "");
                setActiveThread(threadId, { emptyThread: true });
            } else if (threadId !== workspace.activeThreadId) {
                await verifyCodexThreadWorkspace(emit, threadId, workspace.workspacePath);
                setActiveThread(threadId);
            }
            const chatMessage = {
                sourceClientId: clientId,
                message: { id: String(req.body?.messageId || Date.now()), role: "user", text: String(req.body?.messageText || prompt || `发送了 ${attachments.length} 张图片`) },
            };
            let chatThreadId = "";
            const turnEmit = (type: string, payload: unknown) => {
                const data = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : { value: payload };
                session.emitThread(type, threadId, data);
            };
            void runCodexTurn(withAgentPrompt(prompt), turnEmit, attachments, {
                threadId,
                cwd: workspace.workspacePath,
                appEmit: emit,
                onStart: clientId ? () => session.bindClient(clientId) : undefined,
                onThread: (actualThreadId) => {
                    if (actualThreadId !== threadId) {
                        threadId = actualThreadId;
                        setActiveThread(threadId, { emptyThread: true });
                    }
                    session.setCodexState({ busy: true, threadId, turnId: "" });
                    if (chatThreadId !== threadId) {
                        chatThreadId = threadId;
                        session.emitThread("chat_message", threadId, chatMessage);
                    }
                },
                onTurn: (actualTurnId) => {
                    turnId = actualTurnId;
                    session.setCodexState({ busy: true, threadId, turnId });
                },
                onFinish: () => {
                    if (clientId) session.releaseClient(clientId);
                    session.setCodexState({ busy: false, threadId, turnId });
                },
            });
            res.json({ ok: true, threadId });
        } catch (error) {
            session.setCodexState({ busy: false, threadId: String(req.body?.threadId || workspace.activeThreadId || ""), turnId: "" });
            throw error;
        }
    }));
    app.post("/agent/codex/interrupt", (req, res) => {
        const ok = interruptCodexTurn(String(req.body?.threadId || ""));
        res.json({ ok });
    });
    app.post("/agent/claude/turn", (req, res) => {
        runClaudeTurn(withAgentPrompt(String(req.body?.prompt || "")), emit);
        res.json({ ok: true });
    });
    app.use((_req, res) => res.status(404).json({ ok: false, error: "not found" }));
    app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ ok: false, error: error.message }));

    app.listen(port, "127.0.0.1", () => {
        console.log("Infinite Canvas Agent");
        console.log(`Local URL: ${config.url}`);
        console.log(`Connect token: ${config.token}`);
        console.log("Codex MCP is not installed by this command.");
        console.log("Optional MCP add: codex mcp add infinite-canvas -- npx -y @basketikun/canvas-agent mcp");
        console.log("Remove manually added MCP: codex mcp remove infinite-canvas");
    });
}

function route(handler: (req: Request, res: Response) => Promise<unknown>) {
    return (req: Request, res: Response, next: NextFunction) => void handler(req, res).catch(next);
}

function routeParam(value: string | string[]) {
    return Array.isArray(value) ? value[0] || "" : value;
}

function requestUrl(req: Request, config: CanvasAgentConfig) {
    return new URL(req.originalUrl || req.url || "/", config.url);
}

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

function validToken(req: Request, url: URL, token: string) {
    const header = req.headers["x-canvas-agent-token"];
    return url.searchParams.get("token") === token || header === token || (Array.isArray(header) && header.includes(token));
}
