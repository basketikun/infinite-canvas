import crypto from "node:crypto";

import { AppError } from "./errors.js";
import type { ResearchStore } from "./store.js";
import { PI_SESSION_STORAGE_VERSION, type AgentRun, type AgentRunStatus, type CanvasWorkspace, type Conversation, type ConversationSession, type JsonObject, type NewRuntimeEvent, type Project, type ProjectSkill, type RequestContext, type RuntimeEvent } from "./types.js";

type ProjectRecord = Project & { canvas: CanvasWorkspace };

export class InMemoryResearchStore implements ResearchStore {
    private readonly projects = new Map<string, ProjectRecord>();
    private readonly conversations = new Map<string, Conversation>();
    private readonly sessions = new Map<string, ConversationSession>();
    private readonly runs = new Map<string, AgentRun>();
    private readonly events: RuntimeEvent[] = [];
    private readonly skills = new Map<string, ProjectSkill>();
    private eventSequence = 0;

    async createProject(userId: string, name: string) {
        const now = new Date().toISOString();
        const projectId = crypto.randomUUID();
        const canvasWorkspaceId = crypto.randomUUID();
        const project: Project = { id: projectId, ownerUserId: userId, name, canvasWorkspaceId, createdAt: now, updatedAt: now };
        const canvas: CanvasWorkspace = { id: canvasWorkspaceId, projectId, revision: 0, snapshot: null, createdAt: now, updatedAt: now };
        this.projects.set(projectId, { ...project, canvas });
        return project;
    }

    async listProjects(userId: string) {
        return [...this.projects.values()].filter((project) => project.ownerUserId === userId).map(({ canvas: _canvas, ...project }) => project);
    }

    async readProject(userId: string, projectId: string) {
        const project = this.ownedProject(userId, projectId);
        const { canvas: _canvas, ...value } = project;
        return value;
    }

    async deleteProject(userId: string, projectId: string) {
        this.ownedProject(userId, projectId);
        this.projects.delete(projectId);
        [...this.conversations.values()].filter((item) => item.projectId === projectId).forEach((item) => {
            this.conversations.delete(item.id);
            this.sessions.delete(item.id);
            [...this.runs.values()].filter((run) => run.conversationId === item.id).forEach((run) => this.runs.delete(run.id));
        });
        [...this.skills.values()].filter((skill) => skill.projectId === projectId).forEach((skill) => this.skills.delete(skill.id));
    }

    async readCanvas(ctx: RequestContext) {
        const canvas = this.contextProject(ctx).canvas;
        return { ...canvas, snapshot: canvas.snapshot ? structuredClone(canvas.snapshot) : null };
    }

    async saveCanvasState(ctx: RequestContext, revision: number, snapshot: JsonObject) {
        const project = this.contextProject(ctx);
        if (revision > project.canvas.revision) project.canvas = { ...project.canvas, revision, snapshot: structuredClone(snapshot), updatedAt: new Date().toISOString() };
        return { ...project.canvas, snapshot: project.canvas.snapshot ? structuredClone(project.canvas.snapshot) : null };
    }

    async createConversation(ctx: RequestContext, title: string) {
        this.contextProject(ctx);
        const now = new Date().toISOString();
        const conversation: Conversation = { id: crypto.randomUUID(), projectId: ctx.projectId, ownerUserId: ctx.userId, title, status: "active", sessionRevision: 0, codexThreadId: null, createdAt: now, updatedAt: now };
        this.conversations.set(conversation.id, conversation);
        this.sessions.set(conversation.id, { storageVersion: PI_SESSION_STORAGE_VERSION, revision: 0, header: null, entries: [] });
        return { ...conversation };
    }

    async listConversations(ctx: RequestContext) {
        this.contextProject(ctx);
        return [...this.conversations.values()].filter((item) => item.projectId === ctx.projectId && item.ownerUserId === ctx.userId).map((item) => ({ ...item }));
    }

    async readConversation(ctx: RequestContext, conversationId: string) {
        return { ...this.ownedConversation(ctx, conversationId) };
    }

    async archiveConversation(ctx: RequestContext, conversationId: string) {
        const conversation = this.ownedConversation(ctx, conversationId);
        if ([...this.runs.values()].some((run) => run.conversationId === conversationId && run.status === "running")) throw new AppError("当前对话仍在运行", 409, "conversation_busy");
        this.conversations.set(conversationId, { ...conversation, status: "archived", updatedAt: new Date().toISOString() });
    }

    async loadConversationSession(ctx: RequestContext, conversationId: string) {
        this.ownedConversation(ctx, conversationId);
        const session = this.sessions.get(conversationId) || { storageVersion: PI_SESSION_STORAGE_VERSION, revision: 0, header: null, entries: [] };
        return structuredClone(session);
    }

