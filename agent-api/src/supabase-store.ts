import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "./errors.js";
import type { ResearchStore } from "./store.js";
import { PI_SESSION_STORAGE_VERSION, type AgentRunStatus, type ConversationSession, type NewRuntimeEvent, type RequestContext } from "./types.js";

export class SupabaseResearchStore implements ResearchStore {
    constructor(private readonly client: SupabaseClient) {}

    async createProject(_userId: string, name: string) {
        const data = await this.rpc("create_project_with_canvas", { project_name: name });
        return project(row(first(data)));
    }

    async listProjects(_userId: string) {
        const { data, error } = await this.client.from("projects").select("id,owner_user_id,name,created_at,updated_at,canvas_workspaces!inner(id)").order("updated_at", { ascending: false });
        if (error) throw databaseError(error);
        return (data || []).map((value) => project(row(value)));
    }

    async readProject(_userId: string, projectId: string) {
        const { data, error } = await this.client.from("projects").select("id,owner_user_id,name,created_at,updated_at,canvas_workspaces!inner(id)").eq("id", projectId).maybeSingle();
        if (error) throw databaseError(error);
        if (!data) throw new AppError("找不到项目", 404, "project_not_found");
        return project(row(data));
    }

    async deleteProject(_userId: string, projectId: string) {
        const { data, error } = await this.client.from("projects").delete().eq("id", projectId).select("id").maybeSingle();
        if (error) throw databaseError(error);
        if (!data) throw new AppError("找不到项目", 404, "project_not_found");
    }

    async readCanvas(ctx: RequestContext) {
        const { data, error } = await this.client.from("canvas_workspaces").select("id,project_id,revision,created_at,updated_at").eq("id", ctx.canvasWorkspaceId).eq("project_id", ctx.projectId).maybeSingle();
        if (error) throw databaseError(error);
        if (!data) throw new AppError("找不到画布工作区", 404, "canvas_not_found");
        return canvas(row(data));
    }

    async advanceCanvasRevision(ctx: RequestContext, revision: number) {
        const data = await this.rpc("advance_canvas_revision", { target_project_id: ctx.projectId, target_revision: revision });
        const value = first(data);
        if (!value) throw new AppError("找不到画布工作区", 404, "canvas_not_found");
        return canvas(row(value));
    }

    async createConversation(ctx: RequestContext, title: string) {
        const { data, error } = await this.client.from("conversations").insert({ project_id: ctx.projectId, owner_user_id: ctx.userId, title }).select().single();
        if (error) throw databaseError(error);
        return conversation(row(data));
    }

    async listConversations(ctx: RequestContext) {
        const { data, error } = await this.client.from("conversations").select("id,project_id,owner_user_id,title,status,session_revision,created_at,updated_at").eq("project_id", ctx.projectId).order("updated_at", { ascending: false });
        if (error) throw databaseError(error);
        return (data || []).map((value) => conversation(row(value)));
    }

    async readConversation(ctx: RequestContext, conversationId: string) {
        const { data, error } = await this.client.from("conversations").select("id,project_id,owner_user_id,title,status,session_revision,created_at,updated_at").eq("id", conversationId).eq("project_id", ctx.projectId).maybeSingle();
        if (error) throw databaseError(error);
        if (!data) throw new AppError("找不到对话", 404, "conversation_not_found");
        return conversation(row(data));
    }

    async archiveConversation(ctx: RequestContext, conversationId: string) {
        await this.readConversation(ctx, conversationId);
        const { data: activeRuns, error: activeRunError } = await this.client.from("agent_runs").select("id").eq("conversation_id", conversationId).eq("status", "running").limit(1);
        if (activeRunError) throw databaseError(activeRunError);
        if (activeRuns?.length) throw new AppError("当前对话仍在运行", 409, "conversation_busy");
        const { data, error } = await this.client.from("conversations").update({ status: "archived" }).eq("id", conversationId).eq("project_id", ctx.projectId).select("id").maybeSingle();
        if (error) throw databaseError(error);
        if (!data) throw new AppError("找不到对话", 404, "conversation_not_found");
    }

