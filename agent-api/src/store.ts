import type { AgentRun, AgentRunStatus, CanvasWorkspace, Conversation, ConversationSession, JsonObject, NewRuntimeEvent, Project, ProjectSkill, RequestContext, RuntimeEvent } from "./types.js";

export interface ResearchStore {
    createProject(userId: string, name: string): Promise<Project>;
    listProjects(userId: string): Promise<Project[]>;
    readProject(userId: string, projectId: string): Promise<Project>;
    deleteProject(userId: string, projectId: string): Promise<void>;
    readCanvas(ctx: RequestContext): Promise<CanvasWorkspace>;
    saveCanvasState(ctx: RequestContext, revision: number, snapshot: JsonObject): Promise<CanvasWorkspace>;

    createConversation(ctx: RequestContext, title: string): Promise<Conversation>;
    listConversations(ctx: RequestContext): Promise<Conversation[]>;
    readConversation(ctx: RequestContext, conversationId: string): Promise<Conversation>;
    archiveConversation(ctx: RequestContext, conversationId: string): Promise<void>;
    loadConversationSession(ctx: RequestContext, conversationId: string): Promise<ConversationSession>;
    saveConversationSession(ctx: RequestContext, conversationId: string, session: ConversationSession): Promise<number>;

    bindCodexThread(ctx: RequestContext, conversationId: string, threadId: string): Promise<Conversation>;
    bindCodexTurn(ctx: RequestContext, conversationId: string, runId: string, turnId: string): Promise<AgentRun>;
    beginRun(ctx: RequestContext, conversationId: string): Promise<AgentRun>;
    finishRun(ctx: RequestContext, runId: string, status: Exclude<AgentRunStatus, "running">): Promise<void>;
    readRun(ctx: RequestContext, conversationId: string, runId: string): Promise<AgentRun>;
    appendEvent(ctx: RequestContext, event: NewRuntimeEvent): Promise<RuntimeEvent>;
    listEvents(ctx: RequestContext, conversationId: string, after: number): Promise<RuntimeEvent[]>;

    listSkills(ctx: RequestContext): Promise<ProjectSkill[]>;
    saveSkill(ctx: RequestContext, input: { name: string; definition: string; enabled: boolean }): Promise<ProjectSkill>;
    deleteSkill(ctx: RequestContext, name: string): Promise<void>;
}