    async saveConversationSession(ctx: RequestContext, conversationId: string, session: ConversationSession) {
        if (session.storageVersion !== PI_SESSION_STORAGE_VERSION) throw new AppError("不支持当前对话存储版本，已拒绝覆盖", 409, "unsupported_session_storage_version");
        const conversation = this.ownedConversation(ctx, conversationId);
        const current = this.sessions.get(conversationId) || { storageVersion: PI_SESSION_STORAGE_VERSION, revision: 0, header: null, entries: [] };
        if (current.revision !== session.revision) throw new AppError("对话已在其他运行中更新", 409, "session_revision_conflict");
        const revision = current.revision + 1;
        this.sessions.set(conversationId, { storageVersion: session.storageVersion, revision, header: structuredClone(session.header), entries: structuredClone(session.entries) });
        this.conversations.set(conversationId, { ...conversation, sessionRevision: revision, updatedAt: new Date().toISOString() });
        return revision;
    }

    async bindCodexThread(ctx: RequestContext, conversationId: string, threadId: string) {
        const conversation = this.ownedConversation(ctx, conversationId);
        const next = { ...conversation, codexThreadId: threadId, updatedAt: new Date().toISOString() };
        this.conversations.set(conversationId, next);
        return { ...next };
    }

    async bindCodexTurn(ctx: RequestContext, conversationId: string, runId: string, turnId: string) {
        const run = await this.readRun(ctx, conversationId, runId);
        const next = { ...run, codexTurnId: turnId };
        this.runs.set(runId, next);
        return { ...next };
    }

    async beginRun(ctx: RequestContext, conversationId: string) {
        this.ownedConversation(ctx, conversationId);
        const existing = [...this.runs.values()].find((run) => run.conversationId === conversationId && run.status === "running");
        if (existing) throw new AppError("当前对话已有任务正在运行", 409, "conversation_busy");
        const run: AgentRun = { id: crypto.randomUUID(), conversationId, actorUserId: ctx.userId, status: "running", codexTurnId: null, startedAt: new Date().toISOString(), completedAt: null };
        this.runs.set(run.id, run);
        return { ...run };
    }

    async finishRun(ctx: RequestContext, runId: string, status: Exclude<AgentRunStatus, "running">) {
        const run = this.runs.get(runId);
        if (!run) throw new AppError("找不到运行记录", 404, "run_not_found");
        this.ownedConversation(ctx, run.conversationId);
        this.runs.set(runId, { ...run, status, completedAt: new Date().toISOString() });
    }

    async readRun(ctx: RequestContext, conversationId: string, runId: string) {
        this.ownedConversation(ctx, conversationId);
        const run = this.runs.get(runId);
        if (!run || run.conversationId !== conversationId) throw new AppError("找不到运行记录", 404, "run_not_found");
        return { ...run };
    }

    async appendEvent(ctx: RequestContext, event: NewRuntimeEvent) {
        this.ownedConversation(ctx, event.conversationId);
        const value: RuntimeEvent = { ...event, sequence: ++this.eventSequence, createdAt: new Date().toISOString() };
        this.events.push(structuredClone(value));
        return value;
    }

    async listEvents(ctx: RequestContext, conversationId: string, after: number) {
        this.ownedConversation(ctx, conversationId);
        return this.events.filter((event) => event.conversationId === conversationId && event.sequence > after).map((event) => structuredClone(event));
    }

    async listSkills(ctx: RequestContext) {
        this.contextProject(ctx);
        return [...this.skills.values()].filter((skill) => skill.projectId === ctx.projectId).map((skill) => ({ ...skill }));
    }

    async saveSkill(ctx: RequestContext, input: { name: string; definition: string; enabled: boolean }) {
        this.contextProject(ctx);
        const existing = [...this.skills.values()].find((skill) => skill.projectId === ctx.projectId && skill.name === input.name);
        const now = new Date().toISOString();
        const skill: ProjectSkill = existing
            ? { ...existing, ...input, updatedAt: now }
            : { id: crypto.randomUUID(), projectId: ctx.projectId, ...input, createdAt: now, updatedAt: now };
        this.skills.set(skill.id, skill);
        return { ...skill };
    }

    async deleteSkill(ctx: RequestContext, name: string) {
        this.contextProject(ctx);
        const skill = [...this.skills.values()].find((item) => item.projectId === ctx.projectId && item.name === name);
        if (!skill) throw new AppError("找不到 Skill", 404, "skill_not_found");
        this.skills.delete(skill.id);
    }

    private ownedProject(userId: string, projectId: string) {
        const project = this.projects.get(projectId);
        if (!project || project.ownerUserId !== userId) throw new AppError("找不到项目", 404, "project_not_found");
        return project;
    }

    private contextProject(ctx: RequestContext) {
        const project = this.ownedProject(ctx.userId, ctx.projectId);
        if (project.canvasWorkspaceId !== ctx.canvasWorkspaceId) throw new AppError("画布工作区与项目不匹配", 403, "canvas_scope_mismatch");
        return project;
    }

    private ownedConversation(ctx: RequestContext, conversationId: string) {
        this.contextProject(ctx);
        const conversation = this.conversations.get(conversationId);
        if (!conversation || conversation.projectId !== ctx.projectId || conversation.ownerUserId !== ctx.userId) throw new AppError("找不到对话", 404, "conversation_not_found");
        return conversation;
    }
}
