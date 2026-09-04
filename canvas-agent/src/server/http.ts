import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";

import { runClaudeTurn } from "../agent/claude.js";
import { archiveCodexThread, CodexSkillLookupError, CodexTurnEditError, configureCodexSkill, generateCodexSkillDraft, interruptCodexTurn, isRecoverableThreadError, listCodexModels, listCodexSkills, listCodexThreads, readCodexThread, resolveCodexApproval, resolveCodexClarification, resolveCodexSkill, resumeCodexThread, rollbackLatestCodexTurn, runCodexTurn, startCodexThread, summarizeCodexThread, verifyCodexThread } from "../agent/codex.js";
import type { CodexReasoningEffort, CodexSkillSelector } from "../agent/codex-protocol.js";
import { messageMetadataStore } from "../agent/message-metadata.js";
import type { AgentAttachment, AgentPermissionMode } from "../agent/types.js";
import { AGENT_PROTOCOL_VERSION, CanvasSession } from "../canvas/session.js";
import { DEFAULT_PORT, DEFAULT_PROJECT_ID, createProject, getProject, listProjects, loadConfig, removeProject, saveConfig, updateProject, type AgentProjectConfig, type CanvasAgentConfig } from "../config.js";
import { logger } from "../utils/logger.js";
import { checkVersions } from "../version-check.js";
import { SkillStore, SkillStoreError } from "../skills/store.js";

