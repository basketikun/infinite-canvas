import type { JsonRecord } from "../utils/value.js";

export type CodexThread = JsonRecord & { id: string; cwd: string; turns?: CodexTurn[] };
export type CodexTurn = JsonRecord & { id: string; error?: CodexTurnError | null; durationMs?: number | null };
export type CodexTurnError = JsonRecord & { message: string };
export type CodexItem = JsonRecord & { id: string; type: string; text?: string };
export type CodexPlanStep = { step: string; status: "pending" | "inProgress" | "completed" };
export type CodexPlanUpdate = { threadId: string; turnId: string; explanation?: string | null; plan: CodexPlanStep[]; turnStatus?: string };
export type CodexMcpStartupStatus = { threadId: string | null; name: string; status: "starting" | "ready" | "failed" | "cancelled"; error: string | null; failureReason: "reauthenticationRequired" | null };
export type CodexMcpServerStatus = { name: string; authStatus: "unsupported" | "notLoggedIn" | "bearerToken" | "oAuth" } & JsonRecord;
export type CodexReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type CodexModel = JsonRecord & {
    id: string;
    model: string;
    displayName: string;
    defaultReasoningEffort: CodexReasoningEffort;
    supportedReasoningEfforts: Array<{ reasoningEffort: CodexReasoningEffort; description?: string }>;
    isDefault?: boolean;
};

export type CodexSkillScope = "user" | "repo" | "system" | "admin";
export type CodexSkillInterface = JsonRecord & {
    displayName?: string | null;
    shortDescription?: string | null;
    iconSmall?: string | null;
    iconLarge?: string | null;
    iconSmallUrl?: string | null;
    iconLargeUrl?: string | null;
    brandColor?: string | null;
    defaultPrompt?: string | null;
};
export type CodexSkillMetadata = JsonRecord & {
    name: string;
    description: string;
    shortDescription?: string | null;
    interface?: CodexSkillInterface | null;
    dependencies?: JsonRecord | null;
    path: string;
    scope: CodexSkillScope;
    enabled: boolean;
};
export type CodexSkillError = { path: string; message: string };
export type CodexSkillsListEntry = { cwd: string; skills: CodexSkillMetadata[]; errors: CodexSkillError[] };
export type CodexSkillSelector = { name: string; path: string };

export type CodexTurnInput =
    | { type: "text"; text: string; text_elements: [] }
    | { type: "localImage"; path: string }
    | ({ type: "skill" } & CodexSkillSelector);

type ThreadOptions = {
    approvalPolicy: "never" | "on-request";
    sandbox: "read-only" | "workspace-write" | "danger-full-access";
    config: JsonRecord;
    cwd?: string;
    developerInstructions?: string;
    ephemeral?: boolean;
};

type CodexRequestSpec = {
    initialize: {
        params: {
            clientInfo: { name: string; title: string; version: string };
            capabilities: { experimentalApi: boolean; requestAttestation: boolean };
        };
        result: JsonRecord;
    };
    "thread/start": {
        params: ThreadOptions & { threadSource: "user" };
        result: { thread: CodexThread };
    };
    "thread/resume": {
        params: ThreadOptions & { threadId: string };
        result: { thread: CodexThread };
    };
    "thread/fork": {
        params: ThreadOptions & { threadId: string; threadSource: "user" };
        result: { thread: CodexThread };
    };
    "thread/list": {
        params: {
            limit: number;
            sortKey: "updated_at";
            sortDirection: "desc";
            sourceKinds: Array<"cli" | "vscode" | "appServer" | "exec">;
            cwd: string;
            searchTerm?: string;
        };
        result: { data: CodexThread[]; nextCursor: string | null; backwardsCursor: string | null };
    };
    "thread/read": {
        params: { threadId: string; includeTurns: boolean };
        result: { thread: CodexThread };
    };
    "thread/archive": {
        params: { threadId: string };
        result: Record<string, never>;
    };
    "thread/unsubscribe": {
        params: { threadId: string };
        result: { status: "notLoaded" | "notSubscribed" | "unsubscribed" };
    };
    "model/list": {
        params: { limit: number; includeHidden: boolean };
        result: { data: CodexModel[]; nextCursor: string | null };
    };
    "mcpServerStatus/list": {
        params: { cursor?: string | null; limit?: number | null; detail?: "full" | "toolsAndAuthOnly" | null; threadId?: string | null };
        result: { data: CodexMcpServerStatus[]; nextCursor: string | null };
    };
    "skills/list": {
        params: { cwds: string[]; forceReload?: boolean };
        result: { data: CodexSkillsListEntry[] };
    };
    "skills/config/write": {
        params: { path?: string | null; name?: string | null; enabled: boolean };
        result: { effectiveEnabled: boolean };
    };
    "turn/start": {
        params: { threadId: string; input: CodexTurnInput[]; approvalPolicy: "never" | "on-request"; sandboxPolicy: { type: "readOnly"; networkAccess: boolean } | { type: "workspaceWrite"; networkAccess: boolean } | { type: "dangerFullAccess" }; model?: string; effort?: CodexReasoningEffort; outputSchema?: JsonRecord };
        result: { turn: CodexTurn };
    };
    "turn/interrupt": {
        params: { threadId: string; turnId: string };
        result: Record<string, never>;
    };
};

export type CodexRequestMethod = keyof CodexRequestSpec;
export type CodexRequestParams<Method extends CodexRequestMethod> = CodexRequestSpec[Method]["params"];
export type CodexRequestResult<Method extends CodexRequestMethod> = CodexRequestSpec[Method]["result"];

type TokenUsageBreakdown = {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
};

type CodexNotificationSpec = {
    "thread/started": { thread: CodexThread };
    "turn/started": { threadId?: string; turn: CodexTurn };
    "turn/completed": { threadId?: string; turn: CodexTurn };
    "turn/plan/updated": { threadId?: string; turnId: string; explanation?: string | null; plan: CodexPlanStep[] };
    "item/started": { threadId: string; turnId: string; item: CodexItem };
    "item/completed": { threadId: string; turnId: string; item: CodexItem };
    "item/agentMessage/delta": { threadId: string; turnId: string; itemId: string; delta: string };
    "item/plan/delta": { threadId: string; turnId: string; itemId: string; delta: string };
    "item/reasoning/summaryTextDelta": { threadId: string; turnId: string; itemId: string; delta: string; summaryIndex: number };
    "item/commandExecution/outputDelta": { threadId: string; turnId: string; itemId: string; delta: string };
    "thread/tokenUsage/updated": { threadId: string; turnId: string; tokenUsage: { last: TokenUsageBreakdown } };
    "mcpServer/startupStatus/updated": CodexMcpStartupStatus;
    "skills/changed": Record<string, never>;
    error: { threadId: string; turnId: string; error: CodexTurnError; willRetry: boolean };
};

export type CodexNotificationMethod = keyof CodexNotificationSpec;
export type CodexNotificationParams<Method extends CodexNotificationMethod> = CodexNotificationSpec[Method];
