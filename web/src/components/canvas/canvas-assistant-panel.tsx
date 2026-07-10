import { useEffect, useMemo, useRef, useState } from "react";
import copyToClipboard from "copy-to-clipboard";
import { Bot, Copy, Cpu, History, PanelRightClose, Plus, Settings2, Trash2, X } from "lucide-react";
import { Button, Modal, Segmented, Switch, Tooltip } from "antd";
import { motion } from "motion/react";

import { useTranslation } from "@/components/layout/locale-provider";
import { translate } from "@/i18n";
import { modelOptionName, normalizeModelOptionValue, resolveModelChannel, selectableModelsByCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { nanoid } from "nanoid";
import { requestToolResponse, type ResponseFunctionTool, type ResponseInputMessage, type ResponseToolCall } from "@/services/api/image";
import { imageToDataUrl } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { DiaTextReveal } from "@/components/ui/dia-text-reveal";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { AgentChatComposer, AgentChatMessage, AgentModeSwitch, AgentPanelTabs, AgentWorkingMessage, type CanvasAgentChatMessage, type CanvasAgentMode } from "./canvas-agent-chat-ui";
import { CanvasLocalAgentPanel } from "./canvas-local-agent-panel";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { CanvasNodeType, type CanvasAssistantMessage, type CanvasAssistantReference, type CanvasAssistantSession, type CanvasNodeData } from "@/types/canvas";
import { useCanvasAgentStore } from "@/stores/canvas/use-canvas-agent-store";
import { summarizeCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";

export const CANVAS_AGENT_PANEL_MOTION_MS = 500;
const PANEL_MOTION_SECONDS = CANVAS_AGENT_PANEL_MOTION_MS / 1000;
const ONLINE_AGENT_MAX_STEPS = 4;
const ONLINE_AGENT_PROMPT =
    "你是 Infinite Canvas 网页内置在线画布助手。当前画布 JSON 会随用户消息提供。首轮必须调用工具：只读问题调用 canvas_get_state，需要改动画布时调用和本地 Agent 一致的 infinite-canvas 工具。需要生成内容时直接调用 canvas_generate_text、canvas_generate_image、canvas_generate_video、canvas_generate_audio 或 canvas_create_generation_flow；需要精确批量操作时调用 canvas_apply_ops。不要输出 JSON ops，不要编造执行结果。工具参数涉及已有节点时必须使用当前画布 JSON 中真实存在的 id；缺少必要 id 或用户意图不明确时直接说明需要用户明确选择或说明，不要猜测。工具返回结果后，再根据真实结果回答用户。";
const JSON_RECORD_SCHEMA = { type: "object", additionalProperties: true };
const POSITION_SCHEMA = { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"], additionalProperties: false };
const VIEWPORT_SCHEMA = { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, k: { type: "number" } }, required: ["x", "y", "k"], additionalProperties: false };
const NODE_TYPE_SCHEMA = { type: "string", enum: ["image", "text", "config", "video", "audio"] };
const GENERATION_MODE_SCHEMA = { type: "string", enum: ["text", "image", "video", "audio"] };
const GENERATION_OPTION_PROPERTIES = {
    model: { type: "string" },
    size: { type: "string" },
    quality: { type: "string" },
    count: { type: "number" },
    seconds: { type: "string" },
    vquality: { type: "string" },
    generateAudio: { type: "string" },
    watermark: { type: "string" },
    audioVoice: { type: "string" },
    audioFormat: { type: "string" },
    audioSpeed: { type: "string" },
    audioInstructions: { type: "string" },
};
const CANVAS_OP_SCHEMA = {
    type: "object",
    properties: {
        type: { type: "string", enum: ["add_node", "update_node", "delete_node", "delete_connections", "connect_nodes", "set_viewport", "select_nodes", "run_generation"] },
        id: { type: "string" },
        ids: { type: "array", items: { type: "string" } },
        nodeType: NODE_TYPE_SCHEMA,
        title: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        position: POSITION_SCHEMA,
        metadata: JSON_RECORD_SCHEMA,
        patch: JSON_RECORD_SCHEMA,
        all: { type: "boolean" },
        fromNodeId: { type: "string" },
        toNodeId: { type: "string" },
        viewport: VIEWPORT_SCHEMA,
        nodeId: { type: "string" },
        mode: GENERATION_MODE_SCHEMA,
        prompt: { type: "string" },
    },
    required: ["type"],
    additionalProperties: false,
};
const ONLINE_READ_TOOLS = new Set(["canvas_get_state", "canvas_get_selection", "canvas_export_snapshot"]);

function toolDefinition(name: string, description: string, properties: Record<string, unknown>, required: string[] = [], strict = false): ResponseFunctionTool {
    return { type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false }, strict } };
}

function generationToolDefinition(name: string, description: string, mode?: "text" | "image" | "video" | "audio") {
    return toolDefinition(
        name,
        description,
        { prompt: { type: "string" }, title: { type: "string" }, x: { type: "number" }, y: { type: "number" }, referenceNodeIds: { type: "array", items: { type: "string" } }, ...(mode ? {} : { mode: GENERATION_MODE_SCHEMA }), autoRun: { type: "boolean" }, ...GENERATION_OPTION_PROPERTIES },
        ["prompt"],
    );
}

