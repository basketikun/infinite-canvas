export type JsonObject = Record<string, unknown>;
export const AGENT_PROTOCOL_VERSION = 1;
export const PI_SESSION_STORAGE_VERSION = 1;

export type Project = {
    id: string;
    ownerUserId: string;
    name: string;
    canvasWorkspaceId: string;
    createdAt: string;
    updatedAt: string;
};

export type CanvasWorkspace = {
    id: string;
    projectId: string;
    revision: number;
    snapshot: JsonObject | null;
    createdAt: string;
    updatedAt: string;
};

export type RequestContext = {
    userId: string;
    projectId: string;
    canvasWorkspaceId: string;
};

export type AgentSessionKey = {
    userId: string;
    projectId: string;
    conversationId: string;
};

export type Conversation = {
    id: string;
    projectId: string;
    ownerUserId: string;
    title: string;
    status: "active" | "archived";
    sessionRevision: number;
    codexThreadId: string | null;
    createdAt: string;
    updatedAt: string;
};

export type ConversationSession = {
    storageVersion: number;
    revision: number;
    header: JsonObject | null;
    entries: JsonObject[];
};

export type AgentRunStatus = "running" | "completed" | "failed" | "aborted";

export type AgentRun = {
    id: string;
    conversationId: string;
    actorUserId: string;
    status: AgentRunStatus;
    codexTurnId: string | null;
    startedAt: string;
    completedAt: string | null;
};

export type RuntimeEventType =
    | "run.started"
    | "assistant.delta"
    | "assistant.completed"
    | "tool.started"
    | "tool.updated"
    | "tool.completed"
    | "canvas.tool.requested"
    | "run.completed"
    | "run.failed"
    | "run.aborted";

export type RuntimeEvent = {
    protocolVersion: number;
    sequence: number;
    type: RuntimeEventType;
    projectId: string;
    canvasWorkspaceId: string;
    conversationId: string;
    threadId: string;
    runId: string;
    turnId: string;
    itemId: string;
    payload: JsonObject;
    createdAt: string;
};

export type NewRuntimeEvent = Omit<RuntimeEvent, "sequence" | "createdAt">;

export type RunTurnInput = {
    conversationId: string;
    prompt: string;
};

export type ProjectSkill = {
    id: string;
    projectId: string;
    name: string;
    definition: string;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
};

export type MemoryScope = "user_project_private";
