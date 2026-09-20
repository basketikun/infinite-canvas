import { useEffect, useRef, useState } from "react";
import { App, Button, Input, Modal, Switch } from "antd";
import { Archive, Bot, PanelRightClose, Plus, Send, Settings2, Square, Trash2 } from "lucide-react";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { canvasThemes } from "@/lib/canvas-theme";
import { hostedAgentApi, type HostedConversation, type HostedProjectSkill, type HostedRuntimeEvent } from "@/services/api/hosted-agent";
import { useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { hostedBrowserClientId, sanitizeHostedSnapshot, type useHostedAgentProject } from "./use-hosted-agent-project";

type HostedScope = ReturnType<typeof useHostedAgentProject>;
type ChatMessage = { id: string; role: "user" | "assistant"; text: string };
type PendingCanvasTool = { callId: string; summary: string; operations: CanvasAgentOp[] };

export function HostedAgentPanel({ scope }: { scope: HostedScope }) {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const closePanel = useAgentStore((state) => state.closePanel);
    const [conversations, setConversations] = useState<HostedConversation[]>([]);
    const [conversationId, setConversationId] = useState("");
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [prompt, setPrompt] = useState("");
    const [runId, setRunId] = useState("");
    const [pendingTool, setPendingTool] = useState<PendingCanvasTool | null>(null);
    const [initializing, setInitializing] = useState(false);
    const [streamError, setStreamError] = useState("");
    const [streamAttempt, setStreamAttempt] = useState(0);
    const [snapshotReady, setSnapshotReady] = useState(false);
    const [skillsOpen, setSkillsOpen] = useState(false);
    const [skills, setSkills] = useState<HostedProjectSkill[]>([]);
    const [skillName, setSkillName] = useState("");
    const [editingSkillName, setEditingSkillName] = useState("");
    const [skillDefinition, setSkillDefinition] = useState("");
    const [skillEnabled, setSkillEnabled] = useState(true);
    const [savingSkill, setSavingSkill] = useState(false);
    const sequenceRef = useRef(0);
    const protocolErrorRef = useRef(false);
    const conversationLoadRef = useRef<{ key: string; promise: Promise<{ items: HostedConversation[]; next: HostedConversation }> } | null>(null);
    const projectId = scope.project?.agentProjectId || "";

    useEffect(() => {
        if (!scope.enabled || !scope.token || !projectId) return;
        const key = `${scope.token}:${projectId}`;
        let load = conversationLoadRef.current?.key === key ? conversationLoadRef.current.promise : null;
        if (!load) {
            load = hostedAgentApi.listConversations(scope.token, projectId).then(async (items) => ({
                items,
                next: items.find((item) => item.status === "active") || await hostedAgentApi.createConversation(scope.token!, projectId),
            }));
            conversationLoadRef.current = { key, promise: load };
        }
        let current = true;
        setInitializing(true);
        void load.then(({ items, next }) => {
            if (!current) return;
            setConversations(items.some((item) => item.id === next.id) ? items : [next, ...items]);
            setConversationId(next.id);
        }).catch((error) => {
            if (conversationLoadRef.current?.key === key) conversationLoadRef.current = null;
            if (current) message.error(error instanceof Error ? error.message : "读取对话失败");
        }).finally(() => {
            if (current) setInitializing(false);
        });
        return () => { current = false; };
    }, [message, projectId, scope.enabled, scope.token]);

    useEffect(() => {
        sequenceRef.current = 0;
        protocolErrorRef.current = false;
        setMessages([]);
        setRunId("");
        setPendingTool(null);
        setStreamError("");
        setSnapshotReady(false);
        if (!scope.token || !projectId || !conversationId) return;
        let current = true;
        void hostedAgentApi.readConversation(scope.token, projectId, conversationId).then((snapshot) => {
            if (!current) return;
            snapshot.events.forEach(consumeEvent);
            setSnapshotReady(true);
        }).catch((error) => {
            if (!current) return;
            setStreamError(error instanceof Error ? error.message : "读取对话历史失败");
        });
        return () => { current = false; };
    }, [conversationId, projectId, scope.token]);

    useEffect(() => {
        if (!snapshotReady || !scope.token || !projectId || !conversationId) return;
        const controller = new AbortController();
        setStreamError("");
        void hostedAgentApi.streamEvents(scope.token, projectId, conversationId, sequenceRef.current, controller.signal, consumeEvent).then(() => {
            if (!controller.signal.aborted) setStreamError("事件连接已结束");
        }).catch((error) => {
            if (!controller.signal.aborted) setStreamError(error instanceof Error ? error.message : "Agent 事件连接失败");
        });
        return () => controller.abort();
    }, [conversationId, projectId, scope.token, snapshotReady, streamAttempt]);

    useEffect(() => {
        if (!skillsOpen || !scope.token || !projectId) return;
        void hostedAgentApi.listSkills(scope.token, projectId).then(setSkills).catch((error) => message.error(error instanceof Error ? error.message : "读取 Project Skill 失败"));
    }, [message, projectId, scope.token, skillsOpen]);

    function consumeEvent(event: HostedRuntimeEvent) {
        if (event.protocolVersion !== 1) {
            if (!protocolErrorRef.current) message.error("Agent 通信协议版本不兼容，已停止合并事件");
            protocolErrorRef.current = true;
            return;
        }
        if (event.sequence <= sequenceRef.current) return;
        sequenceRef.current = event.sequence;
        if (event.type === "run.started") {
            const text = typeof event.payload.prompt === "string" ? event.payload.prompt : "";
            if (text) setMessages((items) => upsert(items, { id: `${event.runId}:user`, role: "user", text }));
            setRunId(event.runId);
        } else if (event.type === "assistant.delta") {
            const delta = typeof event.payload.delta === "string" ? event.payload.delta : "";
            setMessages((items) => appendAssistant(items, event.itemId, delta));
        } else if (event.type === "assistant.completed") {
            const text = typeof event.payload.text === "string" ? event.payload.text : "";
            setMessages((items) => upsert(items, { id: event.itemId, role: "assistant", text }));
        } else if (event.type === "canvas.tool.requested") {
            setPendingTool({
                callId: String(event.payload.callId || event.itemId),
                summary: String(event.payload.summary || "Agent 请求修改当前画布"),
                operations: Array.isArray(event.payload.operations) ? event.payload.operations as CanvasAgentOp[] : [],
            });
        } else if (event.type === "tool.completed") {
            setPendingTool(null);
        } else if (event.type === "run.completed" || event.type === "run.failed" || event.type === "run.aborted") {
            setRunId((current) => current === event.runId ? "" : current);
            setPendingTool(null);
            if (event.type === "run.failed") message.error(String(event.payload.message || "Agent 运行失败"));
        }
    }

    const archiveConversation = async () => {
        if (!scope.token || !projectId || !conversationId || runId) return;
        try {
            await hostedAgentApi.archiveConversation(scope.token, projectId, conversationId);
            const archived = conversations.map((item) => item.id === conversationId ? { ...item, status: "archived" as const } : item);
            let next = archived.find((item) => item.status === "active");
            if (!next) {
                next = await hostedAgentApi.createConversation(scope.token, projectId);
                archived.unshift(next);
            }
            setConversations(archived);
            setConversationId(next.id);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "归档对话失败");
        }
    };

    const editSkill = (skill?: HostedProjectSkill) => {
        setSkillName(skill?.name || "");
        setEditingSkillName(skill?.name || "");
        setSkillDefinition(skill?.definition || "");
        setSkillEnabled(skill?.enabled ?? true);
    };

    const saveSkill = async () => {
        if (!scope.token || !projectId || !skillName.trim() || !skillDefinition.trim()) return;
        setSavingSkill(true);
        try {
            const saved = await hostedAgentApi.saveSkill(scope.token, projectId, { name: skillName.trim(), definition: skillDefinition.trim(), enabled: skillEnabled });
            setSkills((items) => [saved, ...items.filter((item) => item.id !== saved.id)].sort((left, right) => left.name.localeCompare(right.name)));
            editSkill();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存 Project Skill 失败");
        } finally {
            setSavingSkill(false);
        }
    };

    const deleteSkill = async (skill: HostedProjectSkill) => {
        if (!scope.token || !projectId) return;
        try {
            await hostedAgentApi.deleteSkill(scope.token, projectId, skill.name);
            setSkills((items) => items.filter((item) => item.id !== skill.id));
            if (skillName === skill.name) editSkill();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除 Project Skill 失败");
        }
    };

    const createConversation = async () => {
        if (!scope.token || !projectId) return;
        try {
            const created = await hostedAgentApi.createConversation(scope.token, projectId);
            setConversations((items) => [created, ...items]);
            setConversationId(created.id);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "新建对话失败");
        }
    };

    const send = async () => {
        const text = prompt.trim();
        if (!text || !scope.token || !projectId || !conversationId || runId) return;
        setPrompt("");
        try {
            const run = await hostedAgentApi.runTurn(scope.token, projectId, conversationId, text);
            setRunId(run.runId);
        } catch (error) {
            setPrompt(text);
            message.error(error instanceof Error ? error.message : "发送失败");
        }
    };

    const completeTool = async (approved: boolean) => {
        if (!pendingTool || !scope.token || !projectId) return;
        try {
            const applied = approved ? scope.canvasContext?.applyOps(pendingTool.operations) : null;
            const revision = (scope.project?.agentRevision || 0) + 1;
            await hostedAgentApi.completeCanvasTool(scope.token, projectId, {
                callId: pendingTool.callId,
                ...(applied ? { clientId: hostedBrowserClientId(), revision, snapshot: sanitizeHostedSnapshot(applied) } : {}),
                result: approved ? { approved: true, applied: Boolean(applied), revision: applied ? revision : undefined } : { approved: false, error: "user_rejected" },
            });
            setPendingTool(null);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "画布操作失败");
        }
    };

    const stop = async () => {
        if (!scope.token || !projectId || !conversationId || !runId) return;
        try {
            await hostedAgentApi.abort(scope.token, projectId, conversationId, runId);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "停止失败");
        }
    };

    return (
        <div className="flex h-full min-h-0 flex-col" style={{ color: theme.node.text }}>
            <div className="flex h-16 shrink-0 items-center gap-2 border-b px-3" style={{ borderColor: theme.node.stroke }}>
                <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: theme.toolbar.itemHover }}><Bot className="size-4" /></span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">Project Agent</span>
                    <span className="mt-0.5 block truncate text-[11px]" style={{ color: theme.node.muted }}>Pi · 当前研究项目</span>
                </span>
                <button type="button" className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10" onClick={() => setSkillsOpen(true)} title="Project Skills"><Settings2 className="size-4" /></button>
                <button type="button" className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30" disabled={!conversationId || Boolean(runId) || conversations.find((item) => item.id === conversationId)?.status === "archived"} onClick={() => void archiveConversation()} title="归档当前对话"><Archive className="size-4" /></button>
                <button type="button" className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10" onClick={() => void createConversation()} title="新对话"><Plus className="size-4" /></button>
                <button type="button" className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10" onClick={closePanel} title="收起"><PanelRightClose className="size-4" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                {!scope.enabled || initializing ? <div className="text-sm opacity-60">正在绑定当前 Project 与独立 Canvas Workspace… {!initializing && !scope.binding ? <button type="button" className="underline" onClick={scope.retryBinding}>重试</button> : null}</div> : null}
                {conversations.length > 1 ? (
                    <select className="w-full bg-transparent p-1 text-sm" value={conversationId} onChange={(event) => setConversationId(event.target.value)}>
                        {conversations.map((item) => <option key={item.id} value={item.id}>{item.status === "archived" ? `[已归档] ${item.title}` : item.title}</option>)}
                    </select>
                ) : null}
                {messages.map((item) => (
                    <div key={item.id} className={`max-w-[92%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${item.role === "user" ? "ml-auto bg-black/5 dark:bg-white/10" : "mr-auto"}`}>{item.text}</div>
                ))}
                {streamError ? <div className="text-sm opacity-60">{streamError} <button type="button" className="underline" onClick={() => setStreamAttempt((value) => value + 1)}>按序号重新连接</button></div> : null}
                {pendingTool ? (
                    <div className="border-l-2 pl-3 text-sm" style={{ borderColor: theme.node.stroke }}>
                        <div className="mb-2 font-medium">{pendingTool.summary}</div>
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs opacity-70">{JSON.stringify(pendingTool.operations, null, 2)}</pre>
                        <div className="mt-2 flex justify-end gap-2"><Button size="small" onClick={() => void completeTool(false)}>拒绝</Button><Button size="small" type="primary" disabled={!scope.canvasContext} onClick={() => void completeTool(true)}>确认执行</Button></div>
                    </div>
                ) : null}
            </div>
            <div className="px-3 pb-3 pt-2">
                <div className="rounded-[22px] border p-3 backdrop-blur-xl" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, boxShadow: "0 16px 40px rgba(0,0,0,.10)" }}>
                    <Input.TextArea variant="borderless" className="!bg-transparent !p-0" value={prompt} onChange={(event) => setPrompt(event.target.value)} autoSize={{ minRows: 3, maxRows: 8 }} placeholder="询问当前 Project 的 Pi Agent" onPressEnter={(event) => {
                        if (!event.shiftKey) { event.preventDefault(); void send(); }
                    }} />
                    <div className="mt-2 flex justify-end">
                        {runId ? <Button type="text" shape="circle" icon={<Square className="size-3.5" />} onClick={() => void stop()} aria-label="停止" /> : <Button type="primary" shape="circle" icon={<Send className="size-4" />} disabled={!scope.enabled || !snapshotReady || !conversationId || conversations.find((item) => item.id === conversationId)?.status === "archived" || !prompt.trim()} onClick={() => void send()} aria-label="发送" />}
                    </div>
                </div>
            </div>
            <Modal title="Project Skills" open={skillsOpen} onCancel={() => setSkillsOpen(false)} footer={null} destroyOnHidden>
                <div className="space-y-3">
                    <div className="max-h-44 space-y-1 overflow-y-auto">
                        {skills.map((skill) => (
                            <div key={skill.id} className="flex items-center gap-2 py-1 text-sm">
                                <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => editSkill(skill)}>{skill.name}</button>
                                <Switch size="small" checked={skill.enabled} onChange={(enabled) => void hostedAgentApi.saveSkill(scope.token!, projectId, { name: skill.name, definition: skill.definition, enabled }).then((saved) => setSkills((items) => items.map((item) => item.id === saved.id ? saved : item))).catch((error) => message.error(error instanceof Error ? error.message : "更新 Project Skill 失败"))} />
                                <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => void deleteSkill(skill)} />
                            </div>
                        ))}
                    </div>
                    <Input value={skillName} disabled={Boolean(editingSkillName)} onChange={(event) => setSkillName(event.target.value)} placeholder="Skill 名称" />
                    <Input.TextArea value={skillDefinition} onChange={(event) => setSkillDefinition(event.target.value)} autoSize={{ minRows: 4, maxRows: 10 }} placeholder="仅注入当前 Project 的 Skill 定义" />
                    <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-sm"><Switch size="small" checked={skillEnabled} onChange={setSkillEnabled} />启用</label>
                        <div className="flex gap-2"><Button onClick={() => editSkill()}>清空</Button><Button type="primary" loading={savingSkill} disabled={!skillName.trim() || !skillDefinition.trim()} onClick={() => void saveSkill()}>保存</Button></div>
                    </div>
                </div>
            </Modal>
        </div>
    );
}

function upsert(items: ChatMessage[], next: ChatMessage) {
    const index = items.findIndex((item) => item.id === next.id);
    return index < 0 ? [...items, next] : items.map((item, itemIndex) => itemIndex === index ? next : item);
}

function appendAssistant(items: ChatMessage[], id: string, delta: string) {
    const current = items.find((item) => item.id === id);
    return upsert(items, { id, role: "assistant", text: `${current?.text || ""}${delta}` });
}
