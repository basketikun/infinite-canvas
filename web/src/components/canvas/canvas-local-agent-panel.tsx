import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { App, Button, Input, Segmented, Tooltip } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { Copy, FolderOpen, History, KeyRound, Link2, LoaderCircle, PlugZap, Plus, RefreshCw, RotateCcw, Terminal, Trash2 } from "lucide-react";
import { motion } from "motion/react";

import { useTranslation } from "@/components/layout/locale-provider";
import { canvasThemes } from "@/lib/canvas-theme";
import { translate, type TranslationKey } from "@/i18n";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasAgentStore, type AgentAttachment, type AgentChatItem, type AgentEventLog, type AgentPanelTab, type AgentPendingToolCall, type AgentThreadSummary } from "@/stores/canvas/use-canvas-agent-store";
import { summarizeCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { AgentChatComposer, AgentChatMessage, AgentPanelTabs, AgentPendingToolCard, AgentWorkingMessage, type CanvasAgentChatAttachment } from "./canvas-agent-chat-ui";

const PANEL_MOTION_SECONDS = 0.5;
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_PAYLOAD_BYTES = 28 * 1024 * 1024;
const DEFAULT_AGENT_URL = "http://127.0.0.1:17371";
const AGENT_CONNECT_COMMAND = "npx -y @basketikun/canvas-agent";

function getAgentConnectSteps() {
    return [
        { title: translate("canvas.agent.local.stepInstallTitle"), text: translate("canvas.agent.local.stepInstallText") },
        { title: translate("canvas.agent.local.stepOpenTitle"), text: translate("canvas.agent.local.stepOpenText") },
        { title: translate("canvas.agent.local.stepManualTitle"), text: translate("canvas.agent.local.stepManualText"), command: AGENT_CONNECT_COMMAND },
    ];
}

type AgentEventPayload = {
    agent?: string;
    type?: string;
    thread_id?: string;
    item?: AgentEventItem;
    error?: { message?: string };
    message?: string;
    usage?: Record<string, unknown>;
};
type AgentEventItem = { id?: string; type?: string; text?: unknown; message?: unknown; server?: string; tool?: string; status?: string; arguments?: unknown; result?: unknown; error?: { message?: string } };

type AgentLogContext = { endpoint: string; connected: boolean; enabled: boolean; activity: string; waiting: boolean; sending: boolean; messages: number; pendingTool?: string };
type AgentWorkspace = { canvasId: string; workspacePath: string; activeThreadId?: string };
type AgentThreadsResponse = { ok?: boolean; workspace?: AgentWorkspace; data?: AgentThreadSummary[] };
type AgentThreadResponse = { ok?: boolean; workspace?: AgentWorkspace; thread?: AgentThreadSummary; messages?: AgentChatItem[] };
type AgentConfigResponse = { ok?: boolean; url?: string; token?: string; hasToken?: boolean };

export function CanvasLocalAgentPanel({ snapshot, canUndoOps, collapsed, embedded, headless, autoConnect, onApplyOps, onUndoOps }: { snapshot: CanvasAgentSnapshot; canUndoOps: boolean; collapsed?: boolean; embedded?: boolean; headless?: boolean; autoConnect?: boolean; onApplyOps: (ops: CanvasAgentOp[]) => unknown; onUndoOps: () => CanvasAgentSnapshot | null }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const user = useUserStore((state) => state.user);
    const { message, modal } = App.useApp();
    const [searchParams] = useSearchParams();
    const { width, url, token, connected, enabled, prompt, attachments, sending, waiting, messages, eventLogs, threads, activeThreadId, workspacePath, loadingThreads, activeTab, confirmTools, activity, connectError, pendingTool, setAgentState, addMessage: pushMessage, addEventLog: pushEventLog, clearEventLogs } = useCanvasAgentStore();
    const [resizing, setResizing] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);
    const snapshotRef = useRef(snapshot);
    const confirmToolsRef = useRef(confirmTools);
    const pendingToolRef = useRef<AgentPendingToolCall | null>(null);
    const onApplyOpsRef = useRef(onApplyOps);
    const autoConnectRef = useRef(false);
    const connectedRef = useRef(false);
    const errorLoggedRef = useRef(false);
    const attachmentUrlsRef = useRef(new Set<string>());
    const clientIdRef = useRef(typeof crypto === "undefined" ? `${Date.now()}` : crypto.randomUUID());
    const endpoint = useMemo(() => url.trim().replace(/\/$/, ""), [url]);
    const urlAgentAutoConnect = searchParams.has("agentUrl") && searchParams.has("agentToken");
    const loadThreads = useCallback(async () => {
        const projectId = snapshotRef.current.projectId;
        if ((!connectedRef.current && !useCanvasAgentStore.getState().connected) || !projectId) return;
        setAgentState({ loadingThreads: true });
        try {
            const data = await fetchAgentJson<AgentThreadsResponse>(endpoint, token, `/agent/codex/threads?canvasId=${encodeURIComponent(projectId)}`);
            const current = useCanvasAgentStore.getState();
            setAgentState({
                threads: data.data || [],
                workspacePath: data.workspace?.workspacePath || current.workspacePath,
                activeThreadId: data.workspace?.activeThreadId || current.activeThreadId,
            });
            const nextThreadId = data.workspace?.activeThreadId || current.activeThreadId;
            if (nextThreadId && !current.messages.length) {
                const thread = await fetchAgentJson<AgentThreadResponse>(endpoint, token, `/agent/codex/threads/${encodeURIComponent(nextThreadId)}?canvasId=${encodeURIComponent(projectId)}`);
                setAgentState({ messages: normalizeHistoryMessages(thread.messages || []) });
            }
        } catch (error) {
            addEventLog(translate("canvas.agent.log.readHistoryFailed"), error);
        } finally {
            setAgentState({ loadingThreads: false });
        }
    }, [endpoint, setAgentState, token]);

    useEffect(() => {
        snapshotRef.current = snapshot;
    }, [snapshot]);
    useEffect(() => {
        confirmToolsRef.current = confirmTools;
    }, [confirmTools]);
    useEffect(() => {
        pendingToolRef.current = pendingTool;
    }, [pendingTool]);
    useEffect(() => {
        onApplyOpsRef.current = onApplyOps;
    }, [onApplyOps]);
    useEffect(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }, [messages, pendingTool, waiting]);
    useEffect(() => () => attachmentUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)), []);

    useEffect(() => {
        if (!enabled || !token.trim()) return;
        localStorage.setItem("canvas-agent-url", endpoint);
        localStorage.setItem("canvas-agent-token", token);
        const clientId = clientIdRef.current;
        const source = new EventSource(`${endpoint}/events?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`);
        source.addEventListener("hello", () => {
            errorLoggedRef.current = false;
            connectedRef.current = true;
            setAgentState({ connected: true, activity: translate("canvas.agent.local.connectedActivity"), connectError: "", messages: useCanvasAgentStore.getState().messages.filter((item) => !isConnectionErrorMessage(item)) });
            if (!headless) message.success(translate("canvas.agent.local.connected"));
            void postState(endpoint, token, clientId, snapshotRef.current);
        });
        source.addEventListener("tool_call", (event) => {
            const data = parseEventData<AgentPendingToolCall>(event);
            if (data) void handleToolCall(endpoint, token, data);
        });
        source.addEventListener("agent_event", (event) => {
            const data = parseEventData<AgentEventPayload>(event);
            if (data) handleAgentEvent(data);
        });
        source.addEventListener("agent_log", (event) => {
            const text = parseEventData<{ text?: unknown }>(event)?.text;
            addEventLog(translate("canvas.agent.log.logEntry"), text, text);
        });
        source.addEventListener("agent_error", (event) => {
            const message = parseEventData<{ message?: unknown }>(event)?.message;
            setAgentState({ activity: translate("canvas.agent.local.activityError"), waiting: false });
            addMessage({ role: "error", title: translate("canvas.agent.local.error"), text: normalizeText(message) });
            addEventLog(translate("canvas.agent.local.error"), message, message);
        });
        source.addEventListener("agent_done", () => {
            setAgentState({ activity: translate("canvas.agent.local.activityDone"), waiting: false, sending: false });
            void loadThreads();
        });
        source.onerror = () => {
            const wasConnected = connectedRef.current;
            const text = wasConnected ? translate("canvas.agent.local.disconnected") : translate("canvas.agent.local.connectCheckToken");
            if (!errorLoggedRef.current || wasConnected) {
                addEventLog(wasConnected ? translate("canvas.agent.log.disconnect") : translate("canvas.agent.log.connectFailed"), { endpoint, error: text });
                if (!headless) message.error(text);
            }
            errorLoggedRef.current = true;
            connectedRef.current = false;
            clearAgentSession({ activity: wasConnected ? translate("canvas.agent.log.disconnect") : translate("canvas.agent.log.connectFailed"), connected: false, connectError: text });
            if (!wasConnected) {
                source.close();
                setAgentState({ enabled: false });
            }
        };
        return () => {
            source.close();
            connectedRef.current = false;
            setAgentState({ connected: false });
        };
    }, [enabled, endpoint, loadThreads, message, setAgentState, token]);

    useEffect(() => {
        if (connected) void loadThreads();
    }, [connected, loadThreads, snapshot.projectId]);

    useEffect(() => {
        if (!connected) return;
        const timer = setTimeout(() => void postState(endpoint, token, clientIdRef.current, snapshot), 300);
        return () => clearTimeout(timer);
    }, [connected, endpoint, snapshot, token]);

    const sendPrompt = async () => {
        const text = prompt.trim();
        const files = attachments;
        const requestPrompt = promptWithAttachments(text, files);
        if (!connected || !requestPrompt || sending || waiting) return;
        if (attachmentPayloadBytes(files) > MAX_ATTACHMENT_PAYLOAD_BYTES) {
            addMessage({ role: "error", title: translate("canvas.agent.local.imageTooLarge"), text: translate("canvas.agent.local.imageTooLargeSend") });
            return;
        }
        setAgentState({ activity: translate("canvas.agent.local.activitySending"), sending: true, waiting: true });
        addMessage({ role: "user", text: text || translate("canvas.agent.chat.sentImages"), attachments: files });
        addEventLog(translate("canvas.agent.log.userSent"), { text, attachments: files.map(({ name, type, size }) => ({ name, type, size })) });
        try {
            const res = await fetch(`${endpoint}/agent/codex/turn?token=${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: requestPrompt, canvasId: snapshotRef.current.projectId, threadId: useCanvasAgentStore.getState().activeThreadId || undefined, attachments: files.map(({ name, type, dataUrl }) => ({ name, type, dataUrl })) }) });
            if (!res.ok) throw new Error(translate("canvas.agent.local.requestRejected"));
            const data = (await res.json()) as { threadId?: string };
            if (data.threadId) setAgentState({ activeThreadId: data.threadId });
            addEventLog(translate("canvas.agent.log.agentReceived"), { status: res.status });
            files.forEach((item) => {
                URL.revokeObjectURL(item.url);
                attachmentUrlsRef.current.delete(item.url);
            });
            setAgentState({ prompt: "", attachments: [] });
        } catch (error) {
            setAgentState({ activity: translate("canvas.agent.local.activitySendFailed"), waiting: false });
            addMessage({ role: "error", title: translate("canvas.agent.local.sendFailed"), text: error instanceof Error ? error.message : translate("canvas.agent.local.sendFailed") });
            addEventLog(translate("canvas.agent.local.activitySendFailed"), error);
        } finally {
            setAgentState({ sending: false });
        }
    };

    const addAttachments = async (files: FileList | File[] | null) => {
        if (!files) return;
        const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
        const prev = useCanvasAgentStore.getState().attachments;
        try {
            const next = await Promise.all(images.slice(0, Math.max(0, MAX_ATTACHMENTS - prev.length)).map(async (file) => {
                const dataUrl = await readDataUrl(file);
                const url = URL.createObjectURL(file);
                attachmentUrlsRef.current.add(url);
                return { id: createId(), name: file.name, type: file.type, size: file.size, url, dataUrl };
            }));
            const merged = [...prev, ...next];
            if (attachmentPayloadBytes(merged) > MAX_ATTACHMENT_PAYLOAD_BYTES) {
                next.forEach((item) => {
                    URL.revokeObjectURL(item.url);
                    attachmentUrlsRef.current.delete(item.url);
                });
                addMessage({ role: "error", title: translate("canvas.agent.local.imageTooLarge"), text: translate("canvas.agent.local.imageTooLargeMax") });
                return;
            }
            if (next.length) setAgentState({ attachments: merged });
        } catch (error) {
            addMessage({ role: "error", title: translate("canvas.agent.local.imageReadFailed"), text: error instanceof Error ? error.message : translate("canvas.agent.local.imageReadFailed") });
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
        if (confirmToolsRef.current && payload.name === "canvas_apply_ops") {
            if (pendingToolRef.current) {
                await postToolResult(endpoint, token, clientIdRef.current, { requestId: payload.requestId, error: translate("canvas.agent.local.pendingToolExists") });
                return;
            }
            pendingToolRef.current = payload;
            setAgentState({ pendingTool: payload, activity: translate("canvas.agent.local.waitingConfirm"), waiting: false });
            addEventLog(translate("canvas.agent.log.waitConfirm"), payload, payload);
            return;
        }
        await runToolCall(endpoint, token, payload);
    };

    const runToolCall = async (endpoint: string, token: string, payload: AgentPendingToolCall) => {
        try {
            const input: { ops?: CanvasAgentOp[] } = payload.input || {};
            setAgentState({ activity: payload.name === "canvas_apply_ops" ? translate("canvas.agent.local.executingCanvasOps") : translate("canvas.agent.local.readingCanvas"), waiting: true });
            addEventLog(toolName(payload.name), payload, payload);
            const result = payload.name === "canvas_apply_ops" ? onApplyOpsRef.current(input.ops || []) : snapshotRef.current;
            await postToolResult(endpoint, token, clientIdRef.current, { requestId: payload.requestId, result });
            if (payload.name === "canvas_apply_ops") void postState(endpoint, token, clientIdRef.current, result as CanvasAgentSnapshot);
            setAgentState({ activity: translate("canvas.agent.local.toolDone"), waiting: true });
            addEventLog(`${toolName(payload.name)}${translate("canvas.agent.local.toolCompleteSuffix")}`, result, result);
            addMessage({ role: "tool", title: `${toolName(payload.name)}${translate("canvas.agent.local.toolCompleteSuffix")}`, text: payload.name === "canvas_apply_ops" ? summarizeCanvasAgentOps(input.ops || []) || translate("canvas.agent.local.canvasOps") : translate("canvas.agent.local.completed"), detail: { requestId: payload.requestId, name: payload.name, input, result } });
        } catch (error) {
            const message = error instanceof Error ? error.message : translate("canvas.agent.local.canvasOpsFailed");
            setAgentState({ activity: translate("canvas.agent.local.toolFailed"), waiting: false });
            addMessage({ role: "tool", title: translate("canvas.agent.local.toolFailed"), text: message, detail: payload });
            await postToolResult(endpoint, token, clientIdRef.current, { requestId: payload.requestId, error: message });
        }
    };

    const rejectPendingTool = async () => {
        if (!pendingTool) return;
        await postToolResult(endpoint, token, clientIdRef.current, { requestId: pendingTool.requestId, error: translate("canvas.agent.local.userCancelled") });
        setAgentState({ activity: translate("canvas.agent.local.cancelled"), waiting: false });
        addMessage({ role: "tool", title: translate("canvas.agent.toolCard.reject"), text: toolName(pendingTool.name), detail: { requestId: pendingTool.requestId, name: pendingTool.name, input: pendingTool.input } });
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

    const undoLastTool = () => {
        const restored = onUndoOps();
        if (!restored) return;
        setAgentState({ activity: translate("canvas.agent.local.undone") });
        addMessage({ role: "tool", title: translate("canvas.agent.local.undone"), text: translate("canvas.agent.local.lastToolOp"), detail: restored });
        if (connected) void postState(endpoint, token, clientIdRef.current, restored);
    };

    const toggleAgentConnection = async () => {
        if (enabled) {
            clearAgentSession({ enabled: false, connected: false, activity: translate("canvas.agent.local.offline"), connectError: "" });
            return;
        }
        const urlToken = searchParams.get("agentToken") || "";
        const urlEndpoint = searchParams.get("agentUrl") || "";
        const discovered = urlToken ? null : await discoverAgentConfig(endpoint || DEFAULT_AGENT_URL);
        const nextEndpoint = (urlEndpoint || discovered?.url || endpoint || DEFAULT_AGENT_URL).trim().replace(/\/$/, "");
        const nextToken = (urlToken || token.trim() || discovered?.token || "").trim();
        if (!nextEndpoint) {
            const text = translate("canvas.agent.local.urlRequired");
            setAgentState({ connectError: text });
            if (!headless) message.warning(text);
            return;
        }
        if (!nextToken) {
            const text = translate("canvas.agent.local.agentNotFound");
            setAgentState({ connectError: text });
            if (!headless) message.warning(text);
            return;
        }
        try {
            const parsed = new URL(nextEndpoint);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("invalid protocol");
        } catch {
            const text = translate("canvas.agent.local.invalidUrl");
            setAgentState({ connectError: text });
            if (!headless) message.warning(text);
            return;
        }
        errorLoggedRef.current = false;
        setAgentState({ url: nextEndpoint, token: nextToken, enabled: true, connected: false, activity: translate("canvas.agent.local.statusConnecting"), connectError: "", activeTab: "setup" });
    };

    useEffect(() => {
        if (urlAgentAutoConnect && confirmTools) setAgentState({ confirmTools: false });
    }, [confirmTools, setAgentState, urlAgentAutoConnect]);

    useEffect(() => {
        if (!autoConnect || autoConnectRef.current || enabled || connected) return;
        autoConnectRef.current = true;
        void toggleAgentConnection();
    }, [autoConnect, connected, enabled]);

    function clearAgentSession(patch: Parameters<typeof setAgentState>[0] = {}) {
        setAgentState({
            messages: [],
            threads: [],
            activeThreadId: "",
            workspacePath: "",
            loadingThreads: false,
            waiting: false,
            sending: false,
            pendingTool: null,
            ...patch,
        });
        pendingToolRef.current = null;
    }

    const startNewThread = async () => {
        const projectId = snapshotRef.current.projectId;
        if (!connected || !projectId) return;
        setAgentState({ loadingThreads: true });
        try {
            const data = await fetchAgentJson<AgentThreadResponse>(endpoint, token, "/agent/codex/threads/new", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ canvasId: projectId }) });
            setAgentState({ activeThreadId: data.thread?.id || data.workspace?.activeThreadId || "", messages: [], activeTab: "chat", activity: translate("canvas.agent.local.activityNewChat") });
            await loadThreads();
        } catch (error) {
            addEventLog(translate("canvas.agent.log.newThreadFailed"), error);
            message.error(error instanceof Error ? error.message : translate("canvas.agent.local.newThreadFailed"));
        } finally {
            setAgentState({ loadingThreads: false });
        }
    };

    const resumeThread = async (threadId: string) => {
        const projectId = snapshotRef.current.projectId;
        if (!connected || !projectId || !threadId) return;
        setAgentState({ loadingThreads: true });
        try {
            const data = await fetchAgentJson<AgentThreadResponse>(endpoint, token, `/agent/codex/threads/${encodeURIComponent(threadId)}/resume`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ canvasId: projectId }) });
            setAgentState({ activeThreadId: data.thread?.id || threadId, messages: normalizeHistoryMessages(data.messages || []), activeTab: "chat", activity: translate("canvas.agent.local.activityResumed") });
            await loadThreads();
        } catch (error) {
            addEventLog(translate("canvas.agent.log.resumeThreadFailed"), error);
            message.error(error instanceof Error ? error.message : translate("canvas.agent.local.resumeThreadFailed"));
        } finally {
            setAgentState({ loadingThreads: false });
        }
    };

    const deleteThread = async (threadId: string) => {
        const projectId = snapshotRef.current.projectId;
        if (!connected || !projectId || !threadId) return;
        setAgentState({ loadingThreads: true });
        try {
            await fetchAgentJson(endpoint, token, `/agent/codex/threads/${encodeURIComponent(threadId)}/delete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ canvasId: projectId }) });
            const current = useCanvasAgentStore.getState();
            setAgentState({
                threads: current.threads.filter((thread) => thread.id !== threadId),
                activeThreadId: current.activeThreadId === threadId ? "" : current.activeThreadId,
                messages: current.activeThreadId === threadId ? [] : current.messages,
            });
            message.success(translate("canvas.agent.local.recordDeleted"));
        } catch (error) {
            addEventLog(translate("canvas.agent.log.deleteThreadFailed"), error);
            message.error(error instanceof Error ? error.message : translate("canvas.agent.local.deleteThreadFailed"));
        } finally {
            setAgentState({ loadingThreads: false });
        }
    };

    const confirmDeleteThread = (thread: AgentThreadSummary) => {
        const label = thread.name || thread.preview || translate("canvas.agent.history.untitledChat");
        modal.confirm({
            title: translate("canvas.dialogs.deleteThread.title"),
            content: translate("canvas.dialogs.deleteThread.content", { label: label.length > 48 ? `${label.slice(0, 48)}...` : label }),
            okText: translate("common.delete"),
            okType: "danger",
            cancelText: translate("common.cancel"),
            onOk: () => deleteThread(thread.id),
        });
    };

    const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        let nextWidth = startWidth;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = clamp(startWidth + startX - moveEvent.clientX, 360, 760);
            setAgentState({ width: nextWidth });
        };
        const onUp = () => {
            localStorage.setItem("canvas-agent-panel-width", String(nextWidth));
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    const addMessage = (item: Omit<AgentChatItem, "id">) => {
        const text = normalizeText(item.text);
        if (!text && !item.attachments?.length) return;
        const next = { ...item, id: `${Date.now()}-${Math.random()}`, text };
        const currentMessages = useCanvasAgentStore.getState().messages;
        if (next.streamId) {
            const index = currentMessages.findIndex((message) => message.streamId === next.streamId);
            if (index >= 0) {
                setAgentState({ messages: currentMessages.map((message, i) => i === index ? { ...message, ...next, id: message.id, text: next.text || message.text } : message) });
                return;
            }
        }
        const last = currentMessages.at(-1);
        if (last?.role === "assistant" && next.role === "assistant" && last.title === next.title) {
            const merged = mergeAgentText(last.text, next.text);
            if (merged === last.text) return;
            setAgentState({ messages: [...useCanvasAgentStore.getState().messages.slice(0, -1), { ...last, text: merged, meta: next.meta || last.meta }] });
            return;
        }
        pushMessage(next);
    };

    const addEventLog = (title: string, text: unknown, raw?: unknown) => {
        pushEventLog({ id: `${Date.now()}-${Math.random()}`, time: new Date().toLocaleTimeString(), title, text: normalizeText(text) || title, raw });
    };

    const handleAgentEvent = (event: AgentEventPayload) => {
        if (shouldLogAgentEvent(event)) addEventLog(eventTitle(event), event, event);
        if (event.type === "thread.started" && event.thread_id) setAgentState({ activeThreadId: event.thread_id });
        const nextActivity = activityText(event);
        if (nextActivity) setAgentState({ activity: nextActivity });
        if (event.type === "turn.started") setAgentState({ waiting: true });
        if (event.type === "turn.completed" || event.type === "turn.failed" || event.type === "error") setAgentState({ waiting: false, sending: false });
        const item = formatAgentEvent(event);
        if (item) {
            if (item.role === "error") setAgentState({ waiting: false, sending: false });
            addMessage(item);
        }
    };

    const content = (
        <>
            <AgentPanelTabs
                value={activeTab}
                theme={theme}
                items={[
                    { value: "setup", label: t("canvas.agent.tabs.connect"), icon: <PlugZap className="size-3.5" /> },
                    { value: "chat", label: t("canvas.agent.tabs.chat") },
                    { value: "history", label: t("canvas.agent.tabs.history"), icon: <History className="size-3.5" />, count: threads.length },
                    { value: "log", label: t("canvas.agent.tabs.log"), icon: <Terminal className="size-3.5" />, count: eventLogs.length },
                ]}
                onChange={(activeTab) => {
                    setAgentState({ activeTab });
                    if (activeTab === "history") void loadThreads();
                }}
                right={
                    <>
                        <Button size="small" type="text" disabled={!canUndoOps} icon={<RotateCcw className="size-3.5" />} onClick={undoLastTool}>
                            {t("common.undo")}
                        </Button>
                    </>
                }
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
            ) : activeTab === "history" ? (
                <AgentHistoryView
                    theme={theme}
                    threads={threads}
                    activeThreadId={activeThreadId}
                    workspacePath={workspacePath}
                    loading={loadingThreads}
                    connected={connected}
                    onRefresh={() => void loadThreads()}
                    onNewThread={() => void startNewThread()}
                    onResumeThread={(threadId) => void resumeThread(threadId)}
                    onDeleteThread={confirmDeleteThread}
                />
            ) : activeTab === "log" ? (
                <AgentLogView
                    logs={eventLogs}
                    theme={theme}
                    context={{ endpoint, connected, enabled, activity, waiting, sending, messages: messages.length, pendingTool: pendingTool?.name }}
                    onClear={clearEventLogs}
                    onCopied={(text) => message.success(text)}
                    onCopyBlocked={(text) => message.warning(text)}
                />
            ) : (
                <>
                    <div ref={listRef} className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                        {messages.map((item) => (
                            <AgentChatMessage key={item.id} item={agentMessageToChatMessage(item)} theme={theme} user={user} />
                        ))}
                        {pendingTool ? <AgentPendingToolCard summary={summarizeCanvasAgentOps(pendingTool.input?.ops || []) || toolName(pendingTool.name)} detail={{ requestId: pendingTool.requestId, name: pendingTool.name, input: pendingTool.input }} theme={theme} onReject={rejectPendingTool} onApprove={approvePendingTool} /> : null}
                        {waiting && !pendingTool ? <AgentWorkingMessage theme={theme} /> : null}
                    </div>
                    <AgentChatComposer
                        prompt={prompt}
                        attachments={attachments.map(agentAttachmentToChatAttachment)}
                        disabled={!connected}
                        sending={sending || waiting}
                        placeholder={t("canvas.agent.chat.placeholderLocal")}
                        theme={theme}
                        onPromptChange={(prompt) => setAgentState({ prompt })}
                        onSubmit={sendPrompt}
                        onAddFiles={addAttachments}
                        onRemoveAttachment={removeAttachment}
                        left={attachments.length ? <span className="text-[11px]" style={{ color: theme.node.muted }}>{t("canvas.agent.chat.attachmentLimit", { size: formatBytes(attachmentPayloadBytes(attachments)) })}</span> : null}
                    />
                </>
            )}
        </>
    );

    if (headless) return null;
    if (embedded) return content;

    return (
        <motion.div
            className="relative z-[70] flex h-full shrink-0"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: collapsed ? 0 : width + 1, opacity: collapsed ? 0 : 1 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "clip", pointerEvents: collapsed ? "none" : undefined }}
        >
            <motion.aside
                className="relative flex h-full shrink-0 flex-col border-l"
                initial={{ x: 48 }}
                animate={{ x: collapsed ? 28 : 0 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
                style={{ width, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            >
                <div className="absolute left-0 top-0 h-full w-1 cursor-col-resize transition hover:bg-current/20" onPointerDown={startResize} />
                {content}
            </motion.aside>
        </motion.div>
    );
}

function AgentLogView({ logs, theme, context, onClear, onCopied, onCopyBlocked }: { logs: AgentEventLog[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; context: AgentLogContext; onClear: () => void; onCopied: (text: string) => void; onCopyBlocked: (text: string) => void }) {
    const { t } = useTranslation();
    const [mode, setMode] = useState<"text" | "json">("text");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const content = mode === "text" ? formatLogText(logs, context) : formatLogJson(logs, context);
    const lastError = [...logs].reverse().find((item) => /错误|失败|error|failed/i.test(`${item.title}\n${item.text}`));
    const copy = async (value = content, tip = t("canvas.agent.log.copied")) => {
        if (await copyToClipboard(value)) {
            onCopied(tip);
            return;
        }
        textareaRef.current?.focus();
        textareaRef.current?.select();
        onCopyBlocked(t("canvas.agent.log.selectToCopy"));
    };
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="flex min-h-full flex-col gap-3">
                <div>
                    <div className="text-base font-semibold leading-6">{t("canvas.agent.log.title")}</div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Segmented size="small" value={mode} onChange={(value) => setMode(value as "text" | "json")} options={[{ label: t("canvas.agent.log.debugLog"), value: "text" }, { label: t("canvas.agent.log.rawJson"), value: "json" }]} />
                    <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: theme.node.muted }}>{t("canvas.agent.log.count", { count: logs.length })}</span>
                        <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void copy()}>{t("canvas.agent.log.copy")}</Button>
                        <Button size="small" disabled={!lastError} onClick={() => lastError && void copy(formatLogText([lastError], context), t("canvas.agent.log.recentErrorCopied"))}>{t("canvas.agent.log.recentError")}</Button>
                        <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} disabled={!logs.length} onClick={onClear}>{t("canvas.agent.log.clear")}</Button>
                    </div>
                </div>
                <textarea
                    ref={textareaRef}
                    readOnly
                    value={content}
                    className="thin-scrollbar min-h-[360px] flex-1 resize-none rounded-lg border bg-transparent p-3 font-mono text-xs leading-5 outline-none"
                    style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                    onFocus={(event) => event.currentTarget.select()}
                />
            </div>
        </div>
    );
}