    async loadConversationSession(ctx: RequestContext, conversationId: string): Promise<ConversationSession> {
        const { data, error } = await this.client.from("conversations").select("session_storage_version,session_revision,session_header,session_entries").eq("id", conversationId).eq("project_id", ctx.projectId).maybeSingle();
        if (error) throw databaseError(error);
        if (!data) throw new AppError("找不到对话", 404, "conversation_not_found");
        const value = row(data);
        const storageVersion = number(value.session_storage_version);
        if (storageVersion !== PI_SESSION_STORAGE_VERSION) throw new AppError("不支持当前对话存储版本，已拒绝覆盖", 409, "unsupported_session_storage_version");
        return {
            storageVersion,
            revision: number(value.session_revision),
            header: value.session_header && typeof value.session_header === "object" && !Array.isArray(value.session_header) ? row(value.session_header) : null,
            entries: Array.isArray(value.session_entries) ? value.session_entries.filter(isRow).map(row) : [],
        };
    }

    async saveConversationSession(ctx: RequestContext, conversationId: string, session: ConversationSession) {
        if (session.storageVersion !== PI_SESSION_STORAGE_VERSION) throw new AppError("不支持当前对话存储版本，已拒绝覆盖", 409, "unsupported_session_storage_version");
        const data = await this.rpc("save_conversation_session", {
            target_project_id: ctx.projectId,
            target_conversation_id: conversationId,
            expected_revision: session.revision,
            next_header: session.header,
            next_entries: session.entries,
        });
        const value = first(data);
        if (!value) throw new AppError("对话已在其他运行中更新", 409, "session_revision_conflict");
        return number(row(value).session_revision);
    }

    async beginRun(ctx: RequestContext, conversationId: string) {
        await this.readConversation(ctx, conversationId);
        const { data, error } = await this.client.from("agent_runs").insert({ conversation_id: conversationId, actor_user_id: ctx.userId }).select().single();
        if (error) throw databaseError(error);
        return run(row(data));
    }

    async finishRun(ctx: RequestContext, runId: string, status: Exclude<AgentRunStatus, "running">) {
        const { data, error } = await this.client.from("agent_runs").update({ status, completed_at: new Date().toISOString() }).eq("id", runId).eq("actor_user_id", ctx.userId).select("id").maybeSingle();
        if (error) throw databaseError(error);
        if (!data) throw new AppError("找不到运行记录", 404, "run_not_found");
    }

    async readRun(ctx: RequestContext, conversationId: string, runId: string) {
        const { data, error } = await this.client.from("agent_runs").select().eq("id", runId).eq("conversation_id", conversationId).maybeSingle();
        if (error) throw databaseError(error);
        if (!data) throw new AppError("找不到运行记录", 404, "run_not_found");
        return run(row(data));
    }

    async appendEvent(ctx: RequestContext, event: NewRuntimeEvent) {
        const { data, error } = await this.client.from("agent_events").insert({
            run_id: event.runId,
            project_id: ctx.projectId,
            canvas_workspace_id: ctx.canvasWorkspaceId,
            conversation_id: event.conversationId,
            thread_id: event.threadId,
            turn_id: event.turnId,
            item_id: event.itemId,
            type: event.type,
            protocol_version: event.protocolVersion,
            payload: event.payload,
        }).select().single();
        if (error) throw databaseError(error);
        return runtimeEvent(row(data));
    }

    async listEvents(ctx: RequestContext, conversationId: string, after: number) {
        const { data, error } = await this.client.from("agent_events").select().eq("conversation_id", conversationId).gt("sequence", after).order("sequence", { ascending: true });
        if (error) throw databaseError(error);
        return (data || []).map((value) => runtimeEvent(row(value)));
    }

    async listSkills(ctx: RequestContext) {
        const { data, error } = await this.client.from("project_skills").select().eq("project_id", ctx.projectId).order("name", { ascending: true });
        if (error) throw databaseError(error);
        return (data || []).map((value) => skill(row(value)));
    }

