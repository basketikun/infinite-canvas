import { create } from "zustand";
import i18n from "@/i18n";

import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

export type AgentChatRole = "user" | "assistant" | "system" | "tool" | "error";
export type AgentAttachment = { id: string; name: string; type: string; size: number; width: number; height: number; url: string; dataUrl: string };
export type AgentMessageAttachment = Pick<AgentAttachment, "id" | "name" | "url"> & Partial<Pick<AgentAttachment, "type" | "size" | "width" | "height" | "dataUrl">>;
export type AgentCanvasReference = Pick<CanvasResourceReference, "nodeId" | "label" | "title" | "kind" | "previewUrl" | "text">;
export type AgentSkillReference = { name: string; path: string; displayName?: string };
export type AgentChatItem = { id: string; itemId?: string; clientMessageId?: string; threadId?: string; turnId?: string; role: AgentChatRole; title?: string; text: string; meta?: string; detail?: unknown; attachments?: AgentMessageAttachment[]; canvasReferences?: AgentCanvasReference[]; skill?: AgentSkillReference; streamId?: string; activityItems?: Record<string, string> };
export type AgentEventLog = { id: string; time: string; title: string; text: string; raw?: unknown };
export type AgentPendingToolCall = { requestId: string; name: string; input?: { ops?: CanvasAgentOp[]; path?: string } & Record<string, unknown> };
export type AgentPermissionMode = "request" | "automatic" | "full";
export type AgentReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type AgentModel = {
    id: string;
    model: string;
    displayName: string;
    defaultReasoningEffort: AgentReasoningEffort;
    supportedReasoningEfforts: Array<{ reasoningEffort: AgentReasoningEffort; description?: string }>;
    isDefault?: boolean;
};
export type AgentApprovalDecision = "accept" | "acceptForSession" | "decline";
export type AgentPendingApproval = { requestId: string; method: string; threadId?: string; turnId?: string; itemId?: string; reason?: string; command?: unknown; cwd?: string; grantRoot?: string; networkApprovalContext?: unknown; permissions?: unknown; deciding?: AgentApprovalDecision };
export type AgentCanvasContext = { snapshot: CanvasAgentSnapshot; applyOps: (ops?: CanvasAgentOp[]) => CanvasAgentSnapshot; undoOps: () => CanvasAgentSnapshot | null; canUndo: boolean };
export type AgentThreadSummary = { id: string; preview: string; name?: string | null; cwd?: string; status?: string; source?: unknown; createdAt?: number; updatedAt?: number };
export type AgentTokenUsage = { input: number; cached: number; output: number };
export type AgentBootstrapStatus = { key: string; text: string; detail: string; status: "running" | "ready" | "error" };
export type AgentConversationState = {
    revision: number;
    conversationId: string;
    threadId: string;
    status: "idle" | "preparing" | "ready" | "warning" | "running" | "failed";
    mcpStatuses: Record<string, { status: "starting" | "ready" | "failed" | "cancelled"; error?: string | null; failureReason?: string | null }>;
    sourceClientId?: string;
    error?: string;
};
export type AgentPanelTab = "chat" | "setup" | "history" | "skills" | "log";
export type CanvasAgentProvider = "openai-compatible" | "chatgpt-plan";
export type CanvasAgentDefaults = { provider: CanvasAgentProvider; models: Record<CanvasAgentProvider, string> };

const CANVAS_AGENT_DEFAULTS_KEY = "canvas-agent-canvas-defaults";
const EMPTY_CANVAS_AGENT_DEFAULTS: CanvasAgentDefaults = { provider: "openai-compatible", models: { "openai-compatible": "", "chatgpt-plan": "" } };