/** 启动仅监听本机的 Canvas Agent HTTP 服务。 */
export function startHttpServer() {
    const config = loadConfig(true);
    const port = Number(process.env.PORT) || Number(new URL(config.url).port) || DEFAULT_PORT;
    config.url = `http://127.0.0.1:${port}`;
    saveConfig(config);

    const initialProject = getProject(config, DEFAULT_PROJECT_ID);
    const session = new CanvasSession(initialProject.activeThreadId || "", initialProject.id);
    const clientProjects = new Map<string, string>();
    const skillStores = new Map<string, SkillStore>();
    let activeProjectId = initialProject.id;
    const projectForClient = (clientId: string) => {
        const projectId = clientProjects.get(clientId) || DEFAULT_PROJECT_ID;
        try {
            return getProject(config, projectId);
        } catch (error) {
            if (projectId === DEFAULT_PROJECT_ID) throw error;
            clientProjects.set(clientId, DEFAULT_PROJECT_ID);
            return getProject(config, DEFAULT_PROJECT_ID);
        }
    };
    const requestClientId = (req: Request) => String(req.body?.clientId || req.query.clientId || "");
    const skillStoreFor = (project: AgentProjectConfig) => {
        let store = skillStores.get(project.workspacePath);
        if (!store) {
            store = new SkillStore(project.workspacePath);
            skillStores.set(project.workspacePath, store);
        }
        return store;
    };
    const projectPayload = (project: AgentProjectConfig) => ({ ...project, isDefault: project.id === DEFAULT_PROJECT_ID });
    const projectState = (project: AgentProjectConfig) => ({ project: projectPayload(project), projects: listProjects(config).map(projectPayload), workspace: project });
    const conversationForProject = (project: AgentProjectConfig) => {
        const conversation = session.conversationStateSnapshot;
        return conversation.projectId === project.id
            ? conversation
            : { revision: 0, projectId: project.id, conversationId: project.activeThreadId || "", threadId: project.activeThreadId || "", status: "idle" as const, mcpStatuses: {} };
    };
    const assertProjectThread = async (project: AgentProjectConfig, threadId: string) => {
        await verifyCodexThread(emit, threadId, project.workspacePath);
    };
    const canRecoverProjectThread = (error: unknown) => isRecoverableThreadError(error) || /该 Codex 会话不属于当前画布工作空间|该会话不属于当前项目|thread(?: id)? .*not found/i.test(error instanceof Error ? error.message : String(error));
    /** 将 Agent 事件广播到所属线程或全部网页。 */
    const emit = (type: string, payload: unknown) => {
        const value = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : { value: payload };
        if (type === "skills_changed") {
            session.emitAll(type, value);
            return;
        }
        if (type === "agent_bootstrap" && value.phase === "preheat") {
            if (value.type === "mcp.startup") session.updateConversationMcp(String(value.name || ""), startupStatus(value.status), String(value.error || "") || null, String(value.failureReason || "") || null);
            if (value.type === "mcp.complete") session.completeConversationMcpInventory(mcpInventory(value.services));
        }
        const scope = session.codexBusy ? session.codexEventScope : { threadId: "", turnId: "", sourceClientId: "" };
        const threadId = String(value.threadId || value.thread_id || scope.threadId || getProject(config, activeProjectId).activeThreadId || "");
        const turnId = String(value.turnId || value.turn_id || scope.turnId || "");
        const sourceClientId = String(value.sourceClientId || scope.sourceClientId || "");
        const data = {
            ...value,
            projectId: String(value.projectId || activeProjectId),
            ...(threadId ? { threadId, thread_id: threadId } : {}),
            ...(turnId ? { turnId, turn_id: turnId } : {}),
            ...(sourceClientId ? { sourceClientId } : {}),
        };
        session.trackCodexEvent(type, data);
        threadId ? session.emitThread(type, threadId, data) : session.emitAll(type, data);
    };
    /** 保存并广播当前项目的活跃线程。 */
    const setActiveThread = (project: AgentProjectConfig, activeThreadId: string, payload: Record<string, unknown> = {}, preserveConversation = false) => {
        activeProjectId = project.id;
        const workspace = updateProject(config, project.id, { activeThreadId: activeThreadId || undefined });
        if (!preserveConversation) session.activateConversation(activeThreadId, String(payload.sourceClientId || "") || undefined, project.id);
        if (!session.codexBusy && session.codexThreadId !== activeThreadId) session.setCodexState({ threadId: activeThreadId, turnId: "", projectId: project.id });
        session.emitThread("workspace_changed", activeThreadId, { ...payload, projectId: project.id, activeThreadId, conversation: session.conversationStateSnapshot });
        return workspace;
    };
    let draftThreadStart: ReturnType<typeof startCodexThread> | null = null;
    let skillDraftRunning = false;
    const prepareDraftThread = (project: AgentProjectConfig, clientId: string, permission: AgentPermissionMode) => {
        if (draftThreadStart) return draftThreadStart;
        activeProjectId = project.id;
        let prepared!: ReturnType<typeof startCodexThread>;
        prepared = (async () => {
            emit("agent_bootstrap", { type: "codex.preparing", sourceClientId: clientId });
            try {
                const thread = await startCodexThread(emit, project.workspacePath, permission, true);
                if (draftThreadStart !== prepared) return thread;
                const threadId = String((thread as Record<string, unknown>).id || "");
                if (threadId && !getProject(config, project.id).activeThreadId) {
                    session.completeConversationPreparation(threadId);
                    setActiveThread(project, threadId, { emptyThread: true, draftThread: true, sourceClientId: clientId }, true);
                }
                return thread;
            } catch (error) {
                if (draftThreadStart === prepared) {
                    const text = error instanceof Error ? error.message : String(error);
                    session.failConversationPreparation(text);
                    emit("agent_bootstrap", { type: "codex.prepare_failed", sourceClientId: clientId, error: text });
                }
                throw error;
            } finally {
                if (draftThreadStart === prepared) draftThreadStart = null;
            }
        })();
        draftThreadStart = prepared;
        return prepared;
    };
    /** 恢复已有线程并等待完整 MCP 清单，供启动恢复和手动切换共用。 */
    const prepareExistingThread = async (project: AgentProjectConfig, threadId: string, clientId = "", permission: AgentPermissionMode = "request") => {
        activeProjectId = project.id;
        session.beginConversation({ conversationId: threadId, threadId, sourceClientId: clientId || undefined, projectId: project.id });
        emit("agent_bootstrap", { type: "codex.preparing", threadId, sourceClientId: clientId || undefined, projectId: project.id });
        const result = await resumeCodexThread(emit, threadId, project.workspacePath, permission, true);
        session.completeConversationPreparation(threadId);
        return result;
    };
    const failPreparedConversation = (error: unknown, threadId: string, clientId = "") => {
        const text = error instanceof Error ? error.message : String(error);
        session.failConversationPreparation(text);
        emit("agent_bootstrap", { type: "codex.prepare_failed", threadId, sourceClientId: clientId || undefined, error: text });
    };
    const activateProject = async (project: AgentProjectConfig, clientId: string, permission: AgentPermissionMode = "request") => {
        activeProjectId = project.id;
        const activeThreadId = project.activeThreadId || "";
        if (activeThreadId) {
            try {
                const result = await prepareExistingThread(project, activeThreadId, clientId, permission);
                const workspace = setActiveThread(project, activeThreadId, { sourceClientId: clientId }, true);
                return { ...projectState(workspace), conversation: session.conversationStateSnapshot, ...result };
            } catch (error) {
                if (!canRecoverProjectThread(error)) throw error;
                session.beginConversation({ sourceClientId: clientId, projectId: project.id });
                setActiveThread(project, "", { emptyThread: true, draftThread: true, sourceClientId: clientId }, true);
            }
        } else {
            session.beginConversation({ sourceClientId: clientId, projectId: project.id });
            setActiveThread(project, "", { emptyThread: true, draftThread: true, sourceClientId: clientId }, true);
        }
        const thread = await prepareDraftThread(project, clientId, permission);
        return { ...projectState(getProject(config, project.id)), conversation: session.conversationStateSnapshot, thread: summarizeCodexThread(thread), messages: [] };
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
        const clientId = String(req.query.clientId || "");
        const requestedProjectId = String(req.query.projectId || "");
        if (clientId && requestedProjectId) clientProjects.set(clientId, requestedProjectId);
        const project = projectForClient(clientId);
        session.openEvents(requestUrl(req, config), res, project.activeThreadId || "", project.id);
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
    app.get("/agent/message-assets/:messageKey/:assetFile", route(async (req, res) => {
        const asset = await messageMetadataStore.readAsset(routeParam(req.params.messageKey), routeParam(req.params.assetFile));
        if (!asset) return void res.status(404).json({ ok: false, error: "message asset not found" });
        res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
        res.type(asset.contentType).send(asset.data);
    }));
    app.post("/agent/local-file/reveal", route(async (req, res) => {
        const filePath = String(req.body?.path || "");
        if (!path.isAbsolute(filePath)) return res.status(400).json({ ok: false, error: "文件路径必须是绝对路径" });
        const file = await stat(filePath);
        await revealLocalFile(filePath, file.isDirectory());
        res.json({ ok: true });
    }));
    app.post("/agent/local-directory/select", route(async (req, res) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        req.once("aborted", abort);
        try {
            res.json({ ok: true, path: await selectLocalDirectory(controller.signal) });
        } finally {
            req.off("aborted", abort);
        }
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
    app.get("/agent/codex/projects", (req, res) => {
        const project = projectForClient(requestClientId(req));
        res.json({ ok: true, ...projectState(project), conversation: conversationForProject(project) });
    });
    app.post("/agent/codex/projects", codexMutation(async (req, res) => {
        const clientId = requestClientId(req);
        if (!clientId || !session.hasClient(clientId)) return res.status(409).json({ ok: false, error: "当前网页未连接，请重新连接后再试" });
        const project = createProject(config, { name: String(req.body?.name || ""), workspacePath: String(req.body?.workspacePath || "") });
        const previousProjectId = clientProjects.get(clientId);
        let result: Awaited<ReturnType<typeof activateProject>>;
        try {
            result = await activateProject(project, clientId, permissionMode(req.body?.permissionMode));
        } catch (error) {
            if (previousProjectId) clientProjects.set(clientId, previousProjectId);
            else clientProjects.delete(clientId);
            throw error;
        }
        clientProjects.set(clientId, project.id);
        session.emitAll("projects_changed", { projects: listProjects(config).map(projectPayload), projectId: project.id, sourceClientId: clientId });
        res.status(201).json({ ok: true, ...result });
    }));
    app.post("/agent/codex/projects/:projectId/activate", codexMutation(async (req, res) => {
        const clientId = requestClientId(req);
        if (!clientId || !session.hasClient(clientId)) return res.status(409).json({ ok: false, error: "当前网页未连接，请重新连接后再试" });
        const project = getProject(config, routeParam(req.params.projectId));
        const previousProjectId = clientProjects.get(clientId);
        let result: Awaited<ReturnType<typeof activateProject>>;
        try {
            result = await activateProject(project, clientId, permissionMode(req.body?.permissionMode));
        } catch (error) {
            if (previousProjectId) clientProjects.set(clientId, previousProjectId);
            else clientProjects.delete(clientId);
            throw error;
        }
        clientProjects.set(clientId, project.id);
        res.json({ ok: true, ...result });
    }));
    app.post("/agent/codex/projects/:projectId/delete", codexMutation(async (req, res) => {
        const clientId = requestClientId(req);
        const deletedProjectId = routeParam(req.params.projectId);
        const deletingCurrentProject = clientProjects.get(clientId) === deletedProjectId;
        removeProject(config, deletedProjectId);
        clientProjects.forEach((projectId, id) => {
            if (projectId === deletedProjectId) clientProjects.set(id, DEFAULT_PROJECT_ID);
        });
        const project = projectForClient(clientId);
        const result = activeProjectId === deletedProjectId || deletingCurrentProject ? await activateProject(project, clientId, permissionMode(req.body?.permissionMode)) : { ...projectState(project), conversation: conversationForProject(project) };
        session.emitAll("projects_changed", { projects: listProjects(config).map(projectPayload), deletedProjectId, projectId: project.id, sourceClientId: clientId });
        res.json({ ok: true, ...result });
    }));
    app.get("/agent/codex/workspace", (req, res) => {
        const project = projectForClient(requestClientId(req));
        res.json({ ok: true, ...projectState(project), conversation: conversationForProject(project) });
    });
    app.get("/agent/codex/models", route(async (_req, res) => res.json({ ok: true, ...(await listCodexModels(emit)) })));
    app.get("/agent/codex/skills", route(async (req, res) => {
        const project = projectForClient(requestClientId(req));
        const result = await listCodexSkills(emit, project.workspacePath, String(req.query.forceReload || "") === "1");
        res.json({ ok: true, ...projectState(project), data: result.skills.map((skill) => ({ ...skill, managed: skillStoreFor(project).isManagedPath(skill.path) })), errors: result.errors });
    }));
    app.post("/agent/codex/skills/draft", codexMutation(async (req, res) => {
        const clientId = String(req.body?.clientId || "");
        const project = projectForClient(clientId);
        activeProjectId = project.id;
        const source = String(req.body?.source || "");
        if (source !== "conversation" && source !== "canvas") return res.status(400).json({ ok: false, error: "Skill 草稿来源无效" });
        if (!clientId || !session.hasClient(clientId)) return res.status(409).json({ ok: false, error: "发起提炼的网页已断开，请重新连接后再试" });
        const model = String(req.body?.model || "") || undefined;
        const effort = reasoningEffort(req.body?.effort);
        const previousCodexState = session.codexStateSnapshot;
        skillDraftRunning = true;
        try {
            if (source === "conversation") {
                const threadId = String(req.body?.threadId || "");
                if (!threadId) return res.status(409).json({ ok: false, error: "当前没有可提炼的对话" });
                if (threadId !== (project.activeThreadId || "")) return res.status(409).json({ ok: false, error: "当前对话已在其他页面切换，请同步后重试" });
                await assertProjectThread(project, threadId);
                const history = await readCodexThread(emit, threadId, project.workspacePath);
                if (!history.messages.some((message) => message.role === "user" && message.turnId)) return res.status(409).json({ ok: false, error: "当前对话还没有可提炼的已完成内容" });
                session.setCodexState({ busy: true, threadId, turnId: "", projectId: project.id }, { preserveReplay: true });
                const data = await generateCodexSkillDraft(emit, project.workspacePath, { source, threadId, model, effort });
                if (!session.hasClient(clientId)) return res.status(409).json({ ok: false, error: "发起提炼的网页已断开，请重新连接后再试" });
                return res.json({ ok: true, data });
            }
            const snapshot = session.canvasStateForClient(clientId);
            if (!snapshot || (snapshot as Record<string, unknown>).hasCanvas === false) return res.status(409).json({ ok: false, error: "当前页面没有可提炼的画布" });
            session.setCodexState({ busy: true, threadId: project.activeThreadId || "", turnId: "", projectId: project.id }, { preserveReplay: true });
            const data = await generateCodexSkillDraft(emit, project.workspacePath, { source, snapshot, model, effort });
            if (!session.hasClient(clientId)) return res.status(409).json({ ok: false, error: "发起提炼的网页已断开，请重新连接后再试" });
            return res.json({ ok: true, data });
        } finally {
            skillDraftRunning = false;
            session.setCodexState(previousCodexState, { preserveReplay: true });
        }
    }));
    app.get("/agent/codex/skills/:name", route(async (req, res) => {
        const project = projectForClient(requestClientId(req));
        res.json({ ok: true, ...projectState(project), data: await skillStoreFor(project).get(routeParam(req.params.name)) });
    }));
    app.post("/agent/codex/skills", codexMutation(async (req, res) => {
        const project = projectForClient(requestClientId(req));
        const data = await skillStoreFor(project).create(req.body);
        session.emitAll("skills_changed", { forceReload: true, projectId: project.id });
        res.status(201).json({ ok: true, ...projectState(project), data });
    }));
    app.post("/agent/codex/skills/:name/enabled", codexMutation(async (req, res) => {
        if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ ok: false, error: "Skill 启用状态无效" });
        const project = projectForClient(requestClientId(req));
        const selector = skillSelector(req.body);
        if (selector.name !== routeParam(req.params.name)) return res.status(400).json({ ok: false, error: "Skill 选择无效" });
        const data = await configureCodexSkill(emit, project.workspacePath, selector, req.body.enabled);
        session.emitAll("skills_changed", { forceReload: true, projectId: project.id });
        res.json({ ok: true, ...projectState(project), data });
    }));
    app.post("/agent/codex/skills/:name/delete", codexMutation(async (req, res) => {
        const project = projectForClient(requestClientId(req));
        await skillStoreFor(project).delete(routeParam(req.params.name), String(req.body?.expectedRevision || ""));
        session.emitAll("skills_changed", { forceReload: true, projectId: project.id });
        res.json({ ok: true, ...projectState(project) });
    }));
    app.post("/agent/codex/skills/:name", codexMutation(async (req, res) => {
        const project = projectForClient(requestClientId(req));
        const data = await skillStoreFor(project).update(routeParam(req.params.name), req.body);
        session.emitAll("skills_changed", { forceReload: true, projectId: project.id });
        res.json({ ok: true, ...projectState(project), data });
    }));
    app.get("/agent/codex/threads", route(async (req, res) => {
        const project = projectForClient(requestClientId(req));
        const result = await listCodexThreads(emit, { cwd: project.workspacePath, searchTerm: String(req.query.searchTerm || "") });
        let data = result.data;
        const activeThreadId = project.activeThreadId || "";
        if (activeThreadId && !data.some((thread) => thread.id === activeThreadId)) {
            try {
                const activeThread = await verifyCodexThread(emit, activeThreadId, project.workspacePath);
                data = [activeThread, ...data];
            } catch (error) {
                if (!isRecoverableThreadError(error)) throw error;
            }
        }
        res.json({ ok: true, ...projectState(project), conversation: conversationForProject(project), data, nextCursor: result.nextCursor, backwardsCursor: result.backwardsCursor });
    }));
    app.post("/agent/codex/threads/new", codexMutation(async (req, res) => {
        const clientId = String(req.body?.clientId || "");
        const project = projectForClient(clientId);
        activeProjectId = project.id;
        session.beginConversation({ sourceClientId: clientId, projectId: project.id });
        setActiveThread(project, "", { emptyThread: true, draftThread: true, sourceClientId: clientId }, true);
        const thread = await prepareDraftThread(project, clientId, permissionMode(req.body?.permissionMode));
        res.json({ ok: true, ...projectState(getProject(config, project.id)), conversation: conversationForProject(project), thread: summarizeCodexThread(thread), messages: [] });
    }));
    app.post("/agent/codex/threads/reset", codexMutation(async (req, res) => {
        const clientId = String(req.body?.clientId || "");
        const project = projectForClient(clientId);
        activeProjectId = project.id;
        session.beginConversation({ sourceClientId: clientId, projectId: project.id });
        setActiveThread(project, "", { emptyThread: true, draftThread: true, sourceClientId: clientId }, true);
        await prepareDraftThread(project, clientId, permissionMode(req.body?.permissionMode));
        res.json({ ok: true, ...projectState(getProject(config, project.id)), conversation: conversationForProject(project) });
    }));
    app.get("/agent/codex/threads/:threadId", route(async (req, res) => {
        const project = projectForClient(requestClientId(req));
        const threadId = routeParam(req.params.threadId);
        res.json({ ok: true, ...projectState(project), conversation: conversationForProject(project), ...(await readCodexThread(emit, threadId, project.workspacePath)) });
    }));
    app.post("/agent/codex/history/ack", route(async (req, res) => {
        const project = projectForClient(requestClientId(req));
        const threadId = String(req.body?.threadId || "");
        if (threadId && threadId !== (project.activeThreadId || "")) await assertProjectThread(project, threadId);
        const turnIds = Array.isArray(req.body?.turnIds) ? req.body.turnIds.map(String) : [];
        session.acknowledgeCodexHistory(threadId, turnIds);
        res.json({ ok: true });
    }));
    app.post("/agent/codex/threads/:threadId/resume", codexMutation(async (req, res) => {
        const threadId = routeParam(req.params.threadId);
        const clientId = String(req.body?.clientId || "");
        const project = projectForClient(clientId);
        try {
            const result = await prepareExistingThread(project, threadId, clientId, permissionMode(req.body?.permissionMode));
            const nextWorkspace = setActiveThread(project, threadId, { sourceClientId: clientId }, true);
            res.json({ ok: true, ...projectState(nextWorkspace), conversation: conversationForProject(nextWorkspace), ...result });
        } catch (error) {
            failPreparedConversation(error, threadId, clientId);
            throw error;
        }
    }));
    app.post("/agent/codex/threads/:threadId/delete", codexMutation(async (req, res) => {
        const clientId = String(req.body?.clientId || "");
        const project = projectForClient(clientId);
        const threadId = routeParam(req.params.threadId);
        await archiveCodexThread(emit, threadId, project.workspacePath);
        const nextWorkspace = setActiveThread(project, project.activeThreadId === threadId ? "" : project.activeThreadId || "", { sourceClientId: clientId });
        res.json({ ok: true, ...projectState(nextWorkspace), conversation: conversationForProject(nextWorkspace) });
    }));
    app.post("/agent/codex/turn", codexMutation(async (req, res) => {
        const attachments = Array.isArray(req.body?.attachments) ? (req.body.attachments as AgentAttachment[]) : [];
        const prompt = String(req.body?.prompt || "");
        if (!prompt.trim()) return res.status(400).json({ ok: false, error: "请输入任务内容" });
        const clientId = String(req.body?.clientId || "");
        if (!clientId || !session.hasClient(clientId)) return res.status(409).json({ ok: false, error: "发起任务的网页已断开，请重新连接后再试" });
        const project = projectForClient(clientId);
        activeProjectId = project.id;
        const requestedThreadId = String(req.body?.threadId || "");
        const activeThreadId = project.activeThreadId || "";
        const conversation = session.conversationStateSnapshot;
        const requestedConversationId = String(req.body?.conversationId || "");
        const expectedRevision = Number(req.body?.expectedRevision || 0);
        if (requestedThreadId !== activeThreadId || conversation.threadId !== activeThreadId || (requestedConversationId && requestedConversationId !== conversation.conversationId) || (expectedRevision && expectedRevision !== conversation.revision)) {
            return res.status(409).json({ ok: false, code: "CONVERSATION_STALE", error: "当前会话已切换，已同步最新状态，请确认后重试", state: conversation });
        }
        if (!activeThreadId || !["ready", "warning"].includes(conversation.status)) {
            return res.status(409).json({ ok: false, code: "CONVERSATION_NOT_READY", error: "Codex 对话仍在初始化，请等待 MCP 加载完成", state: conversation });
        }
        const model = String(req.body?.model || "") || undefined;
        const effort = reasoningEffort(req.body?.effort);
        const skill = req.body?.skill === undefined ? undefined : await resolveCodexSkill(emit, project.workspacePath, skillSelector(req.body.skill), true);
        const messageId = String(req.body?.messageId || Date.now());
        const messageText = String(req.body?.messageText || prompt || `发送了 ${attachments.length} 张图片`);
        const messageMetadata = await messageMetadataStore.recordPending(messageId, req.body?.messageMetadata);
        const replaceLastTurnId = String(req.body?.replaceLastTurnId || "");
        if (replaceLastTurnId) {
            try {
                await rollbackLatestCodexTurn(emit, activeThreadId, replaceLastTurnId, project.workspacePath);
                session.discardCodexTurn(activeThreadId, replaceLastTurnId);
            } catch (error) {
                await messageMetadataStore.remove(messageId, activeThreadId).catch((metadataError) => logger.warn("Failed to remove rejected edit metadata", { clientMessageId: messageId, error: metadataError }));
                throw error;
            }
        }
        let threadId = activeThreadId;
        logger.info("Codex turn accepted", { threadId: req.body?.threadId, model: model || "default", reasoningEffort: effort || "default", promptLength: prompt.length, attachmentCount: attachments.length });
        session.bindClient(clientId);
        session.markConversationRunning(threadId);
        session.setCodexState({ busy: true, threadId, turnId: "", projectId: project.id });
        try {
            let turnId = "";
            const attachmentRefs = session.setTurnAttachments(clientId, attachments);
            session.emitThread("chat_message", threadId, {
                projectId: project.id,
                sourceClientId: clientId,
                message: { id: `${threadId}:pending:synthetic:user`, itemId: "synthetic:user", clientMessageId: messageId, threadId, turnId: "", role: "user", text: messageText, ...messageMetadata },
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
                    projectId: project.id,
                    threadId: eventThreadId,
                    thread_id: eventThreadId,
                    ...(eventTurnId ? { turnId: eventTurnId, turn_id: eventTurnId } : {}),
                    ...(sourceClientId ? { sourceClientId } : {}),
                });
            };
            void runCodexTurn(withAttachmentContext(prompt, attachmentRefs), lifecycleEmit, attachments, {
                threadId,
                cwd: project.workspacePath,
                permissionMode: permissionMode(req.body?.permissionMode),
                model,
                effort,
                allowThreadRecovery: !replaceLastTurnId,
                ...(skill ? { skill: { name: skill.name, path: skill.path } } : {}),
                messageText,
                appEmit: emit,
                onStart: () => session.bindClient(clientId),
                onThread: (actualThreadId) => {
                    const threadChanged = actualThreadId !== threadId;
                    void messageMetadataStore.bindThread(messageId, actualThreadId).catch((error) => logger.warn("Failed to bind message metadata to thread", { clientMessageId: messageId, threadId: actualThreadId, error }));
                    if (actualThreadId !== threadId) {
                        threadId = actualThreadId;
                        setActiveThread(project, threadId, { emptyThread: true, sourceClientId: clientId });
                    }
                    session.markConversationRunning(threadId);
                    session.setCodexState({ busy: true, threadId, turnId: "", projectId: project.id });
                    if (threadChanged) {
                        session.emitThread("chat_message", threadId, {
                            projectId: project.id,
                            sourceClientId: clientId,
                            message: { id: `${threadId}:pending:synthetic:user`, itemId: "synthetic:user", clientMessageId: messageId, threadId, turnId: "", role: "user", text: messageText, ...messageMetadata },
                        });
                    }
                },
                onTurn: (actualTurnId) => {
                    turnId = actualTurnId;
                    void messageMetadataStore.bindTurn(messageId, threadId, turnId).catch((error) => logger.warn("Failed to bind message metadata to turn", { clientMessageId: messageId, threadId, turnId, error }));
                    if (chatTurnId !== turnId) {
                        chatTurnId = turnId;
                        session.emitThread("chat_message", threadId, {
                            projectId: project.id,
                            turnId,
                            sourceClientId: clientId,
                            message: { id: `${threadId}:${turnId}:synthetic:user`, itemId: "synthetic:user", clientMessageId: messageId, threadId, turnId, role: "user", text: messageText, ...messageMetadata },
                        });
                    }
                    logger.info("Codex turn started", { threadId, turnId, model: model || "default", reasoningEffort: effort || "default" });
                    session.setCodexState({ busy: true, threadId, turnId, projectId: project.id });
                },
                onFinish: () => {
                    logger.info("Codex turn finished", { threadId, turnId });
                    if (!turnId) void messageMetadataStore.remove(messageId, threadId).catch((error) => logger.warn("Failed to remove unbound message metadata", { clientMessageId: messageId, error }));
                    session.clearTurnAttachments(clientId);
                    if (clientId) session.releaseClient(clientId);
                    session.setCodexState({ busy: false, threadId, turnId, projectId: project.id });
                    session.finishConversationRun(threadId);
                },
            });
            res.json({ ok: true, threadId });
        } catch (error) {
            await messageMetadataStore.remove(messageId, threadId).catch((metadataError) => logger.warn("Failed to remove rejected message metadata", { clientMessageId: messageId, error: metadataError }));
            session.releaseClient(clientId);
            session.setCodexState({ busy: false, threadId, turnId: "", projectId: project.id });
            session.finishConversationRun(threadId);
            throw error;
        }
    }));

    /** 将 Codex 写操作串行化，避免多窗口在异步请求期间交叉修改会话。 */
    function codexMutation(handler: (req: Request, res: Response) => unknown | Promise<unknown>) {
        return route(async (req, res) => {
            if (!session.beginCodexMutation()) return res.status(409).json({ ok: false, code: "CONVERSATION_BUSY", error: "Codex 正在运行或正在切换会话，请稍后重试", state: session.conversationStateSnapshot });
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
    app.post("/agent/codex/clarification", route(async (req, res) => {
        const requestId = String(req.body?.requestId || "");
        const answers = req.body?.answers;
        if (!requestId || (answers !== null && (!answers || typeof answers !== "object" || Array.isArray(answers))) || !validClarificationAnswers(answers)) return res.status(400).json({ ok: false, error: "澄清答案无效" });
        const result = await resolveCodexClarification(requestId, answers === null ? null : answers as Record<string, unknown>);
        res.status(result.ok ? 200 : 409).json(result.ok ? result : { ...result, error: result.state === "expired" ? "澄清请求已过期" : "澄清请求已失效" });
    }));
    app.post("/agent/codex/interrupt", route(async (req, res) => {
        const ok = await interruptCodexTurn(skillDraftRunning ? undefined : String(req.body?.threadId || ""));
        res.status(ok ? 200 : 409).json({ ok, ...(ok ? {} : { error: "当前没有可停止的任务" }) });
    }));
    app.post("/agent/claude/turn", (req, res) => {
        runClaudeTurn(String(req.body?.prompt || ""), emit);
        res.json({ ok: true });
    });
    app.use((_req, res) => res.status(404).json({ ok: false, error: "not found" }));
    app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
        logger.error("HTTP request failed", { method: req.method, path: req.path, error });
        if (error instanceof SkillStoreError || error instanceof CodexSkillLookupError) return void res.status(error.statusCode).json({ ok: false, error: error.message });
        if (error instanceof CodexTurnEditError) return void res.status(409).json({ ok: false, error: error.message });
        res.status(500).json({ ok: false, error: error.message });
    });

    app.listen(port, "127.0.0.1", () => {
        console.log("Infinite Canvas Agent");
        checkVersions();
        console.log(`Local URL: ${config.url}`);
        console.log(`Connect token: ${config.token}`);
        console.log("Codex MCP is not installed by this command.");
        console.log("Optional MCP add: codex mcp add infinite-canvas -- npx -y @basketikun/canvas-agent@latest mcp");
        console.log("Remove manually added MCP: codex mcp remove infinite-canvas");
        if (logger.enabled) console.log(`Debug log: ${logger.filePath}`);
        logger.info("Canvas Agent started", { url: config.url, workspace: initialProject.workspacePath, debugLog: logger.filePath });
        const activeThreadId = initialProject.activeThreadId || "";
        if (activeThreadId && session.beginCodexMutation()) {
            void prepareExistingThread(initialProject, activeThreadId).catch(async (error) => {
                if (!canRecoverProjectThread(error)) return failPreparedConversation(error, activeThreadId);
                session.beginConversation({ projectId: initialProject.id });
                setActiveThread(initialProject, "", { emptyThread: true, draftThread: true }, true);
                await prepareDraftThread(initialProject, "", "request");
            }).finally(() => session.endCodexMutation()).catch(() => undefined);
        }
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

function startupStatus(value: unknown): "starting" | "ready" | "failed" | "cancelled" {
    return value === "starting" || value === "ready" || value === "failed" ? value : "cancelled";
}

function validClarificationAnswers(value: unknown) {
    if (value === null) return true;
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return Object.values(value as Record<string, unknown>).every((answer) => typeof answer === "string" || (Array.isArray(answer) && answer.every((item) => typeof item === "string")));
}

function mcpInventory(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const server = item as Record<string, unknown>;
        const name = String(server.name || "");
        return name ? [{ name, authStatus: String(server.authStatus || "") || undefined }] : [];
    });
}

/** 读取浏览器提交的 Skill 选择器；真实路径随后必须通过原生列表校验。 */
function skillSelector(value: unknown): CodexSkillSelector {
    const selector = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const name = typeof selector.name === "string" ? selector.name : "";
    const skillPath = typeof selector.path === "string" ? selector.path : "";
    if (!name || !skillPath) throw new CodexSkillLookupError("Skill 选择无效", 400);
    return { name, path: skillPath };
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

/** 打开 Windows 原生文件夹选择器；请求断开时同步终止选择器进程。 */
async function selectLocalDirectory(signal: AbortSignal) {
    if (process.platform !== "win32") throw new Error("当前系统不支持 Windows 文件夹选择器");
    const script = "$shell = New-Object -ComObject Shell.Application; $folder = $shell.BrowseForFolder(0, '选择 Agent 项目目录', 0, 0); if ($folder) { [Console]::Out.Write($folder.Self.Path) }";
    return await new Promise<string | null>((resolve, reject) => {
        const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-WindowStyle", "Normal", "-Command", script], { stdio: ["ignore", "pipe", "pipe"], windowsHide: false });
        let output = "";
        let error = "";
        let aborted = signal.aborted;
        const cancel = () => {
            aborted = true;
            child.kill();
        };
        if (aborted) {
            child.kill();
            return resolve(null);
        }
        signal.addEventListener("abort", cancel, { once: true });
        child.stdout.on("data", (chunk: Buffer) => output += chunk.toString());
        child.stderr.on("data", (chunk: Buffer) => error += chunk.toString());
        child.once("error", reject);
        child.once("close", (code) => {
            signal.removeEventListener("abort", cancel);
            if (aborted) return resolve(null);
            if (code === 0) return resolve(output.trim() || null);
            reject(new Error(error.trim() || "无法打开 Windows 文件夹选择窗口"));
        });
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