    async saveSkill(ctx: RequestContext, input: { name: string; definition: string; enabled: boolean }) {
        const { data, error } = await this.client.from("project_skills").upsert({ project_id: ctx.projectId, ...input }, { onConflict: "project_id,name" }).select().single();
        if (error) throw databaseError(error);
        return skill(row(data));
    }

    async deleteSkill(ctx: RequestContext, name: string) {
        const { data, error } = await this.client.from("project_skills").delete().eq("project_id", ctx.projectId).eq("name", name).select("id").maybeSingle();
        if (error) throw databaseError(error);
        if (!data) throw new AppError("找不到 Skill", 404, "skill_not_found");
    }

    private async rpc(name: string, args: Record<string, unknown>) {
        const { data, error } = await this.client.rpc(name, args);
        if (error) throw databaseError(error);
        return data;
    }
}

function databaseError(error: { code?: string; message: string }) {
    if (error.code === "23505") return new AppError("当前对话已有任务正在运行", 409, "conversation_busy");
    if (error.code === "P0409") return new AppError(error.message === "conversation_not_active" ? "对话已归档" : "当前对话仍在运行", 409, error.message === "conversation_not_active" ? "conversation_archived" : "conversation_busy");
    if (error.code === "42501") return new AppError("无权访问该资源", 403, "forbidden");
    return new AppError(error.message, 500, "database_error");
}

function project(value: Record<string, unknown>) {
    const nested = Array.isArray(value.canvas_workspaces) ? value.canvas_workspaces[0] : value.canvas_workspace_id ? { id: value.canvas_workspace_id } : null;
    const canvasWorkspaceId = string(row(nested).id);
    if (!canvasWorkspaceId) throw new AppError("项目缺少画布工作区", 500, "invalid_project");
    return { id: string(value.id), ownerUserId: string(value.owner_user_id), name: string(value.name), canvasWorkspaceId, createdAt: string(value.created_at), updatedAt: string(value.updated_at) };
}

function canvas(value: Record<string, unknown>) {
    return { id: string(value.id), projectId: string(value.project_id), revision: number(value.revision), createdAt: string(value.created_at), updatedAt: string(value.updated_at) };
}

function conversation(value: Record<string, unknown>) {
    return { id: string(value.id), projectId: string(value.project_id), ownerUserId: string(value.owner_user_id), title: string(value.title), status: value.status === "archived" ? "archived" as const : "active" as const, sessionRevision: number(value.session_revision), createdAt: string(value.created_at), updatedAt: string(value.updated_at) };
}

function run(value: Record<string, unknown>) {
    const status = ["completed", "failed", "aborted"].includes(string(value.status)) ? string(value.status) as "completed" | "failed" | "aborted" : "running" as const;
    return { id: string(value.id), conversationId: string(value.conversation_id), actorUserId: string(value.actor_user_id), status, startedAt: string(value.started_at), completedAt: value.completed_at ? string(value.completed_at) : null };
}

function runtimeEvent(value: Record<string, unknown>) {
    return {
        protocolVersion: number(value.protocol_version),
        sequence: number(value.sequence),
        type: string(value.type) as import("./types.js").RuntimeEventType,
        projectId: string(value.project_id),
        canvasWorkspaceId: string(value.canvas_workspace_id),
        conversationId: string(value.conversation_id),
        threadId: string(value.thread_id),
        runId: string(value.run_id),
        turnId: string(value.turn_id),
        itemId: string(value.item_id),
        payload: row(value.payload),
        createdAt: string(value.created_at),
    };
}

function skill(value: Record<string, unknown>) {
    return { id: string(value.id), projectId: string(value.project_id), name: string(value.name), definition: string(value.definition), enabled: Boolean(value.enabled), createdAt: string(value.created_at), updatedAt: string(value.updated_at) };
}

function first(value: unknown): unknown {
    return Array.isArray(value) ? value[0] : value;
}

function isRow(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function row(value: unknown): Record<string, unknown> {
    return isRow(value) ? value : {};
}

function string(value: unknown) {
    return typeof value === "string" ? value : "";
}

function number(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