function readCanvasAgentDefaults(): CanvasAgentDefaults {
    if (typeof window === "undefined") return EMPTY_CANVAS_AGENT_DEFAULTS;
    try {
        const saved = JSON.parse(localStorage.getItem(CANVAS_AGENT_DEFAULTS_KEY) || "null") as Partial<CanvasAgentDefaults> | null;
        return {
            provider: saved?.provider === "chatgpt-plan" ? "chatgpt-plan" : "openai-compatible",
            models: {
                "openai-compatible": typeof saved?.models?.["openai-compatible"] === "string" ? saved.models["openai-compatible"] : "",
                "chatgpt-plan": typeof saved?.models?.["chatgpt-plan"] === "string" ? saved.models["chatgpt-plan"] : "",
            },
        };
    } catch {
        return EMPTY_CANVAS_AGENT_DEFAULTS;
    }
}

const CONNECT_TIMEOUT_MS = 6000;
let agentSource: EventSource | null = null;
let connectTimer: ReturnType<typeof setTimeout> | null = null;

type AgentStore = {
    width: number;
    panelOpen: boolean;
    panelMounted: boolean;
    panelClosing: boolean;
    canvasContext: AgentCanvasContext | null;
    url: string;
    token: string;
    connected: boolean;
    enabled: boolean;
    silentConnect: boolean;
    fragmentBootstrap: boolean;
    prompt: string;
    attachments: AgentAttachment[];
    canvasReferences: CanvasResourceReference[];
    sending: boolean;
    waiting: boolean;
    messages: AgentChatItem[];
    tokenUsage: AgentTokenUsage | null;
    eventLogs: AgentEventLog[];
    threads: AgentThreadSummary[];
    activeThreadId: string;
    activeTurnId: string;
    workspacePath: string;
    loadingThreads: boolean;
    activeTab: AgentPanelTab;
    confirmTools: boolean;
    permissionMode: AgentPermissionMode;
    models: AgentModel[];
    model: string;
    canvasAgentDefaults: CanvasAgentDefaults;
    reasoningEffort: AgentReasoningEffort | "";
    activity: string;
    conversation: AgentConversationState;
    bootstrapStatus: AgentBootstrapStatus | null;
    mcpStartupStatuses: Record<string, AgentBootstrapStatus>;
    connectError: string;
    pendingTool: AgentPendingToolCall | null;
    pendingApprovals: AgentPendingApproval[];
    setAgentState: (patch: Partial<Omit<AgentStore, "setAgentState" | "setCanvasAgentDefaultProvider" | "setCanvasAgentDefaultModel" | "connectAgent" | "disconnectAgent" | "addMessage" | "addEventLog" | "clearEventLogs" | "openPanel" | "closePanel" | "togglePanel" | "setCanvasContext">>) => void;
    setCanvasAgentDefaultProvider: (provider: CanvasAgentProvider) => void;
    setCanvasAgentDefaultModel: (provider: CanvasAgentProvider, model: string) => void;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
    setCanvasContext: (context: AgentCanvasContext | null) => void;
    connectAgent: (options?: { silent?: boolean }) => void;
    disconnectAgent: (patch?: Partial<Omit<AgentStore, "setAgentState" | "setCanvasAgentDefaultProvider" | "setCanvasAgentDefaultModel" | "connectAgent" | "disconnectAgent" | "addMessage" | "addEventLog" | "clearEventLogs" | "openPanel" | "closePanel" | "togglePanel" | "setCanvasContext">>) => void;
    addMessage: (item: AgentChatItem) => void;
    addEventLog: (item: AgentEventLog) => void;
    clearEventLogs: () => void;
};

export const CANVAS_AGENT_PANEL_MOTION_MS = 500;