function buildOnlineAgentTools(): ResponseFunctionTool[] {
    return [
    toolDefinition("canvas_get_state", "读取当前网页画布的节点、连线、选区和视口。", {}),
    toolDefinition("canvas_get_selection", "读取当前网页画布选中的节点。", {}),
    toolDefinition("canvas_export_snapshot", "导出当前画布快照，用于理解布局。", {}),
    toolDefinition("canvas_apply_ops", "批量操作当前网页画布。ops 支持 add_node、update_node、delete_node、delete_connections、connect_nodes、set_viewport、select_nodes、run_generation。", { ops: { type: "array", items: CANVAS_OP_SCHEMA } }, ["ops"], false),
    toolDefinition("canvas_create_node", "创建任意类型节点：text、image、config、video、audio。适合创建占位图、媒体占位、配置节点或自定义 metadata 节点。", { nodeType: NODE_TYPE_SCHEMA, title: { type: "string" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, metadata: JSON_RECORD_SCHEMA }, ["nodeType"]),
    toolDefinition("canvas_create_text_node", "在当前画布创建单个文本节点。", { text: { type: "string" }, x: { type: "number" }, y: { type: "number" }, title: { type: "string" }, width: { type: "number" }, height: { type: "number" } }),
    toolDefinition("canvas_create_text_nodes", "批量创建文本节点，适合生成标题、段落、脚本、说明等内容块。", { items: { type: "array", minItems: 1, items: { type: "object", properties: { text: { type: "string" }, title: { type: "string" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } }, required: ["text"], additionalProperties: false } }, x: { type: "number" }, y: { type: "number" }, gap: { type: "number" }, direction: { type: "string", enum: ["row", "column"] } }, ["items"]),
    toolDefinition("canvas_create_config_node", "创建生成配置节点，可指定 text/image/video/audio 模式和生成参数，可选择立即触发生成。", { prompt: { type: "string" }, mode: GENERATION_MODE_SCHEMA, title: { type: "string" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, autoRun: { type: "boolean" }, ...GENERATION_OPTION_PROPERTIES }),
    toolDefinition("canvas_create_image_prompt_flow", "创建提示词文本节点和图片生成配置节点，并自动连线，可选择立即触发生图。", { prompt: { type: "string" }, x: { type: "number" }, y: { type: "number" }, autoRun: { type: "boolean" }, ...GENERATION_OPTION_PROPERTIES }, ["prompt"]),
    generationToolDefinition("canvas_create_generation_flow", "创建通用生成流程：提示词文本节点、生成配置节点、参考节点连线，可用于文案、生图、视频或音频。"),
    generationToolDefinition("canvas_generate_text", "创建通用文本生成流程并立即触发生成。", "text"),
    generationToolDefinition("canvas_generate_image", "创建通用图片生成流程并立即触发生成。", "image"),
    generationToolDefinition("canvas_generate_video", "创建通用视频生成流程并立即触发生成。", "video"),
    generationToolDefinition("canvas_generate_audio", "创建通用音频生成流程并立即触发生成。", "audio"),
    toolDefinition("canvas_update_node", "更新节点基础字段或 metadata。", { id: { type: "string" }, patch: JSON_RECORD_SCHEMA, metadata: JSON_RECORD_SCHEMA }, ["id"]),
    toolDefinition("canvas_update_node_text", "更新文本节点内容和标题。", { id: { type: "string" }, text: { type: "string" }, title: { type: "string" } }, ["id", "text"]),
    toolDefinition("canvas_move_nodes", "移动一个或多个节点，支持绝对坐标或 dx/dy 偏移。", { items: { type: "array", minItems: 1, items: { type: "object", properties: { id: { type: "string" }, x: { type: "number" }, y: { type: "number" }, dx: { type: "number" }, dy: { type: "number" } }, required: ["id"], additionalProperties: false } } }, ["items"]),
    toolDefinition("canvas_resize_node", "调整节点尺寸。", { id: { type: "string" }, width: { type: "number" }, height: { type: "number" }, freeResize: { type: "boolean" } }, ["id", "width", "height"]),
    toolDefinition("canvas_delete_nodes", "删除指定节点及相关连线。", { ids: { type: "array", items: { type: "string" }, minItems: 1 } }, ["ids"]),
    toolDefinition("canvas_connect_nodes", "批量连接节点。", { connections: { type: "array", minItems: 1, items: { type: "object", properties: { fromNodeId: { type: "string" }, toNodeId: { type: "string" } }, required: ["fromNodeId", "toNodeId"], additionalProperties: false } } }, ["connections"]),
    toolDefinition("canvas_select_nodes", "设置当前选中节点。", { ids: { type: "array", items: { type: "string" } } }, ["ids"]),
    toolDefinition("canvas_set_viewport", "调整画布视口。", { viewport: VIEWPORT_SCHEMA }, ["viewport"]),
    toolDefinition("canvas_run_generation", "触发指定节点生成，通常用于配置节点或文本/图片/视频/音频节点。", { nodeId: { type: "string" }, mode: GENERATION_MODE_SCHEMA, prompt: { type: "string" } }, ["nodeId"]),
    ];
}

type OnlineAgentTab = "setup" | "chat" | "history" | "log";
type OnlineAgentLog = { id: string; time: string; title: string; data?: unknown };
type OnlineAgentLogContext = { model: string; running: boolean; confirmTools: boolean; messages: number; nodes: number; connections: number };
type OnlineLoopContext = { step: number };
type OnlineToolResult = { ok: true; message: string; data?: unknown } | { ok: false; message: string };
type OnlineExecutedToolCall = { toolCallId: string; name: string; result: OnlineToolResult };
type PendingOnlineToolContext = { messages: ResponseInputMessage[]; toolCalls: ResponseToolCall[]; assistantId: string; step: number };

type CanvasAssistantPanelProps = {
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    snapshot: CanvasAgentSnapshot;
    sessions: CanvasAssistantSession[];
    activeSessionId: string | null;
    onSelectNodeIds: (ids: Set<string>) => void;
    onSessionsChange: (sessions: CanvasAssistantSession[], activeSessionId: string | null) => void;
    onApplyOps: (ops?: CanvasAgentOp[]) => CanvasAgentSnapshot;
    canUndoOps: boolean;
    onUndoOps: () => CanvasAgentSnapshot | null;
    onPasteImage: (file: File) => void;
    agentMode: CanvasAgentMode;
    onAgentModeChange: (mode: CanvasAgentMode) => void;
    autoConnectLocal?: boolean;
    closing: boolean;
    onCollapse: () => void;
};

export function CanvasAssistantPanel({ nodes, selectedNodeIds, snapshot, sessions, activeSessionId, onSelectNodeIds, onSessionsChange, onApplyOps, canUndoOps, onUndoOps, onPasteImage, agentMode, onAgentModeChange, autoConnectLocal, closing, onCollapse }: CanvasAssistantPanelProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const user = useUserStore((state) => state.user);
    const effectiveConfig = useEffectiveConfig();
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const confirmTools = useCanvasAgentStore((state) => state.confirmTools);
    const setAgentState = useCanvasAgentStore((state) => state.setAgentState);
    const [width, setWidth] = useState(520);
    const [view, setView] = useState<OnlineAgentTab>("chat");
    const [prompt, setPrompt] = useState("");
    const [isRunning, setIsRunning] = useState(false);
    const [deleteChatIds, setDeleteChatIds] = useState<string[]>([]);
    const [onlineLogs, setOnlineLogs] = useState<OnlineAgentLog[]>([]);
    const [resizing, setResizing] = useState(false);
    const [removedReferenceIds, setRemovedReferenceIds] = useState<Set<string>>(new Set());
    const [localSessions, setLocalSessions] = useState<CanvasAssistantSession[]>(() => (sessions.length ? sessions : [createSession()]));
    const [localActiveSessionId, setLocalActiveSessionId] = useState<string | null>(activeSessionId);
    const snapshotRef = useRef(snapshot);
    const pendingToolContextRef = useRef(new Map<string, PendingOnlineToolContext>());

    useEffect(() => {
        if (!sessions.length) return;
        setLocalSessions(sessions);
        setLocalActiveSessionId(activeSessionId);
    }, [activeSessionId, sessions]);

    useEffect(() => {
        snapshotRef.current = snapshot;
    }, [snapshot]);

    useEffect(() => {
        onSessionsChange(localSessions, localActiveSessionId);
    }, [localActiveSessionId, localSessions, onSessionsChange]);

    const safeSessions = localSessions.length ? localSessions : [createSession()];
    const activeSession = useMemo(() => safeSessions.find((session) => session.id === localActiveSessionId) || safeSessions[0] || null, [localActiveSessionId, safeSessions]);
    const historySessions = safeSessions.filter((session) => session.messages.length > 0);
    const messages = activeSession?.messages || [];
    const hasMessages = messages.length > 0;
    const activeModel = effectiveConfig.textModel || effectiveConfig.model;
    const selectedNodeKey = useMemo(() => Array.from(selectedNodeIds).sort().join(","), [selectedNodeIds]);
    const allSelectedReferences = useMemo(() => buildAssistantReferences(nodes, selectedNodeIds), [nodes, selectedNodeIds]);
    const selectedReferences = useMemo(() => allSelectedReferences.filter((item) => !removedReferenceIds.has(item.id)), [allSelectedReferences, removedReferenceIds]);
    const iconButtonStyle = { color: theme.node.muted };

    useEffect(() => {
        setRemovedReferenceIds(new Set());
    }, [selectedNodeKey]);

    const updateSession = (sessionId: string, updater: (session: CanvasAssistantSession) => CanvasAssistantSession) => {
        setLocalSessions((prev) => prev.map((session) => (session.id === sessionId ? updater(session) : session)));
    };

    const appendMessage = (sessionId: string, message: CanvasAssistantMessage) => {
        updateSession(sessionId, (session) => ({
            ...session,
            title: session.messages.length ? session.title : message.text.slice(0, 18) || t("canvas.agent.history.untitledChat"),
            messages: [...session.messages, message],
            updatedAt: new Date().toISOString(),
        }));
    };
    const addOnlineLog = (title: string, data?: unknown) => setOnlineLogs((prev) => [{ id: nanoid(), time: new Date().toLocaleTimeString(), title, data }, ...prev].slice(0, 80));

    const upsertMessage = (sessionId: string, message: CanvasAssistantMessage) => {
        updateSession(sessionId, (session) => {
            const exists = session.messages.some((item) => item.id === message.id);
            return {
                ...session,
                title: session.messages.length ? session.title : message.text.slice(0, 18) || t("canvas.agent.history.untitledChat"),
                messages: exists ? session.messages.map((item) => (item.id === message.id ? { ...item, ...message } : item)) : [...session.messages, message],
                updatedAt: new Date().toISOString(),
            };
        });
    };

    const startChatSession = () => {
        if (activeSession && activeSession.messages.length === 0) {
            setLocalActiveSessionId(activeSession.id);
            return;
        }
        const session = createSession();
        setLocalSessions((prev) => [session, ...prev]);
        setLocalActiveSessionId(session.id);
    };

    const removeSessions = (ids: string[]) => {
        const next = safeSessions.filter((session) => !ids.includes(session.id));
        if (!next.length) {
            const session = createSession();
            setLocalSessions([session]);
            setLocalActiveSessionId(session.id);
        } else {
            setLocalSessions(next);
            setLocalActiveSessionId(localActiveSessionId && ids.includes(localActiveSessionId) ? next[0].id : localActiveSessionId);
        }
        cleanupImages({ sessions: next });
    };

    const clearSessions = () => {
        const session = createSession();
        setLocalSessions([session]);
        setLocalActiveSessionId(session.id);
        cleanupImages({ sessions: [session] });
    };

    const sendMessage = async (text: string, history: CanvasAssistantMessage[], savedReferences?: CanvasAssistantReference[]) => {
        const requestConfig = { ...effectiveConfig, model: effectiveConfig.textModel || effectiveConfig.model };
        if (!isAiConfigReady(requestConfig, requestConfig.model)) {
            openConfigDialog(true);
            return;
        }

        const session = activeSession || createSession();
        if (!activeSession) {
            setLocalSessions([session]);
            setLocalActiveSessionId(session.id);
        }

        const refs = savedReferences || selectedReferences;
        const userMessage: CanvasAssistantMessage = { id: nanoid(), role: "user", text, references: refs };
        const assistantId = nanoid();
        appendMessage(session.id, userMessage);
        addOnlineLog(t("canvas.agent.log.sendRequest"), { text, selectedNodeIds: snapshotRef.current.selectedNodeIds, nodeCount: snapshotRef.current.nodes.length, connectionCount: snapshotRef.current.connections.length });
        setPrompt("");
        setIsRunning(true);
        void runOnlineAgentStep(session.id, assistantId, history, userMessage, { step: 1 });
    };

    const runOnlineAgentStep = async (sessionId: string, assistantId: string, history: CanvasAssistantMessage[], userMessage: CanvasAssistantMessage, loop: OnlineLoopContext) => {
        const requestConfig = { ...effectiveConfig, model: effectiveConfig.textModel || effectiveConfig.model };
        try {
            setIsRunning(true);
            const messages = await buildToolAgentMessages(snapshotRef.current, history, userMessage);
            addOnlineLog(t("canvas.agent.log.toolLoopStart", { step: loop.step }), { toolChoice: "required" });
            let streamed = "";
            const result = await requestToolResponse({ ...requestConfig, systemPrompt: "" }, messages, buildOnlineAgentTools(), "required", (text) => {
                streamed = text;
                if (text.trim()) upsertMessage(sessionId, { id: assistantId, role: "assistant", text });
            });
            addOnlineLog(t("canvas.agent.log.modelToolReply"), result);
            if (result.toolCalls.length) {
                const writableCalls = result.toolCalls.filter(isWritableToolCall);
                if (confirmTools && writableCalls.length) {
                    upsertMessage(sessionId, { id: assistantId, role: "assistant", text: result.content || streamed || t("canvas.agent.online.prepareTool") });
                    const toolMessageId = nanoid();
                    pendingToolContextRef.current.set(toolMessageId, { messages, toolCalls: result.toolCalls, assistantId, step: loop.step });
                    const toolMessage: CanvasAssistantMessage = { id: toolMessageId, role: "tool", title: t("canvas.agent.toolCard.confirmTitle"), text: summarizeToolCalls(result.toolCalls), detail: { status: "pending", step: loop.step, toolCalls: result.toolCalls } };
                    appendMessage(sessionId, toolMessage);
                    addOnlineLog(t("canvas.agent.log.waitUserConfirm"), result.toolCalls);
                    return;
                }
                await continueOnlineToolLoop(sessionId, assistantId, messages, result, loop.step);
            } else {
                if (!result.content.trim()) throw new Error(translate("canvas.agent.online.errors.noToolCalls"));
                upsertMessage(sessionId, { id: assistantId, role: "assistant", text: result.content || streamed || t("canvas.agent.online.noContent") });
                addOnlineLog(t("canvas.agent.log.toolLoopEnd", { step: loop.step }), { reply: result.content });
            }
        } catch (error) {
            addOnlineLog(t("canvas.agent.log.requestFailed"), error instanceof Error ? error.message : error);
            appendMessage(sessionId, { id: nanoid(), role: "error", title: t("canvas.agent.online.operationFailed"), text: error instanceof Error ? error.message : t("canvas.agent.online.operationFailed") });
        } finally {
            setIsRunning(false);
        }
    };

    const continueOnlineToolLoop = async (sessionId: string, assistantId: string, messages: ResponseInputMessage[], result: { content: string; toolCalls: ResponseToolCall[] }, step: number) => {
        const toolResults = executeOnlineToolCalls(result.toolCalls);
        addOnlineLog(t("canvas.agent.log.toolResults"), toolResults);
        appendMessage(sessionId, {
            id: nanoid(),
            role: "tool",
            title: t("canvas.agent.online.autoExecuteDone"),
            text: toolResults.map((item) => toolResultText(item.result)).join("\n"),
            detail: { status: "completed", step, toolCalls: result.toolCalls, results: toolResults },
        });
        await continueOnlineToolLoopAfterResults(sessionId, assistantId, messages, result.toolCalls, toolResults, step);
    };

    const continueOnlineToolLoopAfterResults = async (sessionId: string, assistantId: string, messages: ResponseInputMessage[], toolCalls: ResponseToolCall[], toolResults: OnlineExecutedToolCall[], step: number) => {
        const nextMessages: ResponseInputMessage[] = [
            ...messages,
            ...toolCalls.map(toolCallToResponseInput),
            ...toolResults.map((item) => ({ role: "tool" as const, tool_call_id: item.toolCallId, content: JSON.stringify(item.result) })),
        ];
        if (step >= ONLINE_AGENT_MAX_STEPS) {
            upsertMessage(sessionId, { id: assistantId, role: "assistant", text: toolResults.map((item) => toolResultText(item.result)).join("\n") || t("canvas.agent.online.toolExecuted") });
            addOnlineLog(t("canvas.agent.log.toolLoopMaxSteps"), { maxSteps: ONLINE_AGENT_MAX_STEPS });
            return;
        }
        const requestConfig = { ...effectiveConfig, model: effectiveConfig.textModel || effectiveConfig.model };
        let streamed = "";
        const next = await requestToolResponse({ ...requestConfig, systemPrompt: "" }, nextMessages, buildOnlineAgentTools(), "auto", (text) => {
            streamed = text;
            if (text.trim()) upsertMessage(sessionId, { id: assistantId, role: "assistant", text });
        });
        addOnlineLog(t("canvas.agent.log.modelToolReply"), next);
        if (next.toolCalls.length) {
            const writableCalls = next.toolCalls.filter(isWritableToolCall);
            if (confirmTools && writableCalls.length) {
                upsertMessage(sessionId, { id: assistantId, role: "assistant", text: next.content || streamed || t("canvas.agent.online.prepareTool") });
                const toolMessageId = nanoid();
                pendingToolContextRef.current.set(toolMessageId, { messages: nextMessages, toolCalls: next.toolCalls, assistantId, step: step + 1 });
                appendMessage(sessionId, { id: toolMessageId, role: "tool", title: t("canvas.agent.toolCard.confirmTitle"), text: summarizeToolCalls(next.toolCalls), detail: { status: "pending", step: step + 1, toolCalls: next.toolCalls } });
                addOnlineLog(t("canvas.agent.log.waitUserConfirm"), next.toolCalls);
                return;
            }
            await continueOnlineToolLoop(sessionId, assistantId, nextMessages, next, step + 1);
            return;
        }
        upsertMessage(sessionId, { id: assistantId, role: "assistant", text: next.content || streamed || toolResults.map((item) => toolResultText(item.result)).join("\n") || t("canvas.agent.online.toolExecuted") });
    };

    const executeOps = (ops: CanvasAgentOp[]) => {
        const beforeSnapshot = snapshotRef.current;
        const before = snapshotSignature(beforeSnapshot);
        const next = onApplyOps(ops);
        snapshotRef.current = next;
        const ranGeneration = ops.some((op) => op.type === "run_generation" && Boolean(op.nodeId));
        const changed = before !== snapshotSignature(next) || ranGeneration;
        const noopReason = changed ? "" : explainNoop(ops, beforeSnapshot);
        return { changed, ops, ranGeneration, noopReason, before: JSON.parse(before), after: JSON.parse(snapshotSignature(next)) };
    };

    const executeOnlineTool = (name: string, args: Record<string, unknown>): OnlineToolResult => {
        const current = snapshotRef.current;
        try {
            if (name === "canvas_get_state") return { ok: true, message: describeCanvasSnapshot(current), data: compactSnapshot(current) };
            if (name === "canvas_export_snapshot") return { ok: true, message: describeCanvasSnapshot(current), data: compactSnapshot(current) };
            if (name === "canvas_get_selection") {
                const ids = new Set(current.selectedNodeIds || []);
                return { ok: true, message: translate("canvas.agent.online.selectedNodes", { count: ids.size }), data: { nodes: compactSnapshot({ ...current, nodes: current.nodes.filter((node) => ids.has(node.id)) }).nodes } };
            }
            const ops = onlineToolToOps(name, args, current, effectiveConfig);
            const result = executeOps(ops);
            return { ok: result.changed, message: result.changed ? summarizeCanvasAgentOps(ops) || translate("canvas.agent.online.canvasOpsExecuted") : result.noopReason, data: result };
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : translate("canvas.agent.online.errors.toolExecuteFailed") };
        }
    };

    const executeOnlineToolCall = (toolCall: ResponseToolCall): OnlineExecutedToolCall => {
        try {
            const result = executeOnlineTool(toolCall.function.name, parseToolArguments(toolCall.function.arguments));
            return { toolCallId: toolCall.id, name: toolCall.function.name, result };
        } catch (error) {
            return { toolCallId: toolCall.id, name: toolCall.function.name, result: { ok: false, message: error instanceof Error ? error.message : translate("canvas.agent.online.errors.toolParamError") } };
        }
    };

    const executeOnlineToolCalls = (toolCalls: ResponseToolCall[]) => {
        const results: OnlineExecutedToolCall[] = [];
        let stopped = false;
        toolCalls.forEach((toolCall) => {
            if (stopped) {
                results.push({ toolCallId: toolCall.id, name: toolCall.function.name, result: { ok: false, message: translate("canvas.agent.online.errors.previousToolFailed") } });
                return;
            }
            const result = executeOnlineToolCall(toolCall);
            results.push(result);
            if (!result.result.ok) stopped = true;
        });
        return results;
    };

    const approveOnlineTool = async (messageId: string) => {
        const message = safeSessions.flatMap((session) => session.messages).find((item) => item.id === messageId);
        const detail = objectDetail(message?.detail);
        const pendingContext = pendingToolContextRef.current.get(messageId);
        const toolCalls = pendingContext?.toolCalls || toolCallsFromDetail(detail);
        const previousMessages = pendingContext?.messages || [];
        const session = safeSessions.find((session) => session.messages.some((item) => item.id === messageId));
        addOnlineLog(t("canvas.agent.log.approveTool"), { messageId, toolCalls });
        const assistantId = pendingContext?.assistantId || "";
        if (!session) return;
        if (!toolCalls.length || !previousMessages.length || !assistantId) {
            upsertMessage(session.id, { id: messageId, role: "tool", title: t("canvas.agent.online.toolExecuteFailed"), text: t("canvas.agent.online.incompleteContext"), detail: { ...detail, status: "failed" } });
            return;
        }
        try {
            setIsRunning(true);
            const results = executeOnlineToolCalls(toolCalls);
            addOnlineLog(t("canvas.agent.log.toolResults"), results);
            upsertMessage(session.id, { id: messageId, role: "tool", title: t("canvas.agent.online.toolExecuteDone"), text: results.map((item) => toolResultText(item.result)).join("\n"), detail: { ...detail, results, status: "completed" } });
            pendingToolContextRef.current.delete(messageId);
            await continueOnlineToolLoopAfterResults(session.id, assistantId, previousMessages, toolCalls, results, pendingContext?.step || Number(detail.step) || 1);
        } catch (error) {
            addOnlineLog(t("canvas.agent.log.continueToolFailed"), error instanceof Error ? error.message : error);
            appendMessage(session.id, { id: nanoid(), role: "error", title: t("canvas.agent.online.operationFailed"), text: error instanceof Error ? error.message : t("canvas.agent.online.operationFailed") });
        } finally {
            setIsRunning(false);
        }
    };

    const rejectOnlineTool = (messageId: string) => {
        const session = safeSessions.find((session) => session.messages.some((item) => item.id === messageId));
        addOnlineLog(t("canvas.agent.log.rejectTool"), { messageId });
        pendingToolContextRef.current.delete(messageId);
        if (session) upsertMessage(session.id, { id: messageId, role: "tool", title: t("canvas.agent.online.toolRejected"), text: t("canvas.agent.online.toolCancelled"), detail: { ...objectDetail(session.messages.find((item) => item.id === messageId)?.detail), status: "rejected" } });
    };

    const submit = async () => {
        const text = prompt.trim();
        if (!text || isRunning) return;
        await sendMessage(text, messages);
    };

    const addImagesToCanvas = (files: FileList | File[] | null) => {
        const file = Array.from(files || []).find((item) => item.type.startsWith("image/"));
        if (file) onPasteImage(file);
    };

    const startResize = () => {
        const move = (event: MouseEvent) => setWidth(Math.min(760, Math.max(320, window.innerWidth - event.clientX)));
        const stop = () => {
            setResizing(false);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", stop);
        };
        setResizing(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", stop);
    };

    const collapse = () => {
        onCollapse();
    };

    const onlineContent = (
        <>
            <AgentPanelTabs
                value={view}
                theme={theme}
                items={[
                    { value: "setup", label: t("canvas.agent.tabs.setup"), icon: <Settings2 className="size-3.5" /> },
                    { value: "chat", label: t("canvas.agent.tabs.chat") },
                    { value: "history", label: t("canvas.agent.tabs.history"), icon: <History className="size-3.5" />, count: historySessions.length },
                    { value: "log", label: t("canvas.agent.tabs.log"), count: onlineLogs.length },
                ]}
                onChange={setView}
                right={
                    <>
                        {view === "history" ? (
                            <Tooltip title={t("canvas.agent.chat.deleteAll")}>
                                <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" style={iconButtonStyle} icon={<X className="size-4" />} disabled={!historySessions.length} onClick={() => setDeleteChatIds(historySessions.map((session) => session.id))} />
                            </Tooltip>
                        ) : null}
                        <Tooltip title={t("canvas.agent.chat.newChat")}>
                            <Button
                                type="text"
                                shape="circle"
                                className="!h-8 !w-8 !min-w-8"
                                style={iconButtonStyle}
                                icon={<Plus className="size-4" />}
                                disabled={!hasMessages}
                                onClick={() => {
                                    startChatSession();
                                    setView("chat");
                                }}
                            />
                        </Tooltip>
                        <Tooltip title={t("canvas.agent.chat.configure")}>
                            <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" style={iconButtonStyle} icon={<Settings2 className="size-4" />} onClick={() => openConfigDialog(false)} />
                        </Tooltip>
                    </>
                }
            />

            {view === "setup" ? (
                <OnlineAgentSetupView theme={theme} activeModel={activeModel} onOpenConfig={() => openConfigDialog(true)} />
            ) : (
                <div className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
                    {view === "history" ? (
                        <AssistantHistory
                            sessions={historySessions}
                            activeSession={activeSession}
                            onOpen={(id) => {
                                setLocalActiveSessionId(id);
                                setView("chat");
                            }}
                            onDelete={(id) => setDeleteChatIds([id])}
                        />
                    ) : view === "log" ? (
                        <OnlineAgentLogView logs={onlineLogs} theme={theme} context={{ model: activeModel, running: isRunning, confirmTools, messages: messages.length, nodes: snapshot.nodes.length, connections: snapshot.connections.length }} onClear={() => setOnlineLogs([])} />
                    ) : messages.length ? (
                        <>
                            {messages.map((message) => (
                                <div key={message.id} className="space-y-2">
                                    <AgentChatMessage item={assistantMessageToChatMessage(message)} theme={theme} user={user} onRejectTool={rejectOnlineTool} onApproveTool={approveOnlineTool} />
                                    {message.references?.length ? <MessageReferences message={message} /> : null}
                                </div>
                            ))}
                            {isRunning ? <AgentWorkingMessage theme={theme} /> : null}
                        </>
                    ) : (
                        <div className="flex h-full flex-col items-center justify-center px-1 text-center">
                            <div className="relative font-serif text-4xl font-bold italic tracking-normal" style={{ color: theme.node.text }}>
                                <span>Infinite Canvas</span>
                                <DiaTextReveal className="absolute inset-0" colors={["#A97CF8", "#F38CB8", "#FDCC92"]} textColor="transparent" duration={1.8} startOnView={false} text="Infinite Canvas" />
                            </div>
                            <div className="mt-3 font-serif text-base italic tracking-wide opacity-60">One canvas, infinite ideas</div>
                        </div>
                    )}
                </div>
            )}

            {view === "chat" ? (
                <>
                    {selectedReferences.length ? (
                        <div className="thin-scrollbar flex max-w-full gap-1.5 overflow-x-auto px-3 pb-1">
                            {selectedReferences.map((item, index) => (
                                <AssistantReferenceChip
                                    key={item.id}
                                    item={item}
                                    label={assistantImageReferenceLabel(selectedReferences, index)}
                                    onRemove={() => {
                                        setRemovedReferenceIds((prev) => new Set(prev).add(item.id));
                                        if (selectedNodeIds.has(item.id)) onSelectNodeIds(new Set(Array.from(selectedNodeIds).filter((nodeId) => nodeId !== item.id)));
                                    }}
                                />
                            ))}
                        </div>
                    ) : null}
                    <AgentChatComposer
                        prompt={prompt}
                        sending={isRunning}
                        placeholder={t("canvas.agent.chat.placeholderOnline")}
                        theme={theme}
                        onPromptChange={setPrompt}
                        onSubmit={submit}
                        onAddFiles={addImagesToCanvas}
                        left={
                            <>
                                <CanvasPromptLibrary onSelect={setPrompt} />
                                <AgentTextModelPicker config={effectiveConfig} value={effectiveConfig.textModel} onChange={(model) => updateConfig("textModel", model)} />
                            </>
                        }
                    />
                </>
            ) : null}

            <Modal
                title={t("canvas.dialogs.deleteChat.title")}
                open={deleteChatIds.length > 0}
                centered
                onCancel={() => setDeleteChatIds([])}
                footer={
                    <>
                        <Button onClick={() => setDeleteChatIds([])}>{t("common.cancel")}</Button>
                        <Button
                            danger
                            type="primary"
                            onClick={() => {
                                deleteChatIds.length === historySessions.length ? clearSessions() : removeSessions(deleteChatIds);
                                setDeleteChatIds([]);
                            }}
                        >
                            {t("common.delete")}
                        </Button>
                    </>
                }
            >
                <p className="text-sm opacity-60">{t("canvas.dialogs.deleteChat.description", { count: deleteChatIds.length })}</p>
            </Modal>
        </>
    );

    return (
        <motion.div
            className="flex shrink-0"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: closing ? 0 : width + 1, opacity: closing ? 0 : 1 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "clip", pointerEvents: closing ? "none" : undefined }}
        >
            <motion.aside
                className="relative flex shrink-0 flex-col border-l"
                initial={{ x: 48 }}
                animate={{ x: closing ? 28 : 0 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
                style={{ width, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            >
                <button type="button" className="absolute inset-y-0 left-0 z-40 w-4 -translate-x-1/2 cursor-col-resize" onMouseDown={startResize} aria-label={t("canvas.agent.resizePanel")} />
                <header className="flex h-14 items-center justify-between border-b px-4" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="grid size-8 place-items-center rounded-lg">
                            <Bot className="size-4" />
                        </span>
                        <div className="min-w-0">
                            <div className="text-base font-semibold leading-5">{t("canvas.agent.title")}</div>
                            <div className="truncate text-xs" style={{ color: theme.node.muted }}>
                                {t("canvas.agent.subtitle")}
                            </div>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <AgentModeSwitch value={agentMode} theme={theme} onChange={onAgentModeChange} />
                        <label className="flex items-center gap-1.5 text-xs" style={{ color: theme.node.muted }}>
                            <Switch size="small" checked={confirmTools} onChange={(confirmTools) => setAgentState({ confirmTools })} />
                            {t("canvas.agent.toolConfirm")}
                        </label>
                        <Tooltip title={t("canvas.agent.collapsePanel")}>
                            <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" style={iconButtonStyle} icon={<PanelRightClose className="size-4" />} onClick={collapse} />
                        </Tooltip>
                    </div>
                </header>
                {agentMode === "local" ? (
                    <CanvasLocalAgentPanel
                        embedded
                        snapshot={snapshot}
                        canUndoOps={canUndoOps}
                        onApplyOps={onApplyOps}
                        onUndoOps={onUndoOps}
                        autoConnect={autoConnectLocal}
                    />
                ) : (
                    onlineContent
                )}
            </motion.aside>
        </motion.div>
    );
}

function AgentTextModelPicker({ config, value, onChange }: { config: AiConfig; value: string; onChange: (model: string) => void }) {
    const { t } = useTranslation();
    const options = useMemo(() => Array.from(new Set([value, ...selectableModelsByCapability(config, "text")].filter(Boolean))), [config, value]);
    const current = value || "";
    return (
        <Select value={current} onValueChange={onChange}>
            <SelectTrigger
                hideChevron
                className="h-7 min-w-0 max-w-[220px] gap-1.5 border-0 bg-transparent px-1 py-0 text-xs font-normal shadow-none hover:bg-transparent hover:opacity-75 focus-visible:border-transparent focus-visible:ring-0 data-[state=open]:ring-0 dark:bg-transparent dark:hover:bg-transparent"
                title={current ? `${modelOptionName(current)} · ${resolveModelChannel(config, current).name}` : t("canvas.agent.chat.selectTextModel")}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <AgentModelIcon model={current} />
                <span className="min-w-0 truncate">{current ? modelOptionName(current) : t("canvas.agent.chat.selectTextModel")}</span>
                {current ? <span className="shrink-0 opacity-55">{resolveModelChannel(config, current).name}</span> : null}
            </SelectTrigger>
            <SelectContent data-canvas-no-zoom className="z-[1200] w-72 max-w-[calc(100vw-24px)]" position="popper" align="start" side="bottom" sideOffset={6} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
                {options.length ? (
                    options.map((model) => (
                        <SelectItem key={model} value={model} textValue={`${modelOptionName(model)} ${resolveModelChannel(config, model).name}`}>
                            <span className="flex min-w-0 items-center gap-2">
                                <AgentModelIcon model={model} />
                                <span className="min-w-0 flex-1 truncate">{modelOptionName(model)}</span>
                                <span className="shrink-0 text-xs opacity-55">{resolveModelChannel(config, model).name}</span>
                            </span>
                        </SelectItem>
                    ))
                ) : (
                    <SelectItem value="__empty_text_model__" disabled>
                        {t("canvas.agent.chat.noTextModel")}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}

function AgentModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(modelOptionName(model));
    return icon ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm")) return "/icons/glm.svg";
    return "";
}

function AssistantHistory({
    sessions,
    activeSession,
    onOpen,
    onDelete,
}: {
    sessions: CanvasAssistantSession[];
    activeSession: CanvasAssistantSession | null;
    onOpen: (id: string) => void;
    onDelete: (id: string) => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div className="space-y-3">
            <div className="text-sm" style={{ color: theme.node.muted }}>
                {sessions.length ? t("canvas.agent.history.count", { count: sessions.length }) : t("canvas.agent.history.empty")}
            </div>
            {sessions.map((session) => (
                <div key={session.id} className="rounded-lg border px-2.5 py-1.5 transition" style={{ borderColor: session.id === activeSession?.id ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}>
                    <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1.5">
                                {session.id === activeSession?.id ? <span className="shrink-0 text-[10px] font-medium" style={{ color: theme.node.text }}>{t("canvas.agent.history.current")}</span> : null}
                                <div className="truncate text-sm font-medium leading-5">{session.title}</div>
                            </div>
                            <div className="truncate text-[11px] leading-4 opacity-65">{sessionPreview(session)}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <span className="text-[10px] opacity-55">{formatSessionTime(session.updatedAt || session.createdAt)}</span>
                            <Button size="small" className="!h-6 !px-2" onClick={() => onOpen(session.id)}>
                                {t("canvas.agent.history.enter")}
                            </Button>
                            <Tooltip title={t("canvas.agent.history.deleteRecord")}>
                                <Button size="small" danger type="text" className="!h-6 !w-6 !min-w-6" icon={<Trash2 className="size-3.5" />} onClick={() => onDelete(session.id)} />
                            </Tooltip>
                        </div>
                    </div>
                </div>
            ))}
            {!sessions.length ? (
                <div className="px-3 py-8 text-center text-sm" style={{ color: theme.node.muted }}>
                    {t("canvas.agent.history.onlineEmpty")}
                </div>
            ) : null}
        </div>
    );
}

function OnlineAgentSetupView({ theme, activeModel, onOpenConfig }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; activeModel: string; onOpenConfig: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
                <div>
                    <div className="text-base font-semibold leading-6">{t("canvas.agent.online.setupTitle")}</div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t("canvas.agent.online.setupDesc")}
                    </div>
                </div>
                <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium leading-5">{t("canvas.agent.online.textModel")}</div>
                            <div className="mt-1 truncate text-xs leading-5" style={{ color: theme.node.muted }}>
                                {activeModel || t("canvas.agent.online.modelNotConfigured")}
                            </div>
                        </div>
                        <Button className="!h-8 !px-3" type="primary" icon={<Settings2 className="size-4" />} onClick={onOpenConfig}>
                            {t("canvas.agent.chat.configure")}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function OnlineAgentLogView({ logs, theme, context, onClear }: { logs: OnlineAgentLog[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; context: OnlineAgentLogContext; onClear: () => void }) {
    const { t } = useTranslation();
    const [mode, setMode] = useState<"text" | "json">("text");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const content = mode === "text" ? formatOnlineLogText(logs, context) : formatOnlineLogJson(logs, context);
    const lastError = [...logs].reverse().find((item) => /错误|失败|error|failed|rejected/i.test(`${item.title}\n${stringifyLog(item.data)}`));
    const copy = async (value = content) => {
        if (await copyToClipboard(value)) return;
        textareaRef.current?.focus();
        textareaRef.current?.select();
    };
    return (
        <div className="flex min-h-full flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Segmented size="small" value={mode} onChange={(value) => setMode(value as "text" | "json")} options={[{ label: t("canvas.agent.log.debugLog"), value: "text" }, { label: t("canvas.agent.log.rawJson"), value: "json" }]} />
                <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: theme.node.muted }}>{t("canvas.agent.log.count", { count: logs.length })}</span>
                    <Button size="small" icon={<Copy className="size-3.5" />} disabled={!logs.length} onClick={() => void copy()}>{t("canvas.agent.log.copy")}</Button>
                    <Button size="small" disabled={!lastError} onClick={() => lastError && void copy(formatOnlineLogText([lastError], context))}>{t("canvas.agent.log.recentError")}</Button>
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
    );
}

function MessageReferences({ message }: { message: CanvasAssistantMessage }) {
    return (
        <div className={`flex max-w-[88%] flex-wrap gap-2 ${message.role === "user" ? "ml-auto justify-end" : "ml-11 justify-start"}`}>
            {message.references?.map((item, index, references) => (
                <AssistantReferenceChip key={item.id} item={item} label={assistantImageReferenceLabel(references, index)} />
            ))}
        </div>
    );
}

function AssistantReferenceChip({ item, label, onRemove }: { item: CanvasAssistantReference; label?: string; onRemove?: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const text = (item.text || item.title).replace(/\s+/g, " ").trim().slice(0, 1) || translate("canvas.agent.chat.referenceFallback");
    return (
        <div className="group/chip relative inline-flex h-8 max-w-[150px] shrink-0 items-center gap-1.5 rounded-lg text-sm" style={{ color: theme.node.text }}>
            {item.dataUrl ? (
                <span className="relative block size-8 shrink-0">
                    <img src={item.dataUrl} alt="" className="size-8 rounded-lg object-cover" />
                    {label ? <span className="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 py-0.5 text-[8px] font-medium leading-none text-white">{label}</span> : null}
                </span>
            ) : (
                <span className="grid size-8 place-items-center rounded-lg border text-sm font-medium" style={{ background: theme.node.panel, borderColor: theme.node.activeStroke }}>
                    {text}
                </span>
            )}
            {onRemove ? (
                <button
                    type="button"
                    className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full border opacity-0 shadow-sm transition group-hover/chip:opacity-100"
                    style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}
                    onClick={onRemove}
                    aria-label={translate("canvas.agent.chat.removeReference")}
                >
                    <X className="size-3" />
                </button>
            ) : null}
        </div>
    );
}

function assistantImageReferenceLabel(references: CanvasAssistantReference[], index: number) {
    if (!references[index]?.dataUrl) return undefined;
    const imageIndex = references.slice(0, index + 1).filter((item) => item.dataUrl).length - 1;
    return imageIndex >= 0 ? imageReferenceLabel(imageIndex) : undefined;
}

function assistantMessageToChatMessage(message: CanvasAssistantMessage): CanvasAgentChatMessage {
    return { id: message.id, role: message.role, title: message.title, text: message.text, meta: message.meta, detail: message.detail };
}

function formatSessionTime(value?: string) {
    return value ? new Date(value).toLocaleString() : "";
}

function sessionPreview(session: CanvasAssistantSession) {
    return session.messages.at(-1)?.text || translate("canvas.agent.history.messageCount", { count: session.messages.length });
}

function objectDetail(value: unknown) {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringifyLog(value: unknown) {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function formatOnlineLogText(logs: OnlineAgentLog[], context: OnlineAgentLogContext) {
    const head = [
        translate("canvas.agent.online.diagnosticLog"),
        `model: ${context.model || "none"}`,
        `running: ${context.running}`,
        `confirmTools: ${context.confirmTools}`,
        `messages: ${context.messages}`,
        `nodes: ${context.nodes}`,
        `connections: ${context.connections}`,
        `logs: ${logs.length}`,
    ].join("\n");
    const body = logs.map((log, index) => [`#${index + 1} ${log.time} ${log.title}`, log.data === undefined ? "" : stringifyLog(log.data)].filter(Boolean).join("\n")).join("\n\n---\n\n");
    return [head, body || translate("canvas.agent.log.noEvents")].join("\n\n");
}

function formatOnlineLogJson(logs: OnlineAgentLog[], context: OnlineAgentLogContext) {
    return JSON.stringify({ context, logs: logs.map(({ time, title, data }) => ({ time, title, data })) }, null, 2);
}

function describeCanvasSnapshot(snapshot: CanvasAgentSnapshot) {
    const counts = snapshot.nodes.reduce<Record<string, number>>((acc, node) => {
        acc[node.type] = (acc[node.type] || 0) + 1;
        return acc;
    }, {});
    return translate("canvas.agent.online.snapshotSummary", {
        nodes: snapshot.nodes.length,
        connections: snapshot.connections.length,
        text: counts[CanvasNodeType.Text] || 0,
        image: counts[CanvasNodeType.Image] || 0,
        config: counts[CanvasNodeType.Config] || 0,
        video: counts[CanvasNodeType.Video] || 0,
        audio: counts[CanvasNodeType.Audio] || 0,
    });
}

function parseToolArguments(value: string) {
    try {
        const parsed = JSON.parse(value || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(translate("canvas.agent.online.errors.paramMustBeObject"));
        return parsed as Record<string, unknown>;
    } catch {
        throw new Error(translate("canvas.agent.online.errors.paramInvalidJson"));
    }
}

function onlineToolToOps(name: string, input: Record<string, unknown>, snapshot: CanvasAgentSnapshot, config: AiConfig): CanvasAgentOp[] {
    if (name === "canvas_apply_ops") return requireOps(input.ops);
    if (name === "canvas_create_node") {
        const nodeType = requireNodeType(input.nodeType);
        const x = numberOr(input.x, nextCanvasX(snapshot));
        const y = numberOr(input.y, 0);
        if (nodeType === CanvasNodeType.Config) return [configNodeOp(stringOptional(input.id) || `config-${nanoid()}`, { ...recordOptional(input.metadata), ...input }, x, y, config)];
        return [{ type: "add_node", nodeType, title: stringOptional(input.title), position: { x, y }, width: numberOptional(input.width), height: numberOptional(input.height), metadata: recordOptional(input.metadata) as CanvasNodeData["metadata"] }];
    }
    if (name === "canvas_create_text_node") return [textNodeOp(input, numberOr(input.x, nextCanvasX(snapshot)), numberOr(input.y, 0))];
    if (name === "canvas_create_text_nodes") {
        const items = requireRecordArray(input.items, "items");
        const x = numberOr(input.x, nextCanvasX(snapshot));
        const y = numberOr(input.y, 0);
        const gap = numberOr(input.gap, 40);
        const direction = input.direction === "row" ? "row" : "column";
        return items.map((item, index) => textNodeOp({ ...item, text: requireString(item.text, "text") }, numberOr(item.x, direction === "row" ? x + index * (NODE_DEFAULT_SIZE[CanvasNodeType.Text].width + gap) : x), numberOr(item.y, direction === "row" ? y : y + index * (NODE_DEFAULT_SIZE[CanvasNodeType.Text].height + gap))));
    }
    if (name === "canvas_create_image_prompt_flow") return generationFlowOps({ ...input, mode: "image" }, snapshot, config);
    if (name === "canvas_create_config_node") {
        const configId = `config-${nanoid()}`;
        const mode = generationMode(input.mode);
        return [configNodeOp(configId, input, numberOr(input.x, nextCanvasX(snapshot)), numberOr(input.y, 0), config), ...(input.autoRun ? [runGenerationOp(configId, mode, stringOptional(input.prompt))] : [])];
    }
    if (name === "canvas_create_generation_flow") return generationFlowOps(input, snapshot, config);
    if (name === "canvas_generate_text") return generationFlowOps({ ...input, mode: "text", autoRun: true }, snapshot, config);
    if (name === "canvas_generate_image") return generationFlowOps({ ...input, mode: "image", autoRun: true }, snapshot, config);
    if (name === "canvas_generate_video") return generationFlowOps({ ...input, mode: "video", autoRun: true }, snapshot, config);
    if (name === "canvas_generate_audio") return generationFlowOps({ ...input, mode: "audio", autoRun: true }, snapshot, config);
    if (name === "canvas_update_node") return [{ type: "update_node", id: requireString(input.id, "id"), patch: recordOptional(input.patch) as Partial<CanvasNodeData> | undefined, metadata: recordOptional(input.metadata) as CanvasNodeData["metadata"] }];
    if (name === "canvas_update_node_text") return [{ type: "update_node", id: requireString(input.id, "id"), patch: stringOptional(input.title) ? { title: stringOptional(input.title) } : undefined, metadata: { content: requireString(input.text, "text"), status: "success" } }];
    if (name === "canvas_move_nodes") {
        return requireRecordArray(input.items, "items").map((item) => {
            const id = requireString(item.id, "id");
            const current = snapshot.nodes.find((node) => node.id === id);
            return { type: "update_node", id, patch: { position: { x: numberOr(item.x, (current?.position.x || 0) + numberOr(item.dx, 0)), y: numberOr(item.y, (current?.position.y || 0) + numberOr(item.dy, 0)) } } };
        });
    }
    if (name === "canvas_resize_node") return [{ type: "update_node", id: requireString(input.id, "id"), patch: { width: requireNumber(input.width, "width"), height: requireNumber(input.height, "height") }, metadata: typeof input.freeResize === "boolean" ? { freeResize: input.freeResize } : undefined }];
    if (name === "canvas_delete_nodes") return [{ type: "delete_node", ids: requireStringArray(input.ids, "ids") }];
    if (name === "canvas_connect_nodes") return requireRecordArray(input.connections, "connections").map((connection) => ({ type: "connect_nodes", fromNodeId: requireString(connection.fromNodeId, "fromNodeId"), toNodeId: requireString(connection.toNodeId, "toNodeId") }));
    if (name === "canvas_select_nodes") return [{ type: "select_nodes", ids: requireStringArray(input.ids, "ids") }];
    if (name === "canvas_set_viewport") return [{ type: "set_viewport", viewport: requireViewport(input.viewport) }];
    if (name === "canvas_run_generation") return [runGenerationOp(requireString(input.nodeId, "nodeId"), generationMode(input.mode), stringOptional(input.prompt))];
    throw new Error(translate("canvas.agent.online.errors.unsupportedTool", { name }));
}

function generationFlowOps(input: Record<string, unknown>, snapshot: CanvasAgentSnapshot, config: AiConfig): CanvasAgentOp[] {
    const mode = generationMode(input.mode);
    const prompt = requireString(input.prompt, "prompt");
    const x = numberOr(input.x, nextCanvasX(snapshot));
    const y = numberOr(input.y, 0);
    const textId = `text-${nanoid()}`;
    const configId = `config-${nanoid()}`;
    const referenceNodeIds = Array.isArray(input.referenceNodeIds) ? input.referenceNodeIds.filter((id): id is string => typeof id === "string") : [];
    const tokens = [`@[node:${textId}]`, ...referenceNodeIds.map((id) => `@[node:${id}]`)];
    return [
        textNodeOp({ id: textId, text: prompt, title: stringOptional(input.title) || translate("canvas.agent.online.defaultPromptTitle") }, x, y),
        configNodeOp(configId, { ...input, prompt: tokens.join("\n") }, x + NODE_DEFAULT_SIZE[CanvasNodeType.Text].width + 80, y, config),
        { type: "connect_nodes", fromNodeId: textId, toNodeId: configId },
        ...referenceNodeIds.map((fromNodeId) => ({ type: "connect_nodes" as const, fromNodeId, toNodeId: configId })),
        { type: "select_nodes", ids: [configId] },
        ...(input.autoRun ? [runGenerationOp(configId, mode, tokens.join("\n"))] : []),
    ];
}

function textNodeOp(input: Record<string, unknown>, x: number, y: number): CanvasAgentOp {
    return { type: "add_node", id: stringOptional(input.id), nodeType: CanvasNodeType.Text, title: stringOptional(input.title), position: { x, y }, width: numberOptional(input.width), height: numberOptional(input.height), metadata: { content: stringOptional(input.text), status: "success", fontSize: 14 } };
}

function configNodeOp(id: string, input: Record<string, unknown>, x: number, y: number, config: AiConfig): CanvasAgentOp {
    const mode = generationMode(input.mode);
    const prompt = stringOptional(input.prompt);
    return {
        type: "add_node",
        id,
        nodeType: CanvasNodeType.Config,
        title: stringOptional(input.title) || generationTitle(mode),
        position: { x, y },
        width: numberOptional(input.width),
        height: numberOptional(input.height),
        metadata: cleanRecord({
            generationMode: mode,
            composerContent: prompt,
            prompt,
            status: "idle",
            model: resolveGenerationModel(config, mode, stringOptional(input.model)),
            size: stringOptional(input.size) || config.size,
            quality: stringOptional(input.quality) || config.quality,
            count: numberOptional(input.count) ?? generationCount(mode === "image" ? config.canvasImageCount || config.count : config.count),
            seconds: stringOptional(input.seconds) || config.videoSeconds,
            vquality: stringOptional(input.vquality) || config.vquality,
            generateAudio: stringOptional(input.generateAudio) || config.videoGenerateAudio,
            watermark: stringOptional(input.watermark) || config.videoWatermark,
            audioVoice: stringOptional(input.audioVoice) || config.audioVoice,
            audioFormat: stringOptional(input.audioFormat) || config.audioFormat,
            audioSpeed: stringOptional(input.audioSpeed) || config.audioSpeed,
            audioInstructions: stringOptional(input.audioInstructions) || config.audioInstructions,
        }) as CanvasNodeData["metadata"],
    };
}

function runGenerationOp(nodeId: string, mode: "text" | "image" | "video" | "audio", prompt?: string): CanvasAgentOp {
    return { type: "run_generation", nodeId, mode, prompt };
}

function isWritableToolCall(call: ResponseToolCall) {
    return !ONLINE_READ_TOOLS.has(call.function.name);
}

function toolCallsFromDetail(detail: Record<string, unknown>): ResponseToolCall[] {
    return Array.isArray(detail.toolCalls) ? (detail.toolCalls.filter(isResponseToolCall) as ResponseToolCall[]) : [];
}

function isResponseToolCall(value: unknown): value is ResponseToolCall {
    const item = objectDetail(value);
    const fn = objectDetail(item.function);
    return typeof item.id === "string" && item.type === "function" && typeof fn.name === "string" && typeof fn.arguments === "string";
}

function toolCallToResponseInput(call: ResponseToolCall): ResponseInputMessage {
    return { type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments, ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}) };
}

function summarizeToolCalls(calls: ResponseToolCall[]) {
    return calls.map((call) => toolCallLabel(call.function.name)).join(", ") || translate("canvas.agent.toolCard.defaultTitle");
}

function toolCallLabel(name: string) {
    const labels: Record<string, string> = {
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
    const key = labels[name];
    return key ? translate(key as Parameters<typeof translate>[0]) : name;
}

function toolResultText(result: OnlineToolResult) {
    return result.message;
}

function requireStringArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value)) throw new Error(translate("canvas.agent.online.errors.fieldMustBeStringArray", { field }));
    if (!value.every((item) => typeof item === "string" && Boolean(item))) throw new Error(translate("canvas.agent.online.errors.fieldMustBeNonEmptyStrings", { field }));
    return value as string[];
}

function requireOps(value: unknown): CanvasAgentOp[] {
    if (!Array.isArray(value)) throw new Error(translate("canvas.agent.online.errors.opsMustBeArray"));
    return value.map(toCanvasAgentOp);
}

function toCanvasAgentOp(value: unknown): CanvasAgentOp {
    const item = objectDetail(value);
    const type = item.type;
    if (type === "add_node") {
        return {
            type,
            id: stringOptional(item.id),
            nodeType: item.nodeType ? requireNodeType(item.nodeType) : undefined,
            title: stringOptional(item.title),
            position: recordOptional(item.position) ? { x: requireNumber(objectDetail(item.position).x, "position.x"), y: requireNumber(objectDetail(item.position).y, "position.y") } : undefined,
            x: numberOptional(item.x),
            y: numberOptional(item.y),
            width: numberOptional(item.width),
            height: numberOptional(item.height),
            metadata: recordOptional(item.metadata) as CanvasNodeData["metadata"],
        };
    }
    if (type === "update_node") return { type, id: requireString(item.id, "id"), patch: recordOptional(item.patch) as Partial<CanvasNodeData> | undefined, metadata: recordOptional(item.metadata) as CanvasNodeData["metadata"] };
    if (type === "delete_node") return { type, id: stringOptional(item.id), ids: Array.isArray(item.ids) ? requireStringArray(item.ids, "ids") : undefined };
    if (type === "delete_connections") return { type, id: stringOptional(item.id), ids: Array.isArray(item.ids) ? requireStringArray(item.ids, "ids") : undefined, all: typeof item.all === "boolean" ? item.all : undefined };
    if (type === "connect_nodes") return { type, id: stringOptional(item.id), fromNodeId: requireString(item.fromNodeId, "fromNodeId"), toNodeId: requireString(item.toNodeId, "toNodeId") };
    if (type === "set_viewport") return { type, viewport: requireViewport(item.viewport) };
    if (type === "select_nodes") return { type, ids: requireStringArray(item.ids, "ids") };
    if (type === "run_generation") return { type, nodeId: requireString(item.nodeId, "nodeId"), mode: generationMode(item.mode), prompt: stringOptional(item.prompt) };
    throw new Error(translate("canvas.agent.online.errors.unsupportedOpType"));
}

function requireRecordArray(value: unknown, field: string): Record<string, unknown>[] {
    if (!Array.isArray(value)) throw new Error(translate("canvas.agent.online.errors.fieldMustBeArray", { field }));
    return value.map((item) => {
        const record = objectDetail(item);
        if (!Object.keys(record).length) throw new Error(translate("canvas.agent.online.errors.fieldMustBeObjects", { field }));
        return record;
    });
}

function requireString(value: unknown, field: string) {
    if (typeof value !== "string" || !value) throw new Error(translate("canvas.agent.online.errors.fieldMustBeNonEmptyString", { field }));
    return value;
}

function requireNumber(value: unknown, field: string) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(translate("canvas.agent.online.errors.fieldMustBeNumber", { field }));
    return value;
}

function requireNodeType(value: unknown): CanvasNodeType {
    if (Object.values(CanvasNodeType).includes(value as CanvasNodeType)) return value as CanvasNodeType;
    throw new Error(translate("canvas.agent.online.errors.invalidNodeType"));
}

function requireViewport(value: unknown) {
    const item = objectDetail(value);
    return { x: requireNumber(item.x, "viewport.x"), y: requireNumber(item.y, "viewport.y"), k: requireNumber(item.k, "viewport.k") };
}

function recordOptional(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringOptional(value: unknown) {
    return typeof value === "string" ? value : "";
}

function numberOptional(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberOr(value: unknown, fallback: number) {
    return numberOptional(value) ?? fallback;
}

function nextCanvasX(snapshot: CanvasAgentSnapshot) {
    return snapshot.nodes.length ? Math.max(...snapshot.nodes.map((node) => node.position.x + node.width)) + 80 : 0;
}

function generationMode(value: unknown): "text" | "image" | "video" | "audio" {
    return value === "text" || value === "video" || value === "audio" ? value : "image";
}

function generationTitle(mode: "text" | "image" | "video" | "audio") {
    if (mode === "text") return translate("canvas.agent.online.generationText");
    if (mode === "video") return translate("canvas.agent.online.generationVideo");
    if (mode === "audio") return translate("canvas.agent.online.generationAudio");
    return translate("canvas.agent.online.generationImage");
}

function defaultGenerationModel(config: AiConfig, mode: "text" | "image" | "video" | "audio") {
    if (mode === "image") return config.imageModel || config.model;
    if (mode === "video") return config.videoModel || config.model;
    if (mode === "audio") return config.audioModel || config.model;
    return config.textModel || config.model;
}

function resolveGenerationModel(config: AiConfig, mode: "text" | "image" | "video" | "audio", model?: string) {
    const normalized = normalizeModelOptionValue(model, config.channels);
    return normalized && selectableModelsByCapability(config, mode).includes(normalized) ? normalized : defaultGenerationModel(config, mode);
}

function generationCount(value: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 1)));
}

function cleanRecord(value: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}

function snapshotSignature(snapshot: CanvasAgentSnapshot) {
    return JSON.stringify({ nodes: snapshot.nodes, connections: snapshot.connections, selectedNodeIds: snapshot.selectedNodeIds, viewport: snapshot.viewport });
}

function explainNoop(ops: CanvasAgentOp[], snapshot: CanvasAgentSnapshot) {
    if (!ops.length) return translate("canvas.agent.online.errors.noOpsReturned");
    const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
    const connectionIds = new Set(snapshot.connections.map((conn) => conn.id));
    const deleteConnectionOps = ops.filter((op): op is Extract<CanvasAgentOp, { type: "delete_connections" }> => op.type === "delete_connections");
    const connectOps = ops.filter((op): op is Extract<CanvasAgentOp, { type: "connect_nodes" }> => op.type === "connect_nodes");
    const deleteNodeOps = ops.filter((op): op is Extract<CanvasAgentOp, { type: "delete_node" }> => op.type === "delete_node");
    const updateOps = ops.filter((op): op is Extract<CanvasAgentOp, { type: "update_node" }> => op.type === "update_node");
    const selectOps = ops.filter((op): op is Extract<CanvasAgentOp, { type: "select_nodes" }> => op.type === "select_nodes");
    const generationOps = ops.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation");
    if (deleteConnectionOps.length && !snapshot.connections.length) return translate("canvas.agent.online.errors.noConnectionsToDelete");
    if (deleteConnectionOps.length && deleteConnectionOps.every((op) => !op.all && [...(op.ids || []), ...(op.id ? [op.id] : [])].every((id) => !connectionIds.has(id)))) return translate("canvas.agent.online.errors.connectionsNotFound");
    if (connectOps.length && connectOps.every((op) => snapshot.connections.some((conn) => conn.fromNodeId === op.fromNodeId && conn.toNodeId === op.toNodeId))) return translate("canvas.agent.online.errors.connectionsExist");
    if (connectOps.length && connectOps.every((op) => !nodeIds.has(op.fromNodeId) || !nodeIds.has(op.toNodeId))) return translate("canvas.agent.online.errors.nodesToConnectNotFound");
    if (deleteNodeOps.length && deleteNodeOps.every((op) => op.nodeType === CanvasNodeType.Config) && !snapshot.nodes.some((node) => node.type === CanvasNodeType.Config)) return translate("canvas.agent.online.errors.noConfigToDelete");
    if (deleteNodeOps.length && deleteNodeOps.every((op) => [...(op.ids || []), ...(op.id ? [op.id] : [])].every((id) => !nodeIds.has(id)))) return translate("canvas.agent.online.errors.nodesToDeleteNotFound");
    if (updateOps.length && updateOps.every((op) => !nodeIds.has(op.id))) return translate("canvas.agent.online.errors.nodesToUpdateNotFound");
    if (selectOps.length && selectOps.every((op) => !(op.ids || []).some((id) => nodeIds.has(id)))) return translate("canvas.agent.online.errors.nodesToSelectNotFound");
    if (generationOps.length && generationOps.every((op) => !nodeIds.has(op.nodeId))) return translate("canvas.agent.online.errors.nodesToGenerateNotFound");
    if (ops.every((op) => op.type === "set_viewport")) return translate("canvas.agent.online.errors.viewportAlreadySet");
    if (selectOps.length && selectOps.every((op) => JSON.stringify(op.ids || []) === JSON.stringify(snapshot.selectedNodeIds))) return translate("canvas.agent.online.errors.selectionAlreadySet");
    return translate("canvas.agent.online.errors.noopExecuted");
}

function nodeToReference(node: CanvasNodeData): CanvasAssistantReference | null {
    if (node.type === CanvasNodeType.Image && node.metadata?.content) {
        return { id: node.id, type: node.type, title: node.title, dataUrl: node.metadata.content, storageKey: node.metadata.storageKey };
    }
    if (node.type === CanvasNodeType.Text && node.metadata?.content) {
        return { id: node.id, type: node.type, title: node.title, text: node.metadata.content };
    }
    return null;
}

function buildAssistantReferences(nodes: CanvasNodeData[], selectedNodeIds: Set<string>) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return Array.from(selectedNodeIds)
        .map((id) => nodeById.get(id))
        .filter((node): node is CanvasNodeData => Boolean(node))
        .map(nodeToReference)
        .filter((item): item is CanvasAssistantReference => Boolean(item));
}

async function buildToolAgentMessages(snapshot: CanvasAgentSnapshot, history: CanvasAssistantMessage[], userMessage: CanvasAssistantMessage): Promise<ResponseInputMessage[]> {
    const refs = userMessage.references || [];
    return [
        { role: "system", content: ONLINE_AGENT_PROMPT },
        ...history
            .filter((message) => message.role === "user" || message.role === "assistant" || message.role === "system")
            .slice(-8)
            .map((message): ResponseInputMessage => ({ role: message.role as "system" | "user" | "assistant", content: message.text })),
        {
            role: "user",
            content: [
                ...refs.flatMap((item) => (item.text ? [{ type: "text" as const, text: translate("canvas.agent.online.selectedNodeText", { title: item.title, text: item.text }) }] : [])),
                { type: "text", text: translate("canvas.agent.online.canvasContext", { snapshot: JSON.stringify(compactSnapshot(snapshot)), message: userMessage.text }) },
                ...(await Promise.all(refs.filter((item) => item.dataUrl).map(async (item) => ({ type: "image_url" as const, image_url: { url: await imageToDataUrl(item) } })))),
            ],
        },
    ];
}

function compactSnapshot(snapshot: CanvasAgentSnapshot) {
    return {
        title: snapshot.title,
        viewport: snapshot.viewport,
        selectedNodeIds: snapshot.selectedNodeIds,
        nodes: snapshot.nodes.map((node) => ({
            id: node.id,
            type: node.type,
            title: node.title,
            position: node.position,
            width: node.width,
            height: node.height,
            metadata: compactMetadata(node.metadata || {}),
        })),
        connections: snapshot.connections,
    };
}

function compactMetadata(metadata: CanvasNodeData["metadata"]) {
    return {
        content: String(metadata?.content || "").slice(0, 500),
        prompt: String(metadata?.prompt || metadata?.composerContent || "").slice(0, 500),
        status: metadata?.status,
        generationMode: metadata?.generationMode,
        model: metadata?.model,
        size: metadata?.size,
    };
}

function createSession(): CanvasAssistantSession {
    const now = new Date().toISOString();
    return { id: nanoid(), title: translate("canvas.agent.history.untitledChat"), messages: [], createdAt: now, updatedAt: now };
}