function AgentConnectView({ theme, url, token, enabled, connected, activity, connectError, onUrlChange, onTokenChange, onToggleEnabled }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; url: string; token: string; enabled: boolean; connected: boolean; activity: string; connectError: string; onUrlChange: (value: string) => void; onTokenChange: (value: string) => void; onToggleEnabled: () => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const statusText = connectError ? t("canvas.agent.local.statusConnectFailed") : connected ? activity : enabled ? t("canvas.agent.local.statusConnecting") : t("canvas.agent.local.statusNotConnected");
    const statusColor = connectError ? "#dc2626" : connected ? "#16a34a" : enabled ? "#d97706" : theme.node.muted;
    const copyCommand = (command: string) => {
        copyToClipboard(command);
        message.success(t("canvas.agent.local.commandCopied"));
    };
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
                <div>
                    <div className="text-base font-semibold leading-6">{t("canvas.agent.local.connectTitle")}</div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t("canvas.agent.local.connectDesc")}
                    </div>
                </div>
                <div className="space-y-2">
                    {getAgentConnectSteps().map((step) => {
                        const command = "command" in step ? step.command : "";
                        return (
                            <div key={step.title} className="rounded-lg px-3 py-2.5">
                                <div className="text-sm font-medium leading-5">{step.title}</div>
                                <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>{step.text}</div>
                                {command ? (
                                    <div className="mt-2 flex items-center gap-2 rounded-md border bg-transparent px-2 py-1.5" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                                        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[11px] leading-5">{command}</code>
                                        <Tooltip title={t("canvas.agent.local.copyCommand")}>
                                            <Button size="small" type="text" className="!h-6 !w-6 !min-w-6" icon={<Copy className="size-3.5" />} onClick={() => copyCommand(command)} />
                                        </Tooltip>
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
                <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="shrink-0 text-sm font-medium leading-5">{t("canvas.agent.local.webConnect")}</span>
                                <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4" style={{ borderColor: connected || enabled || connectError ? statusColor : theme.node.stroke, color: statusColor }}>
                                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: statusColor }} />
                                    <span className="truncate">{statusText}</span>
                                </span>
                            </div>
                            <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                {t("canvas.agent.local.webConnectDesc")}
                            </div>
                        </div>
                        <Button className="!h-8 !px-3" type={enabled ? "default" : "primary"} icon={<PlugZap className="size-4" />} onClick={onToggleEnabled}>
                            {enabled ? t("common.disconnect") : t("common.connect")}
                        </Button>
                    </div>
                    <div className="mt-3 grid gap-2.5">
                        <label className="grid gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                <Link2 className="size-3.5" />
                                {t("canvas.agent.local.localUrl")}
                                <span className="font-normal opacity-70">Local URL</span>
                            </span>
                            <Input size="large" prefix={<Link2 className="mr-1 size-4" style={{ color: theme.node.faint }} />} value={url} onChange={(event) => onUrlChange(event.target.value)} placeholder={t("canvas.agent.local.urlPlaceholder")} />
                        </label>
                        <label className="grid gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                <KeyRound className="size-3.5" />
                                {t("canvas.agent.local.connectToken")}
                                <span className="font-normal opacity-70">Connect token</span>
                            </span>
                            <Input.Password size="large" prefix={<KeyRound className="mr-1 size-4" style={{ color: theme.node.faint }} />} value={token} onChange={(event) => onTokenChange(event.target.value)} placeholder={t("canvas.agent.local.tokenPlaceholder")} />
                        </label>
                        {connectError ? (
                            <div className="rounded-md border px-2.5 py-2 text-xs leading-5" style={{ borderColor: "rgba(220,38,38,.35)", color: "#dc2626" }}>
                                {connectError}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}

function AgentHistoryView({ theme, threads, activeThreadId, workspacePath, loading, connected, onRefresh, onNewThread, onResumeThread, onDeleteThread }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; threads: AgentThreadSummary[]; activeThreadId: string; workspacePath: string; loading: boolean; connected: boolean; onRefresh: () => void; onNewThread: () => void; onResumeThread: (threadId: string) => void; onDeleteThread: (thread: AgentThreadSummary) => void }) {
    const { t } = useTranslation();
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
            <div className="space-y-3">
                <div className="flex min-w-0 items-center gap-2 text-xs" style={{ color: theme.node.muted }}>
                    <FolderOpen className="size-3.5 shrink-0" />
                    <span className="shrink-0">{t("canvas.agent.history.workspace")}</span>
                    <span className="min-w-0 truncate" title={workspacePath}>{workspacePath || t("canvas.agent.history.defaultWorkspace")}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm" style={{ color: theme.node.muted }}>
                        {threads.length ? t("canvas.agent.history.count", { count: threads.length }) : connected ? t("canvas.agent.history.empty") : t("canvas.agent.history.notConnected")}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button size="small" icon={<RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />} disabled={!connected || loading} onClick={onRefresh}>
                            {t("common.refresh")}
                        </Button>
                        <Button size="small" type="primary" icon={<Plus className="size-3.5" />} disabled={!connected || loading} onClick={onNewThread}>
                            {t("canvas.agent.history.newThread")}
                        </Button>
                    </div>
                </div>
                <div className="space-y-2">
                    {threads.map((thread) => {
                        const active = thread.id === activeThreadId;
                        return (
                            <div key={thread.id} className="rounded-lg border px-2.5 py-1.5 transition" style={{ borderColor: active ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}>
                                <div className="flex items-center gap-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            {active ? <span className="shrink-0 text-[10px] font-medium" style={{ color: theme.node.text }}>{t("canvas.agent.history.current")}</span> : null}
                                            <div className="truncate text-sm font-medium leading-5">{thread.name || thread.preview || t("canvas.agent.history.untitledChat")}</div>
                                        </div>
                                        <div className="truncate text-[11px] leading-4 opacity-65">{thread.preview || thread.id}</div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <span className="text-[10px] opacity-55">{formatThreadTime(thread.updatedAt || thread.createdAt)}</span>
                                        <Button size="small" className="!h-6 !px-2" disabled={loading} onClick={() => onResumeThread(thread.id)}>
                                            {t("canvas.agent.history.enter")}
                                        </Button>
                                        <Tooltip title={t("canvas.agent.history.deleteRecord")}>
                                            <Button size="small" danger type="text" className="!h-6 !w-6 !min-w-6" disabled={loading} icon={<Trash2 className="size-3.5" />} onClick={() => onDeleteThread(thread)} />
                                        </Tooltip>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {!threads.length ? (
                        <div className="px-3 py-8 text-center text-sm" style={{ color: theme.node.muted }}>
                            {connected ? t("canvas.agent.history.localEmpty") : t("canvas.agent.history.localNotConnected")}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

async function postState(endpoint: string, token: string, clientId: string, snapshot: CanvasAgentSnapshot) {
    try {
        await fetch(`${endpoint}/canvas/state?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(snapshot) });
    } catch {}
}

async function postToolResult(endpoint: string, token: string, clientId: string, body: { requestId: string; result?: unknown; error?: string }) {
    await fetch(`${endpoint}/canvas/result?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function agentMessageToChatMessage(item: AgentChatItem) {
    return { ...item, attachments: item.attachments?.map(agentAttachmentToChatAttachment) };
}

function agentAttachmentToChatAttachment(item: AgentAttachment): CanvasAgentChatAttachment {
    return { id: item.id, name: item.name, url: item.dataUrl || item.url };
}

function formatAgentEvent(event: AgentEventPayload): Omit<AgentChatItem, "id"> | null {
    const item = event.item;
    if (event.type === "item.completed" && item?.type === "error") return { role: "error", title: translate("canvas.agent.local.error"), text: normalizeText(item.message), detail: item };
    if ((event.type === "item.updated" || event.type === "item.completed") && item?.type === "agent_message") return { role: "assistant", title: translate("canvas.agent.chat.codexTitle"), text: stringText(item.text), meta: usageText(event), streamId: item.id };
    if (event.type === "item.completed" && isMcpToolItem(item) && isReadTool(String(item?.tool || ""))) return { role: "tool", title: `${toolName(String(item?.tool || ""))}${translate("canvas.agent.local.toolCompleteSuffix")}`, text: item?.error?.message || toolSummary(item), detail: toolDetail(item) };
    const text = eventText(event);
    if (text) return { role: "assistant", title: translate("canvas.agent.chat.codexTitle"), text, meta: usageText(event) };
    return null;
}

function parseEventData<T>(event: Event) {
    try {
        return JSON.parse((event as MessageEvent).data) as T;
    } catch {
        return null;
    }
}

function formatLogText(logs: AgentEventLog[], context: AgentLogContext) {
    const head = [
        translate("canvas.agent.local.diagnosticLog"),
        `Canvas Agent: ${context.endpoint}`,
        `${translate("common.connect")}: ${context.connected ? translate("canvas.agent.local.connectionOnline") : context.enabled ? translate("canvas.agent.local.connectionConnecting") : translate("canvas.agent.local.connectionDisabled")}`,
        `${translate("canvas.agent.local.statusLabel")}: ${context.activity}`,
        `waiting: ${context.waiting}`,
        `sending: ${context.sending}`,
        `messages: ${context.messages}`,
        `pendingTool: ${context.pendingTool ? toolName(context.pendingTool) : "none"}`,
        `logs: ${logs.length}`,
    ].join("\n");
    const body = logs.map((item, index) => {
        const detail = item.raw == null ? item.text : JSON.stringify(item.raw, null, 2);
        return [`#${index + 1} ${item.time} ${item.title}`, detail].filter(Boolean).join("\n");
    }).join("\n\n---\n\n");
    return [head, body || translate("canvas.agent.log.noEvents")].join("\n\n");
}

function formatLogJson(logs: AgentEventLog[], context: AgentLogContext) {
    return JSON.stringify({ context, logs: logs.map(({ time, title, text, raw }) => ({ time, title, text, raw })) }, null, 2);
}

function eventText(event: AgentEventPayload) {
    return event.type === "item.completed" && event.item?.type === "agent_message" ? stringText(event.item.text) : "";
}

function usageText(event: AgentEventPayload) {
    const usage = event.usage;
    if (!usage || typeof usage !== "object") return undefined;
    const total = numberField(usage, "total_tokens");
    const input = numberField(usage, "input_tokens");
    const output = numberField(usage, "output_tokens");
    if (total) return `${total} tok`;
    if (input || output) return `${input || 0}/${output || 0} tok`;
    return undefined;
}

function activityText(event: AgentEventPayload) {
    const name = event.type || "";
    if (name === "thread.started") return translate("canvas.agent.local.events.sessionCreated");
    if (name === "turn.started") return translate("canvas.agent.local.events.thinking");
    if (name === "turn.completed") return translate("canvas.agent.local.events.done");
    if (name === "turn.failed" || name === "error") return translate("canvas.agent.local.events.error");
    if (name === "item.started") return isMcpToolItem(event.item) ? translate("canvas.agent.local.events.invokeToolShort", { tool: toolName(String(event.item?.tool || "")) }) : translate("canvas.agent.local.events.executeStep");
    if (name === "item.completed") return isMcpToolItem(event.item) ? translate("canvas.agent.local.events.toolDoneShort") : translate("canvas.agent.local.events.updateMessage");
    return "";
}

function eventTitle(event: AgentEventPayload) {
    const item = event.item;
    if (event.type === "thread.started") return translate("canvas.agent.local.events.threadCreated");
    if (event.type === "turn.started") return translate("canvas.agent.local.events.turnStarted");
    if (event.type === "turn.completed") return translate("canvas.agent.local.events.turnCompleted");
    if (event.type === "stream.summary") return translate("canvas.agent.local.events.streamSummary");
    if (event.type === "turn.failed" || event.type === "error") return translate("canvas.agent.local.events.turnFailed");
    if (event.type === "item.started" && isMcpToolItem(item)) return translate("canvas.agent.local.events.invokeTool", { tool: toolName(String(item?.tool || "")) });
    if (event.type === "item.completed" && isMcpToolItem(item)) return translate("canvas.agent.local.events.toolCompleted", { tool: toolName(String(item?.tool || "")) });
    if (event.type === "item.completed" && item?.type === "agent_message") return translate("canvas.agent.local.events.codexReply");
    return event.type || translate("canvas.agent.local.events.codexEvent");
}

function shouldLogAgentEvent(event: AgentEventPayload) {
    const itemType = event.item?.type || "";
    return !["item.updated"].includes(event.type || "") && !["reasoning"].includes(itemType) && !(event.type === "item.started" && itemType === "agent_message");
}

function isConnectionErrorMessage(item: AgentChatItem) {
    return item.role === "error" && /连接失败|无法连接本地 Agent|本地 Agent 连接失败|Connection failed|disconnected/i.test(item.text);
}

const TOOL_NAME_KEYS: Record<string, TranslationKey> = {
    canvas_apply_ops: "canvas.agent.online.tools.canvasOps",
    canvas_get_state: "canvas.agent.online.tools.readCanvas",
    canvas_get_selection: "canvas.agent.online.tools.readSelection",
    canvas_export_snapshot: "canvas.agent.online.tools.exportSnapshot",
    canvas_create_node: "canvas.agent.online.tools.createNode",
    canvas_create_text_node: "canvas.agent.online.tools.createText",
    canvas_create_text_nodes: "canvas.agent.online.tools.createTextBatch",
    canvas_create_config_node: "canvas.agent.online.tools.createConfig",
    canvas_create_image_prompt_flow: "canvas.agent.online.tools.createImageFlow",
    canvas_create_generation_flow: "canvas.agent.online.tools.createGenerationFlow",
    canvas_generate_text: "canvas.agent.online.tools.generateText",
    canvas_generate_image: "canvas.agent.online.tools.generateImage",
    canvas_generate_video: "canvas.agent.online.tools.generateVideo",
    canvas_generate_audio: "canvas.agent.online.tools.generateAudio",
    canvas_update_node: "canvas.agent.online.tools.updateNode",
    canvas_update_node_text: "canvas.agent.online.tools.updateText",
    canvas_move_nodes: "canvas.agent.online.tools.moveNodes",
    canvas_resize_node: "canvas.agent.online.tools.resizeNode",
    canvas_delete_nodes: "canvas.agent.online.tools.deleteNodes",
    canvas_connect_nodes: "canvas.agent.online.tools.connectNodes",
    canvas_select_nodes: "canvas.agent.online.tools.selectNodes",
    canvas_set_viewport: "canvas.agent.online.tools.setViewport",
    canvas_run_generation: "canvas.agent.online.tools.runGeneration",
};

function toolName(name: string) {
    const key = TOOL_NAME_KEYS[name];
    return key ? translate(key) : name;
}

function isReadTool(name: string) {
    return name === "canvas_get_state" || name === "canvas_get_selection" || name === "canvas_export_snapshot";
}

function isMcpToolItem(item?: AgentEventItem) {
    return item?.type === "mcp_tool_call";
}

function toolDetail(item?: AgentEventItem) {
    return { server: item?.server, tool: item?.tool, status: item?.status, arguments: item?.arguments, result: parseToolResult(item?.result), error: item?.error };
}

function toolSummary(item?: AgentEventItem) {
    const result = parseToolResult(item?.result);
    const nodeField = objectField(result, "nodes");
    const connectionField = objectField(result, "connections");
    const nodes = Array.isArray(nodeField) ? nodeField : [];
    const connections = Array.isArray(connectionField) ? connectionField : [];
    if (Array.isArray(nodeField) || Array.isArray(connectionField)) return translate("canvas.agent.local.readNodesResult", { nodes: nodes.length, connections: connections.length });
    return translate("canvas.agent.local.toolCallDone");
}

function parseToolResult(result: unknown) {
    const content = objectField(result, "content");
    const text = Array.isArray(content) ? content.map((item) => objectField(item, "text")).filter((item): item is string => typeof item === "string").join("\n") : "";
    try {
        return text ? JSON.parse(text) : result;
    } catch {
        return text || result;
    }
}

function normalizeText(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (value instanceof Error) return value.message;
    if (value == null) return "";
    return JSON.stringify(value, null, 2);
}

function stringText(value: unknown) {
    return typeof value === "string" ? value : "";
}

function objectField(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function numberField(value: unknown, key: string) {
    const field = objectField(value, key);
    return typeof field === "number" ? field : 0;
}

function mergeAgentText(prev: string, next: string) {
    if (!next || prev === next || prev.endsWith(next)) return prev;
    if (next.startsWith(prev)) return next;
    for (let size = Math.min(prev.length, next.length); size > 0; size--) {
        if (prev.endsWith(next.slice(0, size))) return `${prev}${next.slice(size)}`;
    }
    const half = Math.floor(prev.length / 2);
    if (prev.length > 12 && next.length > 12 && prev.slice(half) === next.slice(0, prev.length - half)) return prev;
    return `${prev}${next}`;
}

function promptWithAttachments(text: string, attachments: AgentAttachment[]) {
    if (!attachments.length) return text;
    const names = attachments.map((item) => item.name).join("、");
    return [text, translate("canvas.agent.local.uploadedImages", { count: attachments.length, names })].filter(Boolean).join("\n\n");
}

function attachmentPayloadBytes(attachments: AgentAttachment[]) {
    return attachments.reduce((total, item) => total + item.dataUrl.length, 0);
}

function formatBytes(bytes: number) {
    return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(bytes / 1024)}KB`;
}

async function fetchAgentJson<T>(endpoint: string, token: string, path: string, init?: RequestInit) {
    const url = `${endpoint}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
    const res = await fetch(url, init);
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; msg?: string };
    if (!res.ok) throw new Error(data.error || data.msg || translate("canvas.agent.local.agentRequestFailed"));
    return data;
}

async function discoverAgentConfig(endpoint: string) {
    try {
        const res = await fetch(`${endpoint}/config`);
        if (!res.ok) return null;
        const data = (await res.json()) as AgentConfigResponse;
        return data.ok ? data : null;
    } catch {
        return null;
    }
}

function normalizeHistoryMessages(messages: AgentChatItem[]) {
    return messages
        .map((item, index) => ({
            ...item,
            id: item.id || `history-${index}`,
            text: normalizeText(item.text),
        }))
        .filter((item) => item.text);
}

function formatThreadTime(value?: number) {
    if (!value) return "";
    return new Date(value * 1000).toLocaleString();
}

function createId() {
    return typeof crypto === "undefined" ? `${Date.now()}-${Math.random()}` : crypto.randomUUID();
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function readDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error(translate("canvas.agent.local.imageReadFailed")));
        reader.readAsDataURL(file);
    });
}