export const useAgentStore = create<AgentStore>((set, get) => ({
    width: typeof window === "undefined" ? 440 : Number(localStorage.getItem("canvas-agent-panel-width")) || 440,
    panelOpen: false,
    panelMounted: true,
    panelClosing: false,
    canvasContext: null,
    url: typeof window === "undefined" ? "http://127.0.0.1:17371" : localStorage.getItem("canvas-agent-url") || "http://127.0.0.1:17371",
    token: typeof window === "undefined" ? "" : localStorage.getItem("canvas-agent-token") || "",
    connected: false,
    enabled: false,
    silentConnect: false,
    fragmentBootstrap: false,
    prompt: "",
    attachments: [],
    canvasReferences: [],
    sending: false,
    waiting: false,
    messages: [],
    tokenUsage: null,
    eventLogs: [],
    threads: [],
    activeThreadId: "",
    activeTurnId: "",
    workspacePath: "",
    loadingThreads: false,
    activeTab: "setup",
    confirmTools: false,
    permissionMode: typeof window === "undefined" ? "request" : (localStorage.getItem("canvas-agent-permission-mode") as AgentPermissionMode) || "request",
    models: [],
    model: typeof window === "undefined" ? "" : localStorage.getItem("canvas-agent-model") || "",
    canvasAgentDefaults: readCanvasAgentDefaults(),
    reasoningEffort: typeof window === "undefined" ? "" : (localStorage.getItem("canvas-agent-reasoning-effort") as AgentReasoningEffort) || "",
    activity: i18n.t("agent.state.ready"),
    conversation: { revision: 0, conversationId: "", threadId: "", status: "idle", mcpStatuses: {} },
    bootstrapStatus: null,
    mcpStartupStatuses: {},
    connectError: "",
    pendingTool: null,
    pendingApprovals: [],
    setAgentState: (patch) => set(patch),
    setCanvasAgentDefaultProvider: (provider) => set((state) => {
        const canvasAgentDefaults = { ...state.canvasAgentDefaults, provider };
        if (typeof window !== "undefined") localStorage.setItem(CANVAS_AGENT_DEFAULTS_KEY, JSON.stringify(canvasAgentDefaults));
        return { canvasAgentDefaults };
    }),
    setCanvasAgentDefaultModel: (provider, model) => set((state) => {
        const canvasAgentDefaults = { ...state.canvasAgentDefaults, models: { ...state.canvasAgentDefaults.models, [provider]: model } };
        if (typeof window !== "undefined") localStorage.setItem(CANVAS_AGENT_DEFAULTS_KEY, JSON.stringify(canvasAgentDefaults));
        return { canvasAgentDefaults };
    }),
    openPanel: () => set({ panelOpen: true, panelMounted: true, panelClosing: false }),
    closePanel: () => {
        if (!get().panelMounted || get().panelClosing) return;
        set({ panelOpen: false, panelClosing: true });
        setTimeout(() => {
            if (get().panelClosing) set({ panelClosing: false });
        }, CANVAS_AGENT_PANEL_MOTION_MS);
    },
    togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),
    setCanvasContext: (canvasContext) => set((state) => state.canvasContext === canvasContext ? state : { canvasContext }),
    connectAgent: (options) => {
        const silent = options?.silent ?? false;
        const endpoint = get().url.trim().replace(/\/$/, "");
        const token = get().token.trim();
        if (!endpoint || !token) return set({ connectError: silent ? "" : i18n.t("agent.state.connectionRequired") });
        try {
            const parsed = new URL(endpoint);
            if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
        } catch {
            return set({ connectError: silent ? "" : i18n.t("agent.state.invalidUrl") });
        }
        localStorage.setItem("canvas-agent-url", endpoint);
        localStorage.setItem("canvas-agent-token", token);
        // Only set enabled here; LocalAgentPanel's effect owns SSE initialization.
        set({ url: endpoint, token, enabled: true, silentConnect: silent, fragmentBootstrap: false, activity: i18n.t("agent.status.connecting"), connectError: "" });
    },
    disconnectAgent: (patch = {}) => {
        agentSource?.close();
        agentSource = null;
        if (connectTimer) clearTimeout(connectTimer);
        connectTimer = null;
        set({ enabled: false, connected: false, silentConnect: false, fragmentBootstrap: false, activity: i18n.t("agent.state.offline"), conversation: { revision: 0, conversationId: "", threadId: "", status: "idle", mcpStatuses: {} }, bootstrapStatus: null, mcpStartupStatuses: {}, ...patch });
    },
    addMessage: (item) => set((state) => ({ messages: [...state.messages, item] })),
    addEventLog: (item) => set((state) => ({ eventLogs: [...state.eventLogs.slice(-160), item] })),
    clearEventLogs: () => set({ eventLogs: [] }),
}));
