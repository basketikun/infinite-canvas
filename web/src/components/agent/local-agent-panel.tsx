import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { App, Button, Tooltip } from "antd";
import dayjs from "dayjs";
import { Bot, FolderOpen, History, MessageSquare, PanelRightClose, PlugZap, Plus, Sparkles, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { readAgentUrlBootstrap } from "@/lib/agent/agent-url-bootstrap";
import { canvasThemes } from "@/lib/canvas-theme";
import { imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { resolveCanvasReferenceImages, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { readImageMeta } from "@/lib/image-utils";
import { randomId } from "@/lib/utils";
import { uploadImage } from "@/services/image-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { useShallow } from "zustand/react/shallow";
import {
    useAgentStore,
    type AgentAttachment,
    type AgentBootstrapStatus,
    type AgentCanvasContext,
    type AgentCanvasReference,
    type AgentChatItem,
    type AgentClarificationAnswers,
    type AgentConversationState,
    type AgentMessageAttachment,
    type AgentModel,
    type AgentPendingApproval,
    type AgentPendingClarification,
    type AgentPendingToolCall,
    type AgentPermissionMode,
    type AgentReasoningEffort,
    type AgentThreadSummary,
} from "@/stores/use-agent-store";
import { type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { isSiteTool, runSiteTool } from "@/lib/agent/agent-site-tools";
import { acknowledgeCodexHistory, activateAgentClient, activateCodexProject, AgentApiError, createCodexProject, deleteCodexProject, discoverAgentConfig, fetchAgentJson, fetchCodexProjects, interruptCodexTurn, postCodexApproval, postCodexClarification, postCodexTurn, postState, postToolResult, resolveAgentMessageAssetUrl, selectAgentLocalDirectory, type AgentProject, type AgentProjectsResponse, type AgentSkillSummary } from "@/services/api/canvas-agent";
import { AgentChatTimeline, AgentTaskProgress, AgentUsageBar } from "./agent-chat";
import { AgentChatComposer } from "./agent-chat-composer";
import { AgentConnectView } from "./agent-connect-view";
import {
    activityDeltaFallback,
    activityDetail,
    activityKind,
    activityPlaceholder,
    agentAttachmentToChatAttachment,
    agentErrorView,
    attachmentPayloadBytes,
    compactText,
    eventUsage,
    formatAgentActivity,
    formatAgentEvent,
    formatAgentEventLog,
    formatAgentPlan,
    formatBytes,
    bindPendingTurnMessages,
    isCanvasWriteTool,
    isConnectionErrorMessage,
    isCurrentThreadEvent,
    isReasoningSummary,
    mergeAgentMessages,
    mergeStreamText,
    normalizeHistoryMessages,
    normalizeText,
    parseEventData,
    promptWithAttachments,
    promptWithCanvasReferences,
    reasoningActivityText,
    registerLiveAgentTurn,
    scopeChatItem,
    stringText,
    toolName,
    turnPlanStatus,
    upsertAgentMessage,
    type AgentEventItem,
    type AgentEventPayload,
} from "./agent-event-formatters";
import { AgentHistoryView } from "./agent-history-view";
import { AgentLogView } from "./agent-log-view";
import { AgentPanelTabs } from "./agent-panel-tabs";
import { AgentProjectModal } from "./agent-project-modal";
import { AgentSkillsView } from "./agent-skills-view";

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_PAYLOAD_BYTES = 28 * 1024 * 1024;
const DEFAULT_AGENT_URL = "http://127.0.0.1:17371";
const AGENT_PROTOCOL_VERSION = 10;
const HISTORY_RETRY_DELAYS_MS = [0, 150, 350, 700, 1200];
const AGENT_REASONING_EFFORTS = new Set<AgentReasoningEffort>(["minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
const rt = (key: string, options?: Record<string, unknown>) => i18n.t(`agent.runtime.${key}`, options);

type AgentWorkspace = { workspacePath: string; activeThreadId?: string; id?: string; name?: string };
type AgentThreadsResponse = { ok?: boolean; workspace?: AgentWorkspace; conversation?: AgentConversationState; data?: AgentThreadSummary[] };
type AgentThreadResponse = { ok?: boolean; workspace?: AgentWorkspace; conversation?: AgentConversationState; thread?: AgentThreadSummary; messages?: AgentChatItem[]; settledTurnIds?: string[]; historyReady?: boolean };
type AgentWorkspaceResponse = { ok?: boolean; workspace?: AgentWorkspace; conversation?: AgentConversationState };
type AgentModelsResponse = { ok?: boolean; data?: AgentModel[] };
type AgentCodexState = { busy?: boolean; threadId?: string; turnId?: string; projectId?: string };
type AgentHelloEvent = {
    ok?: boolean;
    protocolVersion?: number;
    clientId?: string;
    project?: { id?: string; active?: boolean };
    workspace?: { activeThreadId?: string };
    conversation?: AgentConversationState;
    codex?: AgentCodexState;
    globalCodexBusy?: boolean;
    pendingApprovals?: AgentPendingApproval[];
    pendingClarifications?: AgentPendingClarification[];
};
type AgentWorkspaceEvent = { projectId?: string; activeThreadId?: string; threadId?: string; sourceClientId?: string; emptyThread?: boolean; draftThread?: boolean; conversation?: AgentConversationState };
type AgentChatEvent = { projectId?: string; threadId?: string; turnId?: string; sourceClientId?: string; replayed?: boolean; message?: AgentChatItem };
type AgentBootstrapEvent = {
    type?: "codex.preparing" | "codex.prepare_failed" | "mcp.startup" | "mcp.complete";
    phase?: "preheat" | "runtime";
    threadId?: string;
    name?: string;
    status?: "starting" | "ready" | "failed" | "cancelled";
    error?: string | null;
    projectId?: string;
    failureReason?: string | null;
};
type AgentClientGlobal = typeof globalThis & { __infiniteCanvasAgentClientIdPromise?: Promise<string> };
type AgentEditDraft = {
    threadId: string;
    turnId: string;
    referenceImages: AgentAttachment[];
    previous: { prompt: string; attachments: AgentAttachment[]; canvasReferences: CanvasResourceReference[]; selectedSkill: AgentSkillSummary | null };
};

function authoritativeHistoryTurnKeys(threadId: string, settledTurnIds: string[]) {
    return new Set(settledTurnIds.map((turnId) => `${threadId}\0${turnId}`));
}

function agentErrorState(error: unknown) {
    return error instanceof AgentApiError ? (error.response as { state?: AgentConversationState }).state : undefined;
}

function conversationBootstrapView(conversation: AgentConversationState) {
    const mcpStartupStatuses: Record<string, AgentBootstrapStatus> = Object.fromEntries(
        Object.entries(conversation.mcpStatuses).map(([name, item]) => {
            const view: AgentBootstrapStatus =
                item.status === "starting"
                    ? { key: `mcp:${name}:starting`, text: rt("mcpStarting", { name }), detail: rt("mcpConnecting"), status: "running" }
                    : item.status === "ready"
                      ? { key: `mcp:${name}:ready`, text: rt("mcpReadyNamed", { name }), detail: rt("toolsReady"), status: "ready" }
                      : { key: `mcp:${name}:${item.status}`, text: rt(item.status === "failed" ? "mcpFailedNamed" : "mcpCanceledNamed", { name }), detail: item.error || rt("toolInitFailed"), status: "error" };
            return [name, view];
        }),
    );
    const services = Object.values(mcpStartupStatuses);
    const pending = services.filter((item) => item.status === "running").length;
    const bootstrapStatus: AgentBootstrapStatus | null =
        conversation.status === "idle" || conversation.status === "preparing"
            ? services.length
                ? { key: "mcp:starting", text: rt("mcpServicesStarting"), detail: pending ? rt("toolServicesPending", { count: pending }) : rt("checkingToolServices"), status: "running" }
                : { key: "codex:preparing", text: rt("conversationInitializing"), detail: rt("conversationCreating"), status: "running" }
            : conversation.status === "warning"
              ? { key: "mcp:warning", text: rt("someMcpFailed"), detail: rt("remainingToolsReady"), status: "error" }
              : conversation.status === "failed"
                ? { key: "codex:prepare_failed", text: rt("conversationInitFailed"), detail: conversation.error || rt("conversationCreateFailed"), status: "error" }
                : conversation.status === "ready"
                  ? { key: "mcp:ready", text: rt("mcpServicesReady", { count: services.length }), detail: rt("toolsReady"), status: "ready" }
                  : null;
    return { bootstrapStatus, mcpStartupStatuses };
}

export function LocalAgentPanel({ embedded, headless, autoConnect }: { embedded?: boolean; headless?: boolean; autoConnect?: boolean }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { message, modal } = App.useApp();
    const { hash } = useLocation();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    // Field-level selectors with useShallow rerender only when these fields change.
    // canvasContext is intentionally excluded because project updates it every frame during dragging and resizing.
    // The panel uses it only for ref synchronization and debounced postState calls, never during rendering.
    // Subscribing here would rerender the panel every frame and amplify the #185 crash, so it is observed imperatively below.
    const {
        width,
        url,
        token,
        connected,
        enabled,
        prompt,
        attachments,
        sending,
        waiting,
        tokenUsage,
        eventLogs,
        threads,
        activeThreadId,
        workspacePath,
        loadingThreads,
        activeTab,
        confirmTools,
        permissionMode,
        models,
        model,
        reasoningEffort,
        activity,
        conversation,
        connectError,
        pendingTool,
        pendingApprovals,
        pendingClarifications,
    } = useAgentStore(
        useShallow((state) => ({
            width: state.width,
            url: state.url,
            token: state.token,
            connected: state.connected,
            enabled: state.enabled,
            prompt: state.prompt,
            attachments: state.attachments,
            sending: state.sending,
            waiting: state.waiting,
            tokenUsage: state.tokenUsage,
            eventLogs: state.eventLogs,
            threads: state.threads,
            activeThreadId: state.activeThreadId,
            workspacePath: state.workspacePath,
            loadingThreads: state.loadingThreads,
            activeTab: state.activeTab,
            confirmTools: state.confirmTools,
            permissionMode: state.permissionMode,
            models: state.models,
            model: state.model,
            reasoningEffort: state.reasoningEffort,
            activity: state.activity,
            conversation: state.conversation,
            connectError: state.connectError,
            pendingTool: state.pendingTool,
            pendingApprovals: state.pendingApprovals,
            pendingClarifications: state.pendingClarifications,
        })),
    );
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const conversationReady = conversation.status === "ready" || conversation.status === "warning";
    const conversationBusy = conversation.status === "preparing" || conversation.status === "running";
    const closePanel = useAgentStore((state) => state.closePanel);
    const pushMessage = useAgentStore((state) => state.addMessage);
    const pushEventLog = useAgentStore((state) => state.addEventLog);
    const clearEventLogs = useAgentStore((state) => state.clearEventLogs);
    const loadSkills = useAgentSkillStore((state) => state.loadSkills);
    const clearSkillSelection = useAgentSkillStore((state) => state.clearSelection);
    const skillCount = useAgentSkillStore((state) => state.skills.length);
    const messageCount = useAgentStore((state) => state.messages.length);
    const canvasContextRef = useRef<AgentCanvasContext | null>(useAgentStore.getState().canvasContext);
    const confirmToolsRef = useRef(confirmTools);
    const pendingToolRef = useRef<AgentPendingToolCall | null>(null);
    const autoConnectRef = useRef(false);
    const connectedRef = useRef(false);
    const errorLoggedRef = useRef(false);
    const attachmentUrlsRef = useRef(new Set<string>());
    const editDraftRef = useRef<AgentEditDraft | null>(null);
    const clientIdRef = useRef("");
    const [clientReady, setClientReady] = useState(false);
    const [projects, setProjects] = useState<AgentProject[]>([]);
    const [activeProjectId, setActiveProjectId] = useState(readAgentProjectId);
    const activeProjectIdRef = useRef(activeProjectId);
    const [projectModalOpen, setProjectModalOpen] = useState(false);
    const [projectChanging, setProjectChanging] = useState(false);
    const [globalCodexBusy, setGlobalCodexBusy] = useState(false);
    const [editing, setEditing] = useState(false);
    const loadThreadsSequenceRef = useRef(0);
    const threadMessagesRef = useRef(new Map<string, AgentChatItem[]>());
    const authoritativeHistoryTurnsRef = useRef(new Set<string>());
    const liveTurnKeysRef = useRef(new Set<string>());
    const threadOperationRef = useRef(0);
    const threadOperationSequenceRef = useRef(0);
    const endpoint = useMemo(() => url.trim().replace(/\/$/, ""), [url]);
    const urlAgentAutoConnect = searchParams.has("agentUrl") && searchParams.has("agentToken");
    useEffect(() => {
        activeProjectIdRef.current = activeProjectId;
    }, [activeProjectId]);
    useEffect(() => {
        let disposed = false;
        void acquireAgentClientId().then((clientId) => {
            if (!disposed) {
                clientIdRef.current = clientId;
                setClientReady(true);
            }
        });
        return () => {
            disposed = true;
        };
    }, []);
    const loadThreadSnapshot = useCallback(
        async (threadId: string, sequence: number, response?: AgentThreadResponse, expectedTurnId = "") => {
            let thread = response;
            let lastError: unknown;
            for (const delayMs of HISTORY_RETRY_DELAYS_MS) {
                if (delayMs) await delay(delayMs);
                if (sequence !== loadThreadsSequenceRef.current || useAgentStore.getState().activeThreadId !== threadId) return false;
                try {
                    thread ||= await fetchAgentJson<AgentThreadResponse>(endpoint, token, `/agent/codex/threads/${encodeURIComponent(threadId)}?clientId=${encodeURIComponent(clientIdRef.current)}`);
                    lastError = undefined;
                } catch (error) {
                    lastError = error;
                    thread = undefined;
                    continue;
                }
                const history = normalizeHistoryMessages(thread.messages || []);
                const latest = useAgentStore.getState();
                if (sequence !== loadThreadsSequenceRef.current || latest.activeThreadId !== threadId) return false;
                const historyTurns = authoritativeHistoryTurnKeys(threadId, thread.settledTurnIds || []);
                const hasExpectedTurn = !expectedTurnId || historyTurns.has(`${threadId}\0${expectedTurnId}`);
                historyTurns.forEach((key) => liveTurnKeysRef.current.delete(key));
                if (latest.activeTurnId) liveTurnKeysRef.current.add(`${threadId}\0${latest.activeTurnId}`);
                authoritativeHistoryTurnsRef.current = historyTurns;
                const messages = mergeAgentMessages(history, latest.messages, threadId, liveTurnKeysRef.current);
                threadMessagesRef.current.set(threadId, messages);
                setAgentState({ messages, connectError: "" });
                const coveredTurnIds = [...historyTurns].map((key) => key.slice(threadId.length + 1));
                if (coveredTurnIds.length) void acknowledgeCodexHistory(endpoint, token, clientIdRef.current, threadId, coveredTurnIds).catch(() => undefined);
                if (hasExpectedTurn && (thread.historyReady !== false || Boolean(expectedTurnId))) return true;
                thread = undefined;
            }
            if (lastError) throw lastError;
            return false;
        },
        [endpoint, setAgentState, token],
    );
    const applyWorkspaceChange = useCallback(
        (data: AgentWorkspaceEvent) => {
            const nextThreadId = data.activeThreadId ?? data.threadId ?? "";
            const current = useAgentStore.getState();
            const threadChanged = current.activeThreadId !== nextThreadId;
            const emptyThread = Boolean(data.emptyThread || data.draftThread);
            const pendingMessage = [...current.messages].reverse().find((item) => item.role === "user" && !item.turnId);
            const keepPendingMessage = Boolean(data.emptyThread && pendingMessage && (current.sending || current.waiting) && (!data.sourceClientId || data.sourceClientId === clientIdRef.current));
            if (threadChanged && current.activeThreadId) {
                const messages = keepPendingMessage ? current.messages.filter((item) => item.id !== pendingMessage!.id) : current.messages;
                threadMessagesRef.current.set(current.activeThreadId, messages);
            }
            if (emptyThread && nextThreadId) threadMessagesRef.current.delete(nextThreadId);
            if (threadChanged || emptyThread) {
                loadThreadsSequenceRef.current += 1;
                authoritativeHistoryTurnsRef.current.clear();
                liveTurnKeysRef.current.clear();
            }
            const messages = keepPendingMessage ? [scopeChatItem(pendingMessage!, nextThreadId, "")] : emptyThread ? [] : threadChanged ? threadMessagesRef.current.get(nextThreadId) || [] : current.messages;
            pendingToolRef.current = null;
            setAgentState({
                activeThreadId: nextThreadId,
                activeTurnId: threadChanged || emptyThread ? "" : current.activeTurnId,
                messages,
                tokenUsage: threadChanged || emptyThread ? null : current.tokenUsage,
                pendingTool: null,
                pendingApprovals: threadChanged || emptyThread ? [] : current.pendingApprovals,
                pendingClarifications: threadChanged || emptyThread ? [] : current.pendingClarifications,
            });
            return loadThreadsSequenceRef.current;
        },
        [setAgentState],
    );
    const applyConversationState = useCallback(
        (next: AgentConversationState, force = false) => {
            const current = useAgentStore.getState();
            if (!next?.revision || (!force && next.revision <= current.conversation.revision)) return false;
            const conversationChanged = next.conversationId !== current.conversation.conversationId;
            if (conversationChanged || next.threadId !== current.activeThreadId) {
                applyWorkspaceChange({
                    activeThreadId: next.threadId,
                    emptyThread: conversationChanged || !current.activeThreadId,
                    draftThread: next.status === "preparing",
                    sourceClientId: next.sourceClientId,
                });
            }
            setAgentState({ conversation: next, ...conversationBootstrapView(next) });
            return true;
        },
        [applyWorkspaceChange, setAgentState],
    );
    const loadThreads = useCallback(
        async (skipHistory = false, expectedTurnId = "") => {
            if (!connectedRef.current && !useAgentStore.getState().connected) return;
            let sequence = ++loadThreadsSequenceRef.current;
            setAgentState({ loadingThreads: true });
            try {
                const data = await fetchAgentJson<AgentThreadsResponse>(endpoint, token, `/agent/codex/threads?clientId=${encodeURIComponent(clientIdRef.current)}`);
                if (sequence !== loadThreadsSequenceRef.current) return;
                if (data.conversation) {
                    applyConversationState(data.conversation);
                    sequence = loadThreadsSequenceRef.current;
                }
                const current = useAgentStore.getState();
                const currentThreadId = current.activeThreadId || data.workspace?.activeThreadId || "";
                if (!data.conversation && currentThreadId !== current.activeThreadId) sequence = applyWorkspaceChange({ activeThreadId: currentThreadId });
                if (sequence !== loadThreadsSequenceRef.current || useAgentStore.getState().activeThreadId !== currentThreadId) return;
                setAgentState({ threads: data.data || [], workspacePath: data.workspace?.workspacePath || "" });
                if (currentThreadId && !skipHistory) {
                    await loadThreadSnapshot(currentThreadId, sequence, undefined, expectedTurnId);
                } else {
                    authoritativeHistoryTurnsRef.current.clear();
                    liveTurnKeysRef.current.clear();
                }
            } catch (error) {
                addEventLog(rt("historyReadFailed"), error);
            } finally {
                if (sequence === loadThreadsSequenceRef.current && !threadOperationRef.current) setAgentState({ loadingThreads: false });
            }
        },
        [applyConversationState, applyWorkspaceChange, endpoint, loadThreadSnapshot, setAgentState, token],
    );
    const applyProjectResponse = useCallback(
        (data: AgentProjectsResponse & { conversation?: AgentConversationState }) => {
            const project = data.project || data.workspace;
            if (data.projects) setProjects(data.projects);
            if (!project) return;
            activeProjectIdRef.current = project.id;
            setActiveProjectId(project.id);
            saveAgentProjectId(project.id);
            loadThreadsSequenceRef.current += 1;
            threadMessagesRef.current.clear();
            authoritativeHistoryTurnsRef.current.clear();
            liveTurnKeysRef.current.clear();
            pendingToolRef.current = null;
            useAgentSkillStore.getState().reset();
            setAgentState({ threads: [], messages: [], activeThreadId: project.activeThreadId || "", activeTurnId: "", workspacePath: project.workspacePath, pendingTool: null, pendingApprovals: [], pendingClarifications: [] });
            if (data.conversation) applyConversationState(data.conversation, true);
        },
        [applyConversationState, setAgentState],
    );
    const changeProject = useCallback(
        async (projectId: string) => {
            if (!clientIdRef.current || projectChanging) return;
            setProjectChanging(true);
            try {
                const result = await activateCodexProject(endpoint, token, clientIdRef.current, projectId, useAgentStore.getState().permissionMode) as AgentProjectsResponse & { conversation?: AgentConversationState };
                applyProjectResponse(result);
                await loadThreads();
                await loadSkills(endpoint, token, clientIdRef.current, true);
            } finally {
                setProjectChanging(false);
            }
        },
        [applyProjectResponse, endpoint, loadSkills, loadThreads, projectChanging, token],
    );
    const createProject = useCallback(
        async (input: { name: string; workspacePath: string }) => {
            if (!clientIdRef.current || projectChanging) return;
            setProjectChanging(true);
            try {
                const result = await createCodexProject(endpoint, token, clientIdRef.current, { ...input, permissionMode: useAgentStore.getState().permissionMode }) as AgentProjectsResponse & { conversation?: AgentConversationState };
                applyProjectResponse(result);
                await loadThreads();
                await loadSkills(endpoint, token, clientIdRef.current, true);
            } finally {
                setProjectChanging(false);
            }
        },
        [applyProjectResponse, endpoint, loadSkills, loadThreads, projectChanging, token],
    );
    const removeProject = useCallback(
        async (projectId: string) => {
            if (!clientIdRef.current || projectChanging) return;
            setProjectChanging(true);
            try {
                const result = await deleteCodexProject(endpoint, token, clientIdRef.current, projectId, useAgentStore.getState().permissionMode) as AgentProjectsResponse & { conversation?: AgentConversationState };
                applyProjectResponse(result);
                await loadThreads();
                await loadSkills(endpoint, token, clientIdRef.current, true);
            } finally {
                setProjectChanging(false);
            }
        },
        [applyProjectResponse, endpoint, loadSkills, loadThreads, projectChanging, token],
    );
    // Imperatively subscribe to canvasContext to keep the ref current and debounce snapshot reports without rerendering the panel.
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const unsubscribe = useAgentStore.subscribe((state) => {
            if (state.canvasContext === canvasContextRef.current) return;
            canvasContextRef.current = state.canvasContext;
            if (!useAgentStore.getState().connected) return;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => void postState(endpoint, token, clientIdRef.current, canvasContextRef.current?.snapshot || null), 300);
        });
        return () => {
            unsubscribe();
            if (timer) clearTimeout(timer);
        };
    }, [endpoint, token]);
    useEffect(() => {
        confirmToolsRef.current = confirmTools;
    }, [confirmTools]);
    useEffect(() => {
        pendingToolRef.current = pendingTool;
    }, [pendingTool]);
    useEffect(() => () => attachmentUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)), []);

    useEffect(() => {
        if (!clientReady || !enabled || !token.trim()) return;
        localStorage.setItem("canvas-agent-url", endpoint);
        localStorage.setItem("canvas-agent-token", token);
        const clientId = clientIdRef.current;
        let disposed = false;
        let protocolRejected = false;
        let eventQueue = Promise.resolve();
        const isCurrentConnection = () => !disposed && clientIdRef.current === clientId;
        const enqueueEvent = (task: () => void | Promise<void>) => {
            eventQueue = eventQueue
                .then(async () => {
                    if (isCurrentConnection()) await task();
                })
                .catch((error) => {
                    if (isCurrentConnection()) addEventLog(rt("conversationSyncFailed"), error);
                });
        };
        const source = new EventSource(`${endpoint}/events?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}&projectId=${encodeURIComponent(activeProjectIdRef.current)}`);
        source.addEventListener("hello", (event) => {
            if (!isCurrentConnection()) return;
            const hello = parseEventData<AgentHelloEvent>(event);
            if (hello?.protocolVersion !== AGENT_PROTOCOL_VERSION) {
                const text = rt("agentOutdated");
                protocolRejected = true;
                source.close();
                connectedRef.current = false;
                setAgentState({ enabled: false, connected: false, waiting: false, sending: false, activity: rt("restartRequired"), connectError: text, silentConnect: false, pendingTool: null, pendingApprovals: [], pendingClarifications: [] });
                useAgentSkillStore.getState().reset();
                addEventLog(rt("versionMismatch"), text, hello);
                if (!headless) message.error(text);
                return;
            }
            const codex = hello?.codex;
            setGlobalCodexBusy(Boolean(hello?.globalCodexBusy));
            const helloProjectId = hello?.project?.id || activeProjectIdRef.current;
            if (helloProjectId) {
                activeProjectIdRef.current = helloProjectId;
                setActiveProjectId(helloProjectId);
                saveAgentProjectId(helloProjectId);
            }
            const busy = Boolean(codex?.busy);
            const nextThreadId = hello?.conversation?.threadId ?? hello?.workspace?.activeThreadId ?? useAgentStore.getState().activeThreadId;
            if (hello?.conversation) applyConversationState(hello.conversation, true);
            else applyWorkspaceChange({ activeThreadId: nextThreadId });
            const current = useAgentStore.getState();
            const nextTurnId = codex?.threadId === nextThreadId ? (codex.turnId ?? "") : "";
            if (nextTurnId) liveTurnKeysRef.current.add(`${nextThreadId}\0${nextTurnId}`);
            const activeTurnId = busy ? nextTurnId : "";
            const pendingApprovals = busy ? (hello?.pendingApprovals || []).filter((item) => !item.threadId || item.threadId === nextThreadId) : [];
            const pendingClarifications = busy ? (hello?.pendingClarifications || []).filter((item) => !item.threadId || item.threadId === nextThreadId) : [];
            const messages = activeTurnId
                ? bindPendingTurnMessages(
                      current.messages.filter((item) => !isConnectionErrorMessage(item)),
                      nextThreadId,
                      activeTurnId,
                  )
                : current.messages.filter((item) => !isConnectionErrorMessage(item));
            errorLoggedRef.current = false;
            connectedRef.current = true;
            setAgentState({
                connected: true,
                activity: pendingApprovals.length ? rt("awaitingApproval") : pendingClarifications.length ? rt("awaitingClarification") : busy ? rt("codexRunning") : rt("connected"),
                waiting: busy,
                sending: false,
                connectError: "",
                silentConnect: false,
                fragmentBootstrap: false,
                activeThreadId: nextThreadId,
                activeTurnId,
                messages,
                pendingApprovals,
                pendingClarifications,
            });
            void postState(endpoint, token, clientId, canvasContextRef.current?.snapshot || null);
            if (document.visibilityState === "visible" && document.hasFocus()) void activateAgentClient(endpoint, token, clientId);
            void fetchCodexProjects(endpoint, token, clientId)
                .then((result) => {
                    if (result.projects) setProjects(result.projects);
                    const project = result.project || result.workspace;
                    if (!project) return;
                    activeProjectIdRef.current = project.id;
                    setActiveProjectId(project.id);
                    saveAgentProjectId(project.id);
                    if (hello?.project?.active) return;
                    setProjectChanging(true);
                    return activateCodexProject(endpoint, token, clientId, project.id, permissionMode)
                        .then((response) => {
                            if (!isCurrentConnection()) return;
                            applyProjectResponse(response as AgentProjectsResponse & { conversation?: AgentConversationState });
                            return loadThreads();
                        })
                        .then(() => isCurrentConnection() ? loadSkills(endpoint, token, clientId, true) : undefined)
                        .finally(() => {
                            if (isCurrentConnection()) setProjectChanging(false);
                        });
                })
                .catch((error) => isCurrentConnection() && addEventLog(rt("conversationSyncFailed"), error));
            if (!busy && !nextThreadId && (!hello?.conversation || hello.conversation.status === "idle")) {
                void fetchAgentJson<AgentWorkspaceResponse>(endpoint, token, "/agent/codex/threads/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, permissionMode }) })
                    .then((result) => result.conversation && applyConversationState(result.conversation))
                    .catch((error) => {
                        const state = agentErrorState(error);
                        if (state) applyConversationState(state);
                        addEventLog(rt("conversationInitFailed"), error);
                    });
            }
        });
        source.addEventListener("codex_state", (event) => {
            const data = parseEventData<AgentCodexState>(event);
            if (!data) return;
            enqueueEvent(async () => {
                setGlobalCodexBusy(Boolean(data.busy));
                if (data.projectId && data.projectId !== activeProjectIdRef.current) return;
                const busy = Boolean(data.busy);
                const current = useAgentStore.getState();
                const appliesToCurrentThread = !data.threadId || data.threadId === current.activeThreadId;
                if (!appliesToCurrentThread) return;
                const turnId = data.turnId || current.activeTurnId;
                if (turnId) liveTurnKeysRef.current.add(`${current.activeThreadId}\0${turnId}`);
                const activeTurnId = busy ? turnId : "";
                const messages = activeTurnId ? bindPendingTurnMessages(current.messages, current.activeThreadId, activeTurnId) : current.messages;
                setAgentState({
                    activity: busy ? rt("codexRunning") : current.activity === rt("processingFailed") ? rt("processingFailed") : rt("completed"),
                    waiting: busy,
                    sending: false,
                    activeTurnId,
                    messages,
                });
                if (!busy && current.waiting) void loadThreads(false, turnId);
            });
        });
        source.addEventListener("tool_call", (event) => {
            if (!isCurrentConnection()) return;
            const data = parseEventData<AgentPendingToolCall>(event);
            if (data) void handleToolCall(endpoint, token, data);
        });
        source.addEventListener("codex_approval", (event) => {
            if (!isCurrentConnection()) return;
            const data = parseEventData<AgentPendingApproval>(event);
            if (!data || !isCurrentThreadEvent(data)) return;
            setAgentState({ pendingApprovals: [...useAgentStore.getState().pendingApprovals.filter((item) => item.requestId !== data.requestId), data], activity: rt("awaitingApproval") });
            addEventLog(rt("awaitingApproval"), data.reason || data.method, data);
        });
        source.addEventListener("codex_approval_resolved", (event) => {
            if (!isCurrentConnection()) return;
            const data = parseEventData<{ requestId?: string; decision?: "accept" | "acceptForSession" | "decline" | "cancel" }>(event);
            if (!data?.requestId) return;
            const current = useAgentStore.getState();
            const approval = current.pendingApprovals.find((item) => item.requestId === data.requestId);
            const pendingApprovals = current.pendingApprovals.filter((item) => item.requestId !== data.requestId);
            setAgentState({ pendingApprovals, activity: approvalActivity(pendingApprovals, current.waiting, current.activity) });
            const decision = data.decision || approval?.deciding;
            if (approval && decision) addEventLog(rt(decision === "accept" || decision === "acceptForSession" ? "approvalGranted" : "approvalCanceled"), approval.reason || approval.method, approval);
        });
        source.addEventListener("agent_clarification", (event) => {
            if (!isCurrentConnection()) return;
            const data = parseEventData<AgentPendingClarification>(event);
            if (!data?.requestId || !data.questions?.length || !isCurrentThreadEvent(data)) return;
            const current = useAgentStore.getState();
            setAgentState({ pendingClarifications: [...current.pendingClarifications.filter((item) => item.requestId !== data.requestId), data], activity: rt("awaitingClarification") });
            addEventLog(rt("awaitingClarification"), data.message || data.questions[0].label, data);
        });
        source.addEventListener("agent_clarification_resolved", (event) => {
            if (!isCurrentConnection()) return;
            const data = parseEventData<{ requestId?: string }>(event);
            if (!data?.requestId) return;
            const current = useAgentStore.getState();
            const pendingClarifications = current.pendingClarifications.filter((item) => item.requestId !== data.requestId);
            setAgentState({ pendingClarifications, activity: clarificationActivity(pendingClarifications, current.pendingApprovals, current.waiting, current.activity) });
        });
        source.addEventListener("agent_event", (event) => {
            const data = parseEventData<AgentEventPayload>(event);
            if (data)
                enqueueEvent(() => {
                    if (data.projectId && data.projectId !== activeProjectIdRef.current) return;
                    if (!isCurrentThreadEvent(data)) return;
                    const shouldProcess = registerLiveAgentTurn(data, authoritativeHistoryTurnsRef.current, liveTurnKeysRef.current);
                    if (data.type !== "usage.updated" && !shouldProcess) return;
                    return handleAgentEvent(data);
                });
        });
        source.addEventListener("agent_bootstrap", (event) => {
            const data = parseEventData<AgentBootstrapEvent>(event);
            if (!data?.type || (data.projectId && data.projectId !== activeProjectIdRef.current)) return;
            if (data.type === "codex.preparing") {
                addEventLog(rt("conversationInitializing"), rt("conversationCreating"), data);
                return;
            }
            if (data.type === "codex.prepare_failed") {
                addEventLog(rt("conversationInitFailed"), data.error, data);
                return;
            }
            if (data.type === "mcp.complete") {
                addEventLog(rt("mcpStatusComplete"), rt("mcpListRead"), data);
                return;
            }
            if (!data.name || !data.status) return;
            const label = data.name;
            const status =
                data.status === "starting"
                    ? { text: rt("mcpStarting", { name: label }), detail: rt("mcpConnecting"), status: "running" as const }
                    : data.status === "ready"
                      ? { text: rt("mcpReadyNamed", { name: label }), detail: rt("toolsReady"), status: "ready" as const }
                      : data.status === "failed"
                        ? { text: rt("mcpFailedNamed", { name: label }), detail: data.error || rt("toolInitFailed"), status: "error" as const }
                        : { text: rt("mcpCanceledNamed", { name: label }), detail: rt("toolInitCanceled"), status: "error" as const };
            addEventLog(status.text, status.detail, data);
        });
        source.addEventListener("conversation_changed", (event) => {
            const data = parseEventData<AgentConversationState>(event);
            if (data)
                enqueueEvent(() => {
                    if (data.projectId && data.projectId !== activeProjectIdRef.current) return;
                    applyConversationState(data);
                });
        });
        source.addEventListener("workspace_changed", (event) => {
            const data = parseEventData<AgentWorkspaceEvent>(event);
            if (!data) return;
            enqueueEvent(() => {
                if (data.projectId && data.projectId !== activeProjectIdRef.current) return;
                if (data.conversation) applyConversationState(data.conversation);
                else applyWorkspaceChange(data);
                if (!data.draftThread) void loadThreads(Boolean(data.emptyThread));
            });
        });
        source.addEventListener("projects_changed", (event) => {
            const data = parseEventData<{ projects?: AgentProject[]; deletedProjectId?: string; projectId?: string }>(event);
            if (!data?.projects) return;
            setProjects(data.projects);
            if (data.deletedProjectId !== activeProjectIdRef.current) return;
            const fallback = data.projects.find((project) => project.isDefault) || data.projects[0];
            if (!fallback) return;
            activeProjectIdRef.current = fallback.id;
            setActiveProjectId(fallback.id);
            saveAgentProjectId(fallback.id);
            void activateCodexProject(endpoint, token, clientId, fallback.id, permissionMode)
                .then((response) => applyProjectResponse(response as AgentProjectsResponse & { conversation?: AgentConversationState }))
                .then(() => loadThreads())
                .then(() => loadSkills(endpoint, token, clientId, true))
                .catch((error) => addEventLog(rt("conversationSyncFailed"), error));
        });
        source.addEventListener("chat_message", (event) => {
            const data = parseEventData<AgentChatEvent>(event);
            if (!data?.message) return;
            enqueueEvent(() => {
                if (data.projectId && data.projectId !== activeProjectIdRef.current) return;
                if (!isCurrentThreadEvent(data)) return;
                if (!registerLiveAgentTurn(data, authoritativeHistoryTurnsRef.current, liveTurnKeysRef.current)) return;
                const current = useAgentStore.getState();
                const threadId = data.threadId || data.message!.threadId || current.activeThreadId;
                const turnId = data.turnId ?? data.message!.turnId ?? "";
                const clientMessageId = data.message!.clientMessageId || data.message!.itemId || data.message!.id;
                if (current.activeThreadId !== threadId) return;
                const next = scopeChatItem(data.message!, threadId, turnId);
                const currentMessages = data.message!.role === "user" && clientMessageId ? current.messages.filter((item) => item.role !== "user" || item.clientMessageId !== clientMessageId || item.id === next.id) : current.messages;
                const messages = upsertAgentMessage(currentMessages, next);
                setAgentState({ messages });
            });
        });
        source.addEventListener("agent_log", (event) => {
            if (!isCurrentConnection()) return;
            const text = parseEventData<{ text?: unknown }>(event)?.text;
            addEventLog(rt("log"), text, text);
        });
        source.addEventListener("skills_changed", (event) => {
            if (!isCurrentConnection()) return;
            const data = parseEventData<{ forceReload?: boolean; projectId?: string }>(event);
            if (data?.projectId && data.projectId !== activeProjectIdRef.current) return;
            void loadSkills(endpoint, token, clientIdRef.current, Boolean(data?.forceReload));
        });
        source.addEventListener("agent_error", (event) => {
            const data = parseEventData<AgentEventPayload>(event);
            if (!data) return;
            enqueueEvent(() => {
                if (data.projectId && data.projectId !== activeProjectIdRef.current) return;
                if (!isCurrentThreadEvent(data)) return;
                if (!registerLiveAgentTurn(data, authoritativeHistoryTurnsRef.current, liveTurnKeysRef.current)) return;
                showAgentError(data.message, data, !data.replayed);
            });
        });
        source.onerror = () => {
            if (disposed || protocolRejected) return;
            const wasConnected = connectedRef.current;
            const silent = useAgentStore.getState().silentConnect && !wasConnected;
            const text = rt(wasConnected ? "connectionLostDescription" : "connectionFailedDescription");
            if (!errorLoggedRef.current || wasConnected) {
                addEventLog(rt(wasConnected ? "connectionLost" : "connectionFailed"), text);
                if (!headless && !silent) message.error(text);
            }
            errorLoggedRef.current = true;
            connectedRef.current = false;
            pendingToolRef.current = null;
            setGlobalCodexBusy(false);
            setAgentState({
                activity: rt(wasConnected ? "connectionLost" : "connectionFailed"),
                connected: false,
                waiting: false,
                sending: false,
                connectError: silent ? "" : text,
                silentConnect: false,
                fragmentBootstrap: false,
                pendingTool: null,
                pendingApprovals: [],
                pendingClarifications: [],
            });
            useAgentSkillStore.getState().reset();
            // EventSource 会在网络短暂不可用时自动重连；只有服务端明确关闭连接
            // （例如 token/协议错误）才停止本次连接，避免 Agent 重启后把用户卡在失败态。
            if (!wasConnected && source.readyState === EventSource.CLOSED) {
                source.close();
                setAgentState({ enabled: false });
            }
        };
        return () => {
            disposed = true;
            source.close();
            connectedRef.current = false;
            setGlobalCodexBusy(false);
            loadThreadsSequenceRef.current += 1;
            useAgentSkillStore.getState().reset();
        };
    }, [applyConversationState, applyWorkspaceChange, clientReady, enabled, endpoint, loadSkills, loadThreads, message, setAgentState, token]);

    useEffect(() => {
        if (connected) void loadThreads();
    }, [connected, loadThreads]);

    useEffect(() => {
        if (connected && clientIdRef.current) void loadSkills(endpoint, token, clientIdRef.current);
    }, [connected, endpoint, loadSkills, token]);

    useEffect(() => {
        if (!connected) return;
        void fetchAgentJson<AgentModelsResponse>(endpoint, token, "/agent/codex/models")
            .then(({ data = [] }) => {
                const names = new Set<string>();
                const models = data.flatMap((item) => {
                    const name = item.displayName || item.model;
                    const efforts = item.supportedReasoningEfforts.filter(({ reasoningEffort }) => AGENT_REASONING_EFFORTS.has(reasoningEffort));
                    if (item.model === "codex-auto-review" || names.has(name) || !efforts.length) return [];
                    names.add(name);
                    const defaultReasoningEffort = efforts.some((effort) => effort.reasoningEffort === item.defaultReasoningEffort) ? item.defaultReasoningEffort : efforts[0].reasoningEffort;
                    return [{ ...item, supportedReasoningEfforts: efforts, defaultReasoningEffort }];
                });
                if (!models.length) return;
                const savedModel = useAgentStore.getState().model;
                const current = models.find((item) => item.model === savedModel) || models.find((item) => item.isDefault) || models[0];
                const savedEffort = useAgentStore.getState().reasoningEffort;
                const efforts = current.supportedReasoningEfforts.map((item) => item.reasoningEffort);
                const nextEffort = efforts.includes(savedEffort as AgentReasoningEffort) ? (savedEffort as AgentReasoningEffort) : current.defaultReasoningEffort || efforts[0];
                localStorage.setItem("canvas-agent-model", current.model);
                localStorage.setItem("canvas-agent-reasoning-effort", nextEffort);
                setAgentState({ models, model: current.model, reasoningEffort: nextEffort });
            })
            .catch((error) => addEventLog(rt("modelListFailed"), error));
    }, [connected, endpoint, setAgentState, token]);

    useEffect(() => {
        if (!connected) return;
        const activate = () => void activateAgentClient(endpoint, token, clientIdRef.current);
        const activateVisible = () => {
            if (document.visibilityState === "visible") activate();
        };
        window.addEventListener("focus", activate);
        document.addEventListener("visibilitychange", activateVisible);
        return () => {
            window.removeEventListener("focus", activate);
            document.removeEventListener("visibilitychange", activateVisible);
        };
    }, [connected, endpoint, token]);
    const readMessageImage = async (value: string) => {
        const source = resolveAgentMessageAssetUrl(endpoint, token, value);
        if (!source) throw new Error(rt("editImageReadFailed"));
        const response = await fetch(source);
        if (!response.ok) throw new Error(rt("editImageReadFailed"));
        const blob = await response.blob();
        const dataUrl = await readDataUrl(blob);
        const meta = await readImageMeta(dataUrl);
        return { blob, dataUrl, meta };
    };
    const startEditMessage = async (item: AgentChatItem) => {
        const current = useAgentStore.getState();
        const latestUserMessage = [...current.messages].reverse().find((message) => message.role === "user" && Boolean(message.threadId && message.turnId));
        if (editing || current.sending || current.waiting || current.loadingThreads || latestUserMessage?.id !== item.id || !item.threadId || !item.turnId) return;
        const skillState = useAgentSkillStore.getState();
        const selectedSkill = item.skill ? skillState.skills.find((skill) => skill.enabled && skill.name === item.skill.name && skill.path === item.skill.path) || null : null;
        if (item.skill && !selectedSkill) {
            message.warning(rt("editSkillUnavailable"));
            return;
        }
        if ((item.canvasReferences || []).some((reference) => reference.kind === "image" && !reference.previewUrl)) {
            message.warning(rt("editImageReadFailed"));
            return;
        }
        let restoredAttachments: AgentAttachment[] = [];
        const restoredAttachmentUrls = new Set<string>();
        try {
            restoredAttachments = await Promise.all((item.attachments || []).map(async (attachment: AgentMessageAttachment) => {
                const image = await readMessageImage(attachment.dataUrl || attachment.url);
                const url = URL.createObjectURL(image.blob);
                attachmentUrlsRef.current.add(url);
                restoredAttachmentUrls.add(url);
                return {
                    id: attachment.id,
                    name: attachment.name,
                    type: image.blob.type || attachment.type || image.meta.mimeType,
                    size: image.blob.size || attachment.size || 0,
                    width: image.meta.width || attachment.width || 0,
                    height: image.meta.height || attachment.height || 0,
                    url,
                    dataUrl: image.dataUrl,
                };
            }));
            const referenceImages = await Promise.all((item.canvasReferences || []).filter((reference) => reference.kind === "image" && reference.previewUrl).map(async (reference) => {
                const image = await readMessageImage(reference.previewUrl!);
                return {
                    id: `canvas:${reference.nodeId}`,
                    name: reference.title,
                    type: image.blob.type || image.meta.mimeType,
                    size: image.blob.size,
                    width: image.meta.width,
                    height: image.meta.height,
                    url: image.dataUrl,
                    dataUrl: image.dataUrl,
                };
            }));
            const latest = useAgentStore.getState();
            const latestMessage = [...latest.messages].reverse().find((message) => message.role === "user" && Boolean(message.threadId && message.turnId));
            if (latestMessage?.id !== item.id || latest.activeThreadId !== item.threadId) {
                restoredAttachmentUrls.forEach((url) => {
                    URL.revokeObjectURL(url);
                    attachmentUrlsRef.current.delete(url);
                });
                return;
            }
            editDraftRef.current = {
                threadId: item.threadId,
                turnId: item.turnId,
                referenceImages,
                previous: {
                    prompt: latest.prompt,
                    attachments: latest.attachments,
                    canvasReferences: latest.canvasReferences,
                    selectedSkill: skillState.selectedSkill,
                },
            };
            useAgentSkillStore.getState().selectSkill(selectedSkill, item.text);
            setAgentState({
                prompt: item.text,
                attachments: restoredAttachments,
                canvasReferences: (item.canvasReferences || []).map((reference) => ({ ...reference, id: reference.nodeId, active: true })),
            });
            setEditing(true);
        } catch (error) {
            restoredAttachmentUrls.forEach((url) => {
                URL.revokeObjectURL(url);
                attachmentUrlsRef.current.delete(url);
            });
            message.error(error instanceof Error ? error.message : rt("editImageReadFailed"));
        }
    };
    const cancelEditMessage = () => {
        const draft = editDraftRef.current;
        if (!draft) return;
        const { selectedSkill, ...previous } = draft.previous;
        const current = useAgentStore.getState();
        const previousAttachmentUrls = new Set(previous.attachments.map((attachment) => attachment.url));
        current.attachments.filter((attachment) => !previousAttachmentUrls.has(attachment.url)).forEach((attachment) => {
            URL.revokeObjectURL(attachment.url);
            attachmentUrlsRef.current.delete(attachment.url);
        });
        useAgentSkillStore.getState().selectSkill(selectedSkill, previous.prompt);
        editDraftRef.current = null;
        setEditing(false);
        setAgentState(previous);
    };
    const sendPrompt = async () => {
        const editDraft = editDraftRef.current;
        const text = prompt.trim();
        const files = attachments;
        const skillState = useAgentSkillStore.getState();
        const selectedSkill = skillState.selectedSkill;
        const selectedSkillRevision = skillState.selectionRevision;
        const currentState = useAgentStore.getState();
        if (editDraft && editDraft.threadId !== currentState.activeThreadId) return cancelEditMessage();
        const canvasNodeIds = new Set(currentState.canvasContext?.snapshot.nodes.map((node) => node.id) || []);
        const canvasReferences = editDraft ? currentState.canvasReferences : currentState.canvasReferences.filter((item) => canvasNodeIds.has(item.nodeId));
        if (!editDraft && canvasReferences.length !== currentState.canvasReferences.length) {
            setAgentState({ canvasReferences });
            message.warning(rt(canvasReferences.length ? "someCanvasReferencesMissing" : "canvasReferencesMissing"));
        }
        const requestPrompt = promptWithCanvasReferences(promptWithAttachments(text, files), canvasReferences);
        if (!currentState.connected || !requestPrompt || currentState.sending || currentState.waiting || currentState.loadingThreads || !["ready", "warning"].includes(currentState.conversation.status)) return;
        const preservedReferenceImages = (editDraft?.referenceImages || []).filter((image) => canvasReferences.some((reference) => image.id === `canvas:${reference.nodeId}`));
        let referenceImages: AgentAttachment[] = preservedReferenceImages;
        const unresolvedImageReferences = canvasReferences.filter((reference) => reference.kind === "image" && !preservedReferenceImages.some((image) => image.id === `canvas:${reference.nodeId}`));
        if (unresolvedImageReferences.length) {
            setAgentState({ sending: true, activity: rt("readingCanvasImages") });
            try {
                referenceImages = [...referenceImages, ...await resolveCanvasReferenceImages(unresolvedImageReferences, currentState.canvasContext?.snapshot.nodes || [])];
            } catch (error) {
                setAgentState({ sending: false, activity: rt("canvasImageReadFailed") });
                addMessage({ role: "error", title: rt("canvasImageReadFailed"), text: error instanceof Error ? error.message : rt("canvasImageReadFailed") });
                return;
            }
        }
        const requestFiles = [...files, ...referenceImages.filter((reference) => !files.some((file) => file.dataUrl === reference.dataUrl))];
        if (requestFiles.length > MAX_ATTACHMENTS) {
            setAgentState({ sending: false, activity: rt("tooManyImages") });
            addMessage({ role: "error", title: rt("tooManyImages"), text: rt("imageCountLimit", { count: MAX_ATTACHMENTS }) });
            return;
        }
        if (attachmentPayloadBytes(requestFiles) > MAX_ATTACHMENT_PAYLOAD_BYTES) {
            setAgentState({ sending: false, activity: rt("imageTooLarge") });
            addMessage({ role: "error", title: rt("imageTooLarge"), text: rt("imagePayloadTooLarge") });
            return;
        }
        const messageId = createId();
        const userText = text || rt(files.length ? "imagesSent" : "canvasReferencesSent", { count: files.length || canvasReferences.length });
        const messageReferences: AgentCanvasReference[] = await Promise.all(
            canvasReferences.map(async ({ nodeId, label, title, kind, previewUrl, text }) => {
                const image = referenceImages.find((item) => item.id === `canvas:${nodeId}`);
                return { nodeId, label, title, kind, previewUrl: image ? (await createMessageAttachmentMetadata(image)).url : previewUrl, text };
            }),
        );
        const messageSkill = selectedSkill ? { name: selectedSkill.name, path: selectedSkill.path, displayName: selectedSkill.interface?.displayName || undefined } : undefined;
        loadThreadsSequenceRef.current += 1;
        const currentBeforeSend = useAgentStore.getState();
        const requestThreadId = currentBeforeSend.activeThreadId;
        const removeReplacedTurn = (messages: AgentChatItem[]) => editDraft ? messages.filter((item) => item.threadId !== editDraft.threadId || item.turnId !== editDraft.turnId) : messages;
        const messages = removeReplacedTurn(currentBeforeSend.messages);
        if (editDraft) {
            const turnKey = `${editDraft.threadId}\0${editDraft.turnId}`;
            authoritativeHistoryTurnsRef.current.delete(turnKey);
            liveTurnKeysRef.current.delete(turnKey);
            const cached = threadMessagesRef.current.get(editDraft.threadId);
            if (cached) threadMessagesRef.current.set(editDraft.threadId, removeReplacedTurn(cached));
        }
        setAgentState({ prompt: "", attachments: [], canvasReferences: [], activity: rt("sending"), sending: true, loadingThreads: false, activeTurnId: "", messages });
        addMessage({ id: messageId, itemId: "synthetic:user", clientMessageId: messageId, threadId: requestThreadId, turnId: "", role: "user", text: userText, attachments: files, canvasReferences: messageReferences, skill: messageSkill });
        let threadId = requestThreadId;
        try {
            const messageAttachments = await Promise.all(files.map(createMessageAttachmentMetadata));
            const messageMetadata = {
                ...(messageAttachments.length ? { attachments: messageAttachments } : {}),
                ...(messageReferences.length ? { canvasReferences: messageReferences } : {}),
                ...(messageSkill ? { skill: messageSkill } : {}),
            };
            const modelName = models.find((item) => item.model === model)?.displayName || model || rt("defaultModel");
            const effortName = reasoningEffort ? i18n.t(`agent.composer.effort.${reasoningEffort}`) : rt("defaultEffort");
            addEventLog(
                rt("sendTask"),
                `${modelName} · ${effortName}${selectedSkill ? ` · Skill ${selectedSkill.name}` : ""}${files.length ? ` · ${rt("attachmentCount", { count: files.length })}` : ""}${canvasReferences.length ? ` · ${rt("canvasReferenceCount", { count: canvasReferences.length })}` : ""} · ${compactText(text) || rt(canvasReferences.length ? "canvasReferencesOnly" : "attachmentsOnly")}`,
            );
            const accepted = await postCodexTurn(endpoint, token, {
                prompt: requestPrompt,
                messageText: userText,
                messageId,
                clientId: clientIdRef.current,
                threadId,
                conversationId: currentBeforeSend.conversation.conversationId,
                expectedRevision: currentBeforeSend.conversation.revision,
                permissionMode,
                model,
                effort: reasoningEffort,
                skill: selectedSkill ? { name: selectedSkill.name, path: selectedSkill.path } : undefined,
                attachments: requestFiles.map(({ id, name, type, size, width, height, dataUrl }) => ({ id, name, type, size, width, height, dataUrl })),
                messageMetadata,
                ...(editDraft ? { replaceLastTurnId: editDraft.turnId } : {}),
            });
            threadId = accepted.threadId || threadId;
            if (!threadId) throw new Error(rt("startConversationFailed"));
            if (selectedSkill) clearSkillSelection(selectedSkillRevision);
            (editDraft ? [...files, ...editDraft.previous.attachments] : files).forEach((item) => {
                URL.revokeObjectURL(item.url);
                attachmentUrlsRef.current.delete(item.url);
            });
            if (editDraftRef.current === editDraft) {
                editDraftRef.current = null;
                setEditing(false);
            }
        } catch (error) {
            const text = error instanceof Error ? error.message : rt("sendFailed");
            const response = error instanceof AgentApiError ? (error.response as { code?: string; state?: AgentConversationState }) : undefined;
            if (response?.state) applyConversationState(response.state);
            if (editDraft) await loadThreads().catch(() => undefined);
            const stale = response?.code === "CONVERSATION_STALE";
            const busy = response?.code === "CONVERSATION_BUSY" || text.includes("Codex 正在运行");
            const state = useAgentStore.getState();
            const removeFailedPending = (messages: AgentChatItem[]) => messages.filter((item) => item.clientMessageId !== messageId || Boolean(item.turnId));
            threadMessagesRef.current.forEach((messages, cachedThreadId) => {
                const next = removeFailedPending(messages);
                if (next.length !== messages.length) threadMessagesRef.current.set(cachedThreadId, next);
            });
            const ownsCurrentThread = state.activeThreadId === (threadId || requestThreadId);
            const restoreDraft = editDraft || (!state.prompt && !state.attachments.length && !state.canvasReferences.length) ? { prompt, attachments: files, canvasReferences } : {};
            if (ownsCurrentThread) {
                setAgentState({
                    activity: rt(stale ? "conversationSynced" : busy ? "codexRunning" : "sendFailed"),
                    sending: false,
                    messages: removeFailedPending(state.messages),
                    ...restoreDraft,
                });
                addMessage({ threadId: state.activeThreadId, turnId: "", role: "error", title: rt(stale ? "conversationSynced" : busy ? "taskStillRunning" : "sendFailed"), text });
            } else {
                setAgentState({ sending: false, messages: removeFailedPending(state.messages), ...restoreDraft });
            }
            addEventLog(rt("sendFailed"), error);
        }
    };

    const stopTurn = async () => {
        if (!connected || (!sending && !waiting)) return;
        setAgentState({ activity: rt("stopping") });
        try {
            await interruptCodexTurn(endpoint, token, useAgentStore.getState().activeThreadId || undefined);
            addEventLog(rt("stopTask"), rt("taskStopped"));
        } catch (error) {
            setAgentState({ activity: rt("stopFailed") });
            addEventLog(rt("stopFailed"), error);
        }
    };

    const addAttachments = async (files: FileList | File[] | null) => {
        if (!files) return;
        const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
        const prev = useAgentStore.getState().attachments;
        try {
            const next = await Promise.all(
                images.slice(0, Math.max(0, MAX_ATTACHMENTS - prev.length)).map(async (file) => {
                    const dataUrl = await readDataUrl(file);
                    const meta = await readImageMeta(dataUrl);
                    const url = URL.createObjectURL(file);
                    attachmentUrlsRef.current.add(url);
                    return { id: createId(), name: file.name, type: file.type, size: file.size, width: meta.width, height: meta.height, url, dataUrl };
                }),
            );
            const merged = [...prev, ...next];
            if (attachmentPayloadBytes(merged) > MAX_ATTACHMENT_PAYLOAD_BYTES) {
                next.forEach((item) => {
                    URL.revokeObjectURL(item.url);
                    attachmentUrlsRef.current.delete(item.url);
                });
                addMessage({ role: "error", title: rt("imageTooLarge"), text: rt("imageLimit") });
                return;
            }
            if (next.length) setAgentState({ attachments: merged });
        } catch (error) {
            addMessage({ role: "error", title: rt("imageReadFailed"), text: error instanceof Error ? error.message : rt("imageReadFailed") });
        }
    };

    const removeAttachment = (id: string) => {
        const removed = attachments.find((item) => item.id === id);
        if (removed) {
            URL.revokeObjectURL(removed.url);
            attachmentUrlsRef.current.delete(removed.url);
        }
        setAgentState({ attachments: attachments.filter((item) => item.id !== id) });
    };

    const handleToolCall = async (endpoint: string, token: string, payload: AgentPendingToolCall) => {
        if (confirmToolsRef.current && isCanvasWriteTool(payload.name)) {
            if (pendingToolRef.current) {
                await postToolResult(endpoint, token, clientIdRef.current, { requestId: payload.requestId, error: rt("pendingCanvasTool") });
                return;
            }
            pendingToolRef.current = payload;
            setAgentState({ pendingTool: payload });
            addEventLog(rt("awaitingConfirmation"), payload, payload);
            return;
        }
        await runToolCall(endpoint, token, payload);
    };

    const runToolCall = async (endpoint: string, token: string, payload: AgentPendingToolCall) => {
        if (isSiteTool(payload.name)) {
            try {
                addEventLog(toolName(payload.name), payload, payload);
                const result = await runSiteTool(payload.name, payload.input || {}, navigate, { canvasSnapshot: canvasContextRef.current?.snapshot || null });
                await postToolResult(endpoint, token, clientIdRef.current, { requestId: payload.requestId, result });
                addEventLog(rt("toolCompleted", { tool: toolName(payload.name) }), result, result);
            } catch (error) {
                const message = error instanceof Error ? error.message : rt("toolExecutionFailed");
                await postToolResult(endpoint, token, clientIdRef.current, { requestId: payload.requestId, error: message });
            }
            return;
        }
        try {
            const input: { ops?: CanvasAgentOp[]; path?: string } = payload.input || {};
            addEventLog(toolName(payload.name), payload, payload);
            let result: unknown;
            let appliedOps = input.ops || [];
            if (payload.name === "site_navigate") {
                const path = input.path || "/";
                navigate(path);
                result = { ok: true, path };
            } else if (payload.name === "canvas_apply_ops") {
                const context = canvasContextRef.current;
                if (!context) throw new Error(rt("openCanvasFirst"));
                result = context.applyOps(appliedOps);
                void postState(endpoint, token, clientIdRef.current, result as CanvasAgentSnapshot);
            } else if (payload.name === "canvas_create_attachment_nodes") {
                const context = canvasContextRef.current;
                if (!context) throw new Error(rt("openCanvasFirst"));
                appliedOps = await attachmentNodeOps(endpoint, token, clientIdRef.current, payload.input?.nodes);
                result = context.applyOps(appliedOps);
                await postState(endpoint, token, clientIdRef.current, result as CanvasAgentSnapshot);
            } else {
                const snapshot = canvasContextRef.current?.snapshot;
                if (!snapshot) throw new Error(rt("openCanvasFirst"));
                result = snapshot;
            }
            await postToolResult(endpoint, token, clientIdRef.current, { requestId: payload.requestId, result });
            addEventLog(rt("toolCompleted", { tool: toolName(payload.name) }), result, result);
        } catch (error) {
            const message = error instanceof Error ? error.message : rt("canvasOperationFailed");
            await postToolResult(endpoint, token, clientIdRef.current, { requestId: payload.requestId, error: message });
        }
    };

    const rejectPendingTool = async () => {
        if (!pendingTool) return;
        await postToolResult(endpoint, token, clientIdRef.current, { requestId: pendingTool.requestId, error: rt("canvasToolCanceled") });
        pendingToolRef.current = null;
        setAgentState({ pendingTool: null });
    };

    const approvePendingTool = async () => {
        if (!pendingTool) return;
        const tool = pendingTool;
        pendingToolRef.current = null;
        setAgentState({ pendingTool: null });
        await runToolCall(endpoint, token, tool);
    };

    const decideApproval = async (approval: AgentPendingApproval, decision: "accept" | "acceptForSession" | "decline") => {
        const current = useAgentStore.getState();
        const pending = current.pendingApprovals.find((item) => item.requestId === approval.requestId);
        if (!pending || pending.deciding) return;
        setAgentState({ pendingApprovals: current.pendingApprovals.map((item) => (item.requestId === approval.requestId ? { ...item, deciding: decision } : item)), activity: rt("submittingApproval") });
        try {
            await postCodexApproval(endpoint, token, approval.requestId, decision);
            const latest = useAgentStore.getState();
            if (latest.pendingApprovals.some((item) => item.requestId === approval.requestId)) setAgentState({ activity: rt("waitingCodexApproval") });
        } catch (error) {
            const latest = useAgentStore.getState();
            const expired = error instanceof Error && error.message.includes("审批请求已失效");
            const resolved = expired || !latest.pendingApprovals.some((item) => item.requestId === approval.requestId);
            const pendingApprovals = resolved ? latest.pendingApprovals.filter((item) => item.requestId !== approval.requestId) : latest.pendingApprovals.map((item) => (item.requestId === approval.requestId ? { ...item, deciding: undefined } : item));
            setAgentState({ pendingApprovals, activity: approvalActivity(pendingApprovals, latest.waiting, latest.activity) });
            if (resolved) return;
            addEventLog(rt("approvalFailed"), error);
            message.error(error instanceof Error ? error.message : rt("approvalFailed"));
        }
    };

    const settleClarification = (requestId: string) => {
        const latest = useAgentStore.getState();
        const pendingClarifications = latest.pendingClarifications.filter((item) => item.requestId !== requestId);
        setAgentState({ pendingClarifications, activity: clarificationActivity(pendingClarifications, latest.pendingApprovals, latest.waiting, latest.activity) });
    };

    const clarificationRequestIsTerminal = (error: unknown) => error instanceof AgentApiError && ["accepted", "cancelled", "expired", "missing"].includes(String((error.response as { state?: unknown }).state || ""));

    const submitClarification = async (clarification: AgentPendingClarification, answers: AgentClarificationAnswers) => {
        const current = useAgentStore.getState();
        const pending = current.pendingClarifications.find((item) => item.requestId === clarification.requestId);
        if (!pending || pending.deciding) return;
        setAgentState({ pendingClarifications: current.pendingClarifications.map((item) => (item.requestId === clarification.requestId ? { ...item, deciding: "submit" } : item)), activity: rt("submittingClarification") });
        try {
            await postCodexClarification(endpoint, token, clarification.requestId, answers);
            settleClarification(clarification.requestId);
        } catch (error) {
            if (clarificationRequestIsTerminal(error)) {
                settleClarification(clarification.requestId);
                return;
            }
            const latest = useAgentStore.getState();
            setAgentState({
                pendingClarifications: latest.pendingClarifications.map((item) => (item.requestId === clarification.requestId ? { ...item, deciding: undefined } : item)),
                activity: clarificationActivity(latest.pendingClarifications, latest.pendingApprovals, latest.waiting, latest.activity),
            });
            addEventLog(rt("clarificationFailed"), error);
            message.error(error instanceof Error ? error.message : rt("clarificationFailed"));
        }
    };

    const cancelClarification = async (clarification: AgentPendingClarification) => {
        const current = useAgentStore.getState();
        const pending = current.pendingClarifications.find((item) => item.requestId === clarification.requestId);
        if (!pending || pending.deciding) return;
        setAgentState({ pendingClarifications: current.pendingClarifications.map((item) => (item.requestId === clarification.requestId ? { ...item, deciding: "cancel" } : item)), activity: rt("submittingClarification") });
        try {
            await postCodexClarification(endpoint, token, clarification.requestId);
            settleClarification(clarification.requestId);
        } catch (error) {
            if (clarificationRequestIsTerminal(error)) {
                settleClarification(clarification.requestId);
                return;
            }
            const latest = useAgentStore.getState();
            setAgentState({
                pendingClarifications: latest.pendingClarifications.map((item) => (item.requestId === clarification.requestId ? { ...item, deciding: undefined } : item)),
                activity: clarificationActivity(latest.pendingClarifications, latest.pendingApprovals, latest.waiting, latest.activity),
            });
            addEventLog(rt("clarificationFailed"), error);
            message.error(error instanceof Error ? error.message : rt("clarificationFailed"));
        }
    };

    const changePermissionMode = (nextMode: AgentPermissionMode) => {
        const apply = () => {
            localStorage.setItem("canvas-agent-permission-mode", nextMode);
            setAgentState({ permissionMode: nextMode });
        };
        if (nextMode !== "full") return apply();
        modal.confirm({
            title: rt("enableFullAccess"),
            content: rt("fullAccessDescription"),
            okText: rt("enableFullAccessAction"),
            okType: "danger",
            cancelText: t("common.cancel"),
            onOk: apply,
        });
    };

    const toggleAgentConnection = async ({ silent = false }: { silent?: boolean } = {}) => {
        if (enabled) {
            clearAgentSession({ enabled: false, connected: false, activity: rt("offline"), connectError: "" });
            return;
        }
        const urlToken = searchParams.get("agentToken") || "";
        const urlEndpoint = searchParams.get("agentUrl") || "";
        const discovered = urlToken ? null : await discoverAgentConfig(endpoint || DEFAULT_AGENT_URL);
        const nextEndpoint = (urlEndpoint || discovered?.url || endpoint || DEFAULT_AGENT_URL).trim().replace(/\/$/, "");
        const nextToken = (urlToken || token.trim() || discovered?.token || "").trim();
        if (!nextEndpoint) {
            const text = rt("addressRequired");
            if (!silent) {
                setAgentState({ connectError: text });
                if (!headless) message.warning(text);
            }
            return;
        }
        if (!nextToken) {
            const text = rt("agentNotFound");
            if (!silent) {
                setAgentState({ connectError: text });
                if (!headless) message.warning(text);
            }
            return;
        }
        try {
            const parsed = new URL(nextEndpoint);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("invalid protocol");
        } catch {
            const text = rt("invalidAddress");
            if (!silent) {
                setAgentState({ connectError: text });
                if (!headless) message.warning(text);
            }
            return;
        }
        errorLoggedRef.current = false;
        setAgentState({ url: nextEndpoint, token: nextToken, enabled: true, connected: false, silentConnect: silent, fragmentBootstrap: false, activity: rt("connecting"), connectError: "", activeTab: "setup" });
    };

    useLayoutEffect(() => {
        const bootstrap = readAgentUrlBootstrap(hash);
        if (!bootstrap) return;
        navigate(`${window.location.pathname}${window.location.search}${bootstrap.remainingHash}`, { replace: true });
        if (!bootstrap.url || !bootstrap.token) {
            setAgentState({ fragmentBootstrap: false, activeTab: "setup", connectError: rt(!bootstrap.url ? "addressRequired" : "agentNotFound") });
            useAgentStore.getState().openPanel();
            return;
        }
        try {
            const parsed = new URL(bootstrap.url);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("invalid protocol");
        } catch {
            setAgentState({ fragmentBootstrap: false, activeTab: "setup", connectError: rt("invalidAddress") });
            useAgentStore.getState().openPanel();
            return;
        }
        errorLoggedRef.current = false;
        setAgentState({ url: bootstrap.url.replace(/\/$/, ""), token: bootstrap.token, enabled: true, connected: false, silentConnect: true, fragmentBootstrap: true, confirmTools: false, activity: rt("connecting"), connectError: "", activeTab: "setup" });
    }, [hash, navigate, setAgentState]);

    useEffect(() => {
        if (urlAgentAutoConnect && confirmTools) setAgentState({ confirmTools: false });
    }, [confirmTools, setAgentState, urlAgentAutoConnect]);

    useEffect(() => {
        if ((!autoConnect && !urlAgentAutoConnect) || autoConnectRef.current || enabled || connected) return;
        autoConnectRef.current = true;
        void toggleAgentConnection({ silent: true });
    }, [autoConnect, connected, enabled, urlAgentAutoConnect]);

    function clearAgentSession(patch: Parameters<typeof setAgentState>[0] = {}) {
        loadThreadsSequenceRef.current += 1;
        threadMessagesRef.current.clear();
        authoritativeHistoryTurnsRef.current.clear();
        liveTurnKeysRef.current.clear();
        threadOperationRef.current = 0;
        setAgentState({
            messages: [],
            tokenUsage: null,
            threads: [],
            activeThreadId: "",
            activeTurnId: "",
            workspacePath: "",
            loadingThreads: false,
            waiting: false,
            sending: false,
            fragmentBootstrap: false,
            pendingTool: null,
            pendingApprovals: [],
            pendingClarifications: [],
            conversation: { revision: 0, conversationId: "", threadId: "", status: "idle", mcpStatuses: {} },
            bootstrapStatus: null,
            mcpStartupStatuses: {},
            ...patch,
        });
        useAgentSkillStore.getState().reset();
        pendingToolRef.current = null;
    }

    const beginThreadOperation = () => {
        const operation = ++threadOperationSequenceRef.current;
        threadOperationRef.current = operation;
        setAgentState({ loadingThreads: true });
        return operation;
    };

    const finishThreadOperation = (operation: number) => {
        if (threadOperationRef.current !== operation) return;
        threadOperationRef.current = 0;
        setAgentState({ loadingThreads: false });
    };

    const startNewThread = async () => {
        const current = useAgentStore.getState();
        if (!current.connected || current.sending || current.waiting || current.loadingThreads || ["preparing", "running"].includes(current.conversation.status)) return;
        const operation = beginThreadOperation();
        clearSkillSelection();
        setAgentState({ activeTab: "chat", activity: rt("creatingConversation") });
        try {
            const result = await fetchAgentJson<AgentWorkspaceResponse>(endpoint, token, "/agent/codex/threads/reset", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ clientId: clientIdRef.current, permissionMode }),
            });
            if (threadOperationRef.current !== operation) return;
            if (result.conversation) applyConversationState(result.conversation);
            setAgentState({ activeTab: "chat", activity: rt("newConversation") });
        } catch (error) {
            const state = agentErrorState(error);
            if (state) applyConversationState(state);
            addEventLog(rt("newConversationFailed"), error);
            message.error(error instanceof Error ? error.message : rt("newConversationFailed"));
            await loadThreads();
        } finally {
            finishThreadOperation(operation);
        }
    };

    const resumeThread = async (threadId: string) => {
        const current = useAgentStore.getState();
        if (!current.connected || !threadId || current.sending || current.waiting || current.loadingThreads || ["preparing", "running"].includes(current.conversation.status)) return;
        const operation = beginThreadOperation();
        try {
            const result = await fetchAgentJson<AgentThreadResponse>(endpoint, token, `/agent/codex/threads/${encodeURIComponent(threadId)}/resume`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ permissionMode, clientId: clientIdRef.current }),
            });
            if (result.conversation) applyConversationState(result.conversation);
            await loadThreads();
            if (useAgentStore.getState().activeThreadId === threadId) setAgentState({ activeTab: "chat", activity: rt("conversationResumed") });
        } catch (error) {
            const state = agentErrorState(error);
            if (state) applyConversationState(state);
            addEventLog(rt("resumeConversationFailed"), error);
            message.error(error instanceof Error ? error.message : rt("resumeConversationFailed"));
            await loadThreads();
        } finally {
            finishThreadOperation(operation);
        }
    };

    const deleteThreads = async (threadIds: string[]) => {
        if (!connected || !threadIds.length || sending || waiting || loadingThreads) return;
        const operation = beginThreadOperation();
        let deletedCount = 0;
        try {
            for (const threadId of new Set(threadIds)) {
                await fetchAgentJson(endpoint, token, `/agent/codex/threads/${encodeURIComponent(threadId)}/delete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId: clientIdRef.current }) });
                threadMessagesRef.current.delete(threadId);
                deletedCount += 1;
            }
            await loadThreads();
            message.success(rt("recordsDeleted", { count: deletedCount }));
        } catch (error) {
            await loadThreads();
            addEventLog(rt("deleteConversationFailed"), error);
            message.error(error instanceof Error ? error.message : rt("deleteConversationFailed"));
        } finally {
            finishThreadOperation(operation);
        }
    };

    const confirmDeleteThreads = (threadIds: string[]) => {
        modal.confirm({
            title: rt("deleteConversations", { count: threadIds.length }),
            content: rt("deleteConversationsDescription"),
            okText: t("common.delete"),
            okType: "danger",
            cancelText: t("common.cancel"),
            onOk: () => deleteThreads(threadIds),
        });
    };

    const addMessage = (item: Omit<AgentChatItem, "id"> & { id?: string }) => {
        const text = normalizeText(item.text);
        if (!text && !item.attachments?.length) return;
        const current = useAgentStore.getState();
        const itemId = item.itemId || item.id || createId();
        const next = scopeChatItem({ ...item, id: item.id || itemId, itemId, text } as AgentChatItem, item.threadId ?? current.activeThreadId, item.turnId ?? current.activeTurnId);
        setAgentState({ messages: upsertAgentMessage(current.messages, next) });
    };

    const addEventLog = (title: string, text: unknown, raw?: unknown) => {
        const value = normalizeText(text) || title;
        const last = useAgentStore.getState().eventLogs.at(-1);
        if (last?.title === title && last.text === value) return;
        pushEventLog({ id: `${Date.now()}-${Math.random()}`, time: dayjs().format("YYYY-MM-DD HH:mm:ss"), title, text: value, raw });
    };

    const upsertActivityMessage = (item: AgentChatItem) => {
        setAgentState({ messages: upsertAgentMessage(useAgentStore.getState().messages, item) });
    };

    const appendActivityDelta = (event: AgentEventPayload) => {
        const item = event.item;
        if (!item?.id) return;
        const text = stringText(item.text) || stringText(item.delta);
        const isDelta = Boolean(stringText(item.delta));
        if (!text) return;
        if (item.type === "reasoning") {
            const scoped = scopeEventChatItem(event, activityDeltaFallback(item, text), "synthetic:reasoning");
            const current = useAgentStore.getState().messages.find((message) => message.id === scoped.id);
            const activityItems = { ...(current?.activityItems || {}) };
            const previous = activityItems[item.id] || "";
            activityItems[item.id] = isDelta ? `${previous === activityPlaceholder("reasoning") ? "" : previous}${text}` : text;
            upsertActivityMessage({ ...scoped, title: i18n.t("agent.events.reasoning"), text: reasoningActivityText(activityItems), activityItems, detail: activityDetail(current?.detail || scoped.detail, "reasoning", "inProgress") });
            return;
        }
        const scoped = scopeEventChatItem(event, activityDeltaFallback(item, text), item.id);
        const currentMessages = useAgentStore.getState().messages;
        const index = currentMessages.findIndex((message) => message.id === scoped.id);
        if (index < 0) {
            if (!text.trim()) return;
            upsertActivityMessage(scoped);
            return;
        }
        const current = currentMessages[index];
        if (item.type === "command_execution") {
            const detail = activityDetail(current.detail, "command", "inProgress");
            detail.output = isDelta ? `${stringText(detail.output)}${text}` : text;
            setAgentState({ messages: currentMessages.map((message, itemIndex) => (itemIndex === index ? { ...message, detail } : message)) });
            return;
        }
        const placeholder = activityPlaceholder(item.type);
        if (!text.trim() && current.text === placeholder) return;
        const nextText = isDelta ? `${current.text === placeholder ? "" : current.text}${text}` : mergeStreamText(current.text, text);
        setAgentState({ messages: currentMessages.map((message, itemIndex) => (itemIndex === index ? { ...message, text: nextText, detail: { ...activityDetail(message.detail, activityKind(item.type), "inProgress") } } : message)) });
    };

    const upsertEventActivity = (event: AgentEventPayload, item: Omit<AgentChatItem, "id">) => {
        const itemId = event.item?.id;
        if (!itemId) return;
        if (event.item?.type === "reasoning") {
            const scoped = scopeEventChatItem(event, { ...item, id: "synthetic:reasoning" }, "synthetic:reasoning");
            const current = useAgentStore.getState().messages.find((message) => message.id === scoped.id);
            const activityItems = { ...(current?.activityItems || {}) };
            const previous = activityItems[itemId] || "";
            const incoming = normalizeText(item.text);
            activityItems[itemId] = incoming === "已完成分析" && previous && previous !== activityPlaceholder("reasoning") ? previous : incoming;
            upsertActivityMessage({ ...scoped, title: i18n.t("agent.events.reasoning"), text: reasoningActivityText(activityItems, incoming), activityItems });
            return;
        }
        upsertActivityMessage(scopeEventChatItem(event, { ...item, id: itemId }, itemId));
    };

    const finishEmptyReasoningActivity = (event: AgentEventPayload) => {
        const itemId = event.item?.id;
        if (!itemId) return;
        const scopedId = scopeEventChatItem(event, { id: "synthetic:reasoning", role: "tool", text: "" }, "synthetic:reasoning").id;
        const currentMessages = useAgentStore.getState().messages;
        const index = currentMessages.findIndex((message) => message.id === scopedId);
        if (index < 0) return;
        const current = currentMessages[index];
        const activityItems = { ...(current.activityItems || {}) };
        delete activityItems[itemId];
        if (!Object.values(activityItems).some(isReasoningSummary)) {
            setAgentState({ messages: currentMessages.filter((_, itemIndex) => itemIndex !== index) });
            return;
        }
        setAgentState({
            messages: currentMessages.map((message, itemIndex) => (itemIndex === index ? { ...message, text: reasoningActivityText(activityItems), activityItems, detail: activityDetail(message.detail, "reasoning", "completed") } : message)),
        });
    };

    const finishPlanActivity = (event: AgentEventPayload) => {
        const id = scopeEventChatItem(event, { id: "synthetic:plan", role: "tool", text: "" }, "synthetic:plan").id;
        const currentMessages = useAgentStore.getState().messages;
        const index = currentMessages.findIndex((message) => message.id === id);
        if (index < 0) return;
        const current = currentMessages[index];
        const detail = activityDetail(current.detail, "todo", turnPlanStatus(current.detail, event.status));
        setAgentState({ messages: currentMessages.map((message, itemIndex) => (itemIndex === index ? { ...message, detail } : message)) });
    };

    const showAgentError = (value: unknown, event?: AgentEventPayload, log = true) => {
        const error = agentErrorView(value);
        const item = event
            ? scopeEventChatItem(event, { id: "synthetic:error", role: "error", title: error.title, text: error.text }, "synthetic:error")
            : scopeChatItem({ id: createId(), role: "error", title: error.title, text: error.text }, useAgentStore.getState().activeThreadId, useAgentStore.getState().activeTurnId);
        const state = useAgentStore.getState();
        const current = state.messages.find((message) => message.id === item.id);
        if (current && !normalizeText(value)) return;
        upsertActivityMessage(item);
        setAgentState({ activity: rt("processingFailed"), pendingApprovals: [], pendingClarifications: [] });
        if (log) addEventLog(rt("processingFailed"), error.text, value);
    };

    const handleAgentEvent = async (event: AgentEventPayload) => {
        if (event.type === "usage.updated") setAgentState({ tokenUsage: eventUsage(event) });
        const log = event.replayed ? null : formatAgentEventLog(event);
        const activity = formatAgentActivity(event);
        if (log) addEventLog(log.title, log.text);
        if (event.type === "turn.started" && (event.turnId || event.turn_id)) {
            const scope = eventScope(event);
            const current = useAgentStore.getState();
            if (!scope.threadId || !scope.turnId) return;
            liveTurnKeysRef.current.add(`${scope.threadId}\0${scope.turnId}`);
            setAgentState({ activeTurnId: scope.turnId, bootstrapStatus: null, mcpStartupStatuses: {}, messages: bindPendingTurnMessages(current.messages, scope.threadId, scope.turnId) });
        }
        if (event.type === "item.updated" && event.item?.type === "agent_message" && event.item.id) {
            const delta = stringText(event.item.delta);
            appendStreamText(event, delta || stringText(event.item.text), Boolean(delta));
            return;
        }
        if (event.type === "item.updated" && event.item) {
            appendActivityDelta(event);
            return;
        }
        if (event.type === "plan.updated" && event.turn_id) {
            const plan = formatAgentPlan(event);
            if (plan) upsertActivityMessage(scopeEventChatItem(event, { ...plan, id: "synthetic:plan" }, "synthetic:plan"));
            return;
        }
        if (event.type === "item.completed" && event.item?.type === "error") {
            showAgentError(event.item.message, event, !event.replayed);
            return;
        }
        if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.id) {
            const scoped = scopeEventChatItem(event, { id: event.item.id, role: "assistant", title: "Codex", text: stringText(event.item.text) }, event.item.id);
            const currentMessages = useAgentStore.getState().messages;
            const index = currentMessages.findIndex((message) => message.id === scoped.id);
            if (index >= 0) {
                const text = stringText(event.item.text);
                setAgentState({ messages: currentMessages.map((message, itemIndex) => (itemIndex === index ? { ...message, text: text || message.text, streamId: undefined } : message)) });
                return;
            }
            addMessage(scoped);
            return;
        }
        if (event.type === "item.completed" && event.item?.type === "reasoning" && !activity) {
            finishEmptyReasoningActivity(event);
            return;
        }
        if (event.type === "item.completed" && !activity && event.item?.id && event.item.type === "plan") {
            const id = scopeEventChatItem(event, { id: event.item.id, role: "tool", text: "" }, event.item.id).id;
            setAgentState({ messages: useAgentStore.getState().messages.filter((item) => item.id !== id) });
            return;
        }
        if (!event.replayed && event.type === "item.completed" && event.item?.type === "image_generation" && event.item.id && event.sourceClientId === clientIdRef.current) {
            const generated = await importGeneratedImages(endpoint, token, event.item);
            if (generated.length) {
                const context = canvasContextRef.current;
                if (context) {
                    const right = Math.max(0, ...context.snapshot.nodes.map((node) => node.position.x + node.width)) + 80;
                    const ops = generated.map<CanvasAgentOp>((image, index) => {
                        const size = fitNodeSize(image.upload.width, image.upload.height);
                        return {
                            type: "add_node",
                            id: `image-${createId()}`,
                            nodeType: "image",
                            title: image.name,
                            position: { x: right + index * 40, y: index * 40 },
                            ...size,
                            metadata: imageMetadata(image.upload),
                        };
                    });
                    const result = context.applyOps(ops);
                    void postState(endpoint, token, clientIdRef.current, result);
                }
                addEventLog(rt("importGeneratedImages"), rt(context ? "addedToSourceCanvas" : "imageGenerated"));
            }
        }
        if (activity && event.item?.id) {
            upsertEventActivity(event, activity);
            return;
        }
        if (event.type === "turn.completed") {
            const scope = eventScope(event);
            if (scope.turnId) {
                finishPlanActivity(event);
                liveTurnKeysRef.current.add(`${scope.threadId}\0${scope.turnId}`);
            }
            const current = useAgentStore.getState();
            setAgentState({
                activeTurnId: current.activeTurnId === scope.turnId ? "" : current.activeTurnId,
                messages: current.messages.map((message) => (message.threadId === scope.threadId && message.turnId === scope.turnId && message.streamId ? { ...message, streamId: undefined } : message)),
            });
            if (event.status === "failed") showAgentError(event.error?.message, event, !event.replayed);
        }
        const item = formatAgentEvent(event);
        if (item) addMessage(scopeEventChatItem(event, { ...item, id: event.item?.id || createId() }, event.item?.id || createId()));
    };

    const appendStreamText = (event: AgentEventPayload, text: string, isDelta = false) => {
        if (!text) return;
        const itemId = event.item?.id;
        if (!itemId) return;
        const scoped = scopeEventChatItem(event, { id: itemId, role: "assistant", title: "Codex", text, streamId: itemId }, itemId);
        const currentMessages = useAgentStore.getState().messages;
        const index = currentMessages.findIndex((message) => message.id === scoped.id);
        if (index < 0) {
            pushMessage(scoped);
            return;
        }
        setAgentState({ messages: currentMessages.map((message, itemIndex) => (itemIndex === index ? { ...message, text: isDelta ? `${message.text}${text}` : mergeStreamText(message.text, text) } : message)) });
    };

    const connectionStatus = t(connectError ? "agent.status.failed" : connected ? "agent.status.connected" : enabled ? "agent.status.connecting" : "agent.status.disconnected");
    const connectionStatusColor = connectError ? "#dc2626" : connected ? "#16a34a" : enabled ? "#d97706" : theme.node.muted;
    const activeProject = projects.find((project) => project.id === activeProjectId) || null;
    const projectBusy = globalCodexBusy || projectChanging || sending || waiting || loadingThreads || conversationBusy;
    const content = (
        <>
            <AgentPanelTabs
                value={activeTab}
                theme={theme}
                leading={
                    <div className="flex items-center gap-1">
                        <span className="grid size-8 place-items-center">
                            <Bot className="size-4" />
                        </span>
                        <div className="hidden text-base font-semibold leading-5 @min-[560px]:block">Agent</div>
                        <Tooltip title={activeProject?.workspacePath || t("agent.projects.select")} placement="bottom">
                            <Button
                                size="small"
                                type="text"
                                className="!h-8 !w-8 !min-w-8 !px-0 @min-[720px]:!w-auto @min-[720px]:!min-w-0 @min-[720px]:!px-[7px]"
                                aria-label={t("agent.projects.select")}
                                disabled={!connected || projectBusy}
                                icon={<FolderOpen className="size-3.5" />}
                                onClick={() => setProjectModalOpen(true)}
                            >
                                <span className="hidden max-w-28 truncate @min-[720px]:inline">{activeProject?.name || t("agent.projects.loading")}</span>
                            </Button>
                        </Tooltip>
                        <Tooltip title={t("agent.panel.connectionSettings", { status: connectionStatus })} placement="bottom">
                            <Button
                                size="small"
                                type="text"
                                className="!h-8 !w-8 !min-w-8 !px-0 @min-[560px]:!w-auto @min-[560px]:!min-w-0 @min-[560px]:!px-[7px]"
                                aria-label={t("agent.panel.connectionSettingsLabel", { status: connectionStatus })}
                                icon={<PlugZap className="size-3.5" style={{ color: connectionStatusColor }} />}
                                onClick={() => setAgentState({ activeTab: "setup" })}
                            >
                                <span className="hidden @min-[560px]:inline">{connectionStatus}</span>
                            </Button>
                        </Tooltip>
                    </div>
                }
                items={[
                    { value: "chat", label: t("agent.panel.chat"), icon: <MessageSquare className="size-3.5" /> },
                    { value: "history", label: t("agent.panel.history"), icon: <History className="size-3.5" />, count: threads.length },
                    { value: "skills", label: t("agent.panel.skills"), icon: <Sparkles className="size-3.5" />, count: skillCount },
                    { value: "log", label: t("agent.panel.logs"), icon: <Terminal className="size-3.5" />, count: eventLogs.length },
                ]}
                onChange={(activeTab) => {
                    setAgentState({ activeTab });
                    if (activeTab === "history") void loadThreads();
                }}
                right={
                    <>
                        <Tooltip title={t("agent.history.newThread")} placement="bottom">
                            <Button
                                size="small"
                                type="text"
                                className="!h-8 !w-8 !min-w-8 !px-0 @min-[560px]:!w-auto @min-[560px]:!min-w-0 @min-[560px]:!px-[7px]"
                                aria-label={t("agent.history.newThread")}
                                disabled={!connected || loadingThreads || sending || waiting || conversationBusy}
                                icon={<Plus className="size-3.5" />}
                                onClick={startNewThread}
                            >
                                <span className="hidden @min-[560px]:inline">{t("agent.history.newThread")}</span>
                            </Button>
                        </Tooltip>
                        <Tooltip title={t("agent.panel.collapse")}>
                            <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" aria-label={t("agent.panel.collapseLabel")} style={{ color: theme.node.muted }} icon={<PanelRightClose className="size-4" />} onClick={closePanel} />
                        </Tooltip>
                    </>
                }
            />
            <AgentProjectModal
                open={projectModalOpen}
                projects={projects}
                activeProjectId={activeProjectId}
                busy={projectBusy}
                onClose={() => setProjectModalOpen(false)}
                onSelect={async (project) => {
                    await changeProject(project.id);
                    setProjectModalOpen(false);
                }}
                onCreate={createProject}
                onDelete={removeProject}
                onChooseDirectory={(signal) => selectAgentLocalDirectory(endpoint, token, signal)}
            />

            {activeTab === "setup" ? (
                <AgentConnectView
                    theme={theme}
                    url={url}
                    token={token}
                    enabled={enabled}
                    connected={connected}
                    activity={activity}
                    connectError={connectError}
                    onUrlChange={(url) => setAgentState({ url, connectError: "" })}
                    onTokenChange={(token) => setAgentState({ token, connectError: "" })}
                    onToggleEnabled={toggleAgentConnection}
                />
            ) : activeTab === "skills" ? (
                <AgentSkillsView clientId={clientIdRef.current} />
            ) : activeTab === "history" ? (
                <AgentHistoryView
                    theme={theme}
                    threads={threads}
                    activeThreadId={activeThreadId}
                    workspacePath={workspacePath}
                    loading={loadingThreads}
                    busy={sending || waiting || conversationBusy}
                    connected={connected}
                    onRefresh={() => void loadThreads()}
                    onNewThread={() => void startNewThread()}
                    onResumeThread={(threadId) => void resumeThread(threadId)}
                    onDeleteThreads={confirmDeleteThreads}
                />
            ) : activeTab === "log" ? (
                <AgentLogView
                    logs={eventLogs}
                    theme={theme}
                    context={{ endpoint, connected, enabled, activity, waiting, sending, messages: messageCount, pendingTool: pendingTool?.name }}
                    onClear={clearEventLogs}
                    onCopied={(text) => message.success(text)}
                    onCopyBlocked={(text) => message.warning(text)}
                />
            ) : (
                <>
                    <AgentChatTimeline
                        theme={theme}
                        pendingTool={pendingTool}
                        pendingApprovals={pendingApprovals}
                        pendingClarifications={pendingClarifications}
                        sending={sending}
                        waiting={waiting}
                        editing={editing}
                        onRejectTool={rejectPendingTool}
                        onApproveTool={approvePendingTool}
                        onApprovalDecision={decideApproval}
                        onClarificationSubmit={submitClarification}
                        onClarificationCancel={cancelClarification}
                        onEditMessage={startEditMessage}
                    />
                    <AgentTaskProgress theme={theme} busy={sending || waiting} />
                    {tokenUsage ? <AgentUsageBar usage={tokenUsage} theme={theme} /> : null}
                    <AgentChatComposer
                        prompt={prompt}
                        attachments={attachments.map((attachment) => agentAttachmentToChatAttachment(attachment, endpoint, token))}
                        disabled={!connected || !conversationReady || loadingThreads}
                        sending={sending || waiting}
                        placeholder={conversation.status === "idle" || conversation.status === "preparing" ? t("agent.panel.mcpInitializing") : conversation.status === "failed" ? t("agent.panel.initFailed") : t("agent.panel.placeholder")}
                        theme={theme}
                        onPromptChange={(prompt) => setAgentState({ prompt })}
                        onSubmit={sendPrompt}
                        onStop={stopTurn}
                        onAddFiles={addAttachments}
                        onRemoveAttachment={removeAttachment}
                        confirmTools={confirmTools}
                        onConfirmToolsChange={(confirmTools) => setAgentState({ confirmTools })}
                        permissionMode={permissionMode}
                        onPermissionModeChange={changePermissionMode}
                        models={models}
                        model={model}
                        reasoningEffort={reasoningEffort}
                        onModelChange={(model) => {
                            const selected = models.find((item) => item.model === model);
                            if (!selected) return;
                            const effort = selected.defaultReasoningEffort || selected.supportedReasoningEfforts[0]?.reasoningEffort;
                            localStorage.setItem("canvas-agent-model", model);
                            if (effort) localStorage.setItem("canvas-agent-reasoning-effort", effort);
                            setAgentState({ model, ...(effort ? { reasoningEffort: effort } : {}) });
                        }}
                        onReasoningEffortChange={(reasoningEffort) => {
                            localStorage.setItem("canvas-agent-reasoning-effort", reasoningEffort);
                            setAgentState({ reasoningEffort });
                        }}
                        editing={editing}
                        onCancelEdit={cancelEditMessage}
                        left={
                            attachments.length ? (
                                <span className="hidden text-[11px] @min-[660px]:inline" style={{ color: theme.node.muted }}>
                                    {formatBytes(attachmentPayloadBytes(attachments))} / 30MB
                                </span>
                            ) : null
                        }
                    />
                </>
            )}
        </>
    );

    if (headless) return null;
    return embedded ? content : null;
}

function acquireAgentClientId() {
    const scope = globalThis as AgentClientGlobal;
    scope.__infiniteCanvasAgentClientIdPromise ||= (async () => {
        const storedClientId = readAgentClientId();
        let clientId = storedClientId || randomId();
        if (!navigator.locks) {
            if (!storedClientId) saveAgentClientId(clientId);
            return clientId;
        }
        while (true) {
            const acquired = await new Promise<boolean>((resolve, reject) => {
                void navigator.locks
                    .request(`infinite-canvas-agent:${clientId}`, { ifAvailable: true }, async (lock) => {
                        if (!lock) return resolve(false);
                        resolve(true);
                        await new Promise<void>(() => undefined);
                    })
                    .catch(reject);
            });
            if (acquired) {
                saveAgentClientId(clientId);
                return clientId;
            }
            clientId = randomId();
        }
    })().catch(() => {
        const clientId = randomId();
        saveAgentClientId(clientId);
        return clientId;
    });
    return scope.__infiniteCanvasAgentClientIdPromise;
}

function readAgentClientId() {
    try {
        return sessionStorage.getItem("canvas-agent-client-id") || "";
    } catch {
        return "";
    }
}

function readAgentProjectId() {
    try {
        return sessionStorage.getItem("canvas-agent-project-id") || "default";
    } catch {
        return "default";
    }
}

function saveAgentProjectId(projectId: string) {
    try {
        sessionStorage.setItem("canvas-agent-project-id", projectId);
    } catch {
        // The in-memory selection remains scoped to this browser page.
    }
}

function saveAgentClientId(clientId: string) {
    try {
        sessionStorage.setItem("canvas-agent-client-id", clientId);
    } catch {
        // The in-memory identity still keeps request ownership consistent within the current page session.
    }
}

function eventScope(event: AgentEventPayload) {
    return {
        threadId: event.threadId || event.thread_id || "",
        turnId: event.turnId || event.turn_id || "",
    };
}

function scopeEventChatItem(event: AgentEventPayload, item: AgentChatItem, itemId: string) {
    const scope = eventScope(event);
    return scopeChatItem({ ...item, itemId }, scope.threadId, scope.turnId);
}

function approvalActivity(pendingApprovals: AgentPendingApproval[], waiting: boolean, fallback: string) {
    if (pendingApprovals.length) return rt("awaitingApproval");
    return waiting ? rt("codexRunning") : fallback;
}

function clarificationActivity(pendingClarifications: AgentPendingClarification[], pendingApprovals: AgentPendingApproval[], waiting: boolean, fallback: string) {
    if (pendingClarifications.length) return rt("awaitingClarification");
    return approvalActivity(pendingApprovals, waiting, fallback);
}

async function attachmentNodeOps(endpoint: string, token: string, clientId: string, value: unknown): Promise<CanvasAgentOp[]> {
    const nodes = Array.isArray(value) ? value : [];
    if (!nodes.length) throw new Error(rt("noImageAttachments"));
    return await Promise.all(
        nodes.map(async (value) => {
            const item = value as { id?: unknown; attachmentId?: unknown; title?: unknown; position?: unknown };
            const id = String(item.id || "");
            const attachmentId = String(item.attachmentId || "");
            if (!id || !attachmentId) throw new Error(rt("invalidAttachmentNode"));
            const res = await fetch(`${endpoint}/agent/attachments/${encodeURIComponent(attachmentId)}?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`);
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { error?: string } | null;
                throw new Error(body?.error || rt("attachmentReadFailed"));
            }
            const image = await uploadImage(await res.blob());
            const size = fitNodeSize(image.width, image.height);
            const position = item.position && typeof item.position === "object" ? (item.position as { x?: unknown; y?: unknown }) : {};
            return {
                type: "add_node" as const,
                id,
                nodeType: "image" as const,
                title: String(item.title || rt("referenceImage")),
                position: { x: Number(position.x) || 0, y: Number(position.y) || 0 },
                width: size.width,
                height: size.height,
                metadata: imageMetadata(image),
            };
        }),
    );
}

function createId() {
    return randomId();
}

function createMessageAttachmentMetadata(item: AgentAttachment) {
    return { id: item.id, name: item.name, type: item.type, size: item.size, width: item.width, height: item.height, url: item.dataUrl };
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

async function importGeneratedImages(endpoint: string, token: string, item: AgentEventItem) {
    const sources = Array.from(generatedImageSources(item));
    return await Promise.all(
        sources.map(async (source, index) => {
            const response = source.startsWith("data:image/")
                ? await fetch(source)
                : await fetch(`${endpoint}/agent/local-image?token=${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: source }) });
            if (!response.ok) throw new Error(rt("generatedImageReadFailed"));
            const blob = await response.blob();
            const upload = await uploadImage(blob);
            const dataUrl = await readDataUrl(blob);
            const name = source.startsWith("/") ? source.split("/").at(-1) || rt("generatedImageName", { index: index + 1 }) : rt("generatedImageName", { index: index + 1 });
            return { upload, name, attachment: { id: createId(), name, type: blob.type || upload.mimeType, size: blob.size, width: upload.width, height: upload.height, url: upload.url, dataUrl } };
        }),
    );
}

function generatedImageSources(value: unknown, result = new Set<string>()) {
    if (typeof value === "string") {
        if (value.startsWith("data:image/") || (/^\/.+\.(?:avif|gif|jpe?g|png|webp)$/i.test(value) && !value.includes("\n"))) result.add(value);
        return result;
    }
    if (Array.isArray(value)) value.forEach((item) => generatedImageSources(item, result));
    else if (value && typeof value === "object") Object.values(value).forEach((item) => generatedImageSources(item, result));
    return result;
}

function readDataUrl(file: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error(rt("imageReadFailed")));
        reader.readAsDataURL(file);
    });
}

function delay(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
