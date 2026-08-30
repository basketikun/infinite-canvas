import { useCallback, useEffect, useState } from "react";
import { App, Button, Input, Select } from "antd";
import { Activity, Circle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { createBroadcastSession, fetchCollaborationSessions, fetchExternalAgentActivities, fetchExternalAgents, type CollaborationSessionSummary } from "@/services/api/canvas-agent";
import { useAgentStore, type ExternalAgentActivity, type ExternalAgentRecord } from "@/stores/use-agent-store";

export function AgentConnectionsView({ agents, activities, theme, endpoint, token, connected }: { agents: ExternalAgentRecord[]; activities: ExternalAgentActivity[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; endpoint: string; token: string; connected: boolean }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const canvasContext = useAgentStore((state) => state.canvasContext);
    const [sessions, setSessions] = useState<CollaborationSessionSummary[]>([]);
    const [title, setTitle] = useState("");
    const [goal, setGoal] = useState("");
    const [targets, setTargets] = useState<Array<"codex" | "zcode" | "trae">>(["codex", "zcode", "trae"]);
    const [creating, setCreating] = useState(false);
    const load = useCallback(() => {
        if (!connected) return;
        void Promise.all([fetchCollaborationSessions(endpoint, token), fetchExternalAgents(endpoint, token), fetchExternalAgentActivities(endpoint, token)])
            .then(([sessionResult, agentResult, activityResult]) => {
                setSessions(sessionResult.data || []);
                setAgentState({ externalAgents: agentResult.data || [], agentActivities: activityResult.data || [] });
            })
            .catch(() => undefined);
    }, [connected, endpoint, setAgentState, token]);
    useEffect(() => {
        load();
        const timer = setInterval(load, 5000);
        return () => clearInterval(timer);
    }, [load]);
    const create = async () => {
        if (!title.trim() || !goal.trim() || !targets.length) return;
        setCreating(true);
        try {
            await createBroadcastSession(endpoint, token, { title: title.trim(), goal: goal.trim(), targetKinds: targets });
            setTitle("");
            setGoal("");
            load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("agent.collaboration.createFailed"));
        } finally {
            setCreating(false);
        }
    };
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <section>
                <h3 className="mb-2 text-xs font-medium" style={{ color: theme.node.muted }}>{t("agent.collaboration.connectedAgents")}</h3>
                <div className="divide-y" style={{ borderColor: theme.node.stroke }}>
                    {agents.length ? agents.map((agent) => (
                        <div key={agent.instanceId} className="flex min-h-11 items-center gap-3 py-2">
                            <Circle className="size-2.5 shrink-0" fill={agent.status === "offline" ? theme.node.muted : agent.status === "failed" ? "#dc2626" : "#16a34a"} stroke="none" />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">{agent.name}</div>
                                <div className="truncate text-xs" style={{ color: theme.node.muted }}>{agent.kind} · {t(`agent.collaboration.status.${agent.status}`)}</div>
                            </div>
                            {agent.currentTool ? <code className="max-w-36 truncate text-[11px]" style={{ color: theme.node.muted }}>{agent.currentTool}</code> : null}
                        </div>
                    )) : <div className="py-6 text-center text-sm" style={{ color: theme.node.muted }}>{t("agent.collaboration.noAgents")}</div>}
                </div>
            </section>
            <section className="mt-5">
                <h3 className="mb-2 text-xs font-medium" style={{ color: theme.node.muted }}>{t("agent.collaboration.broadcast")}</h3>
                <div className="space-y-2">
                    <Input size="small" value={title} maxLength={160} placeholder={t("agent.collaboration.titlePlaceholder")} onChange={(event) => setTitle(event.target.value)} />
                    <Input.TextArea value={goal} maxLength={20000} autoSize={{ minRows: 2, maxRows: 5 }} placeholder={t("agent.collaboration.goalPlaceholder")} onChange={(event) => setGoal(event.target.value)} />
                    <div className="flex gap-2">
                        <Select mode="multiple" size="small" className="min-w-0 flex-1" value={targets} options={["codex", "zcode", "trae"].map((value) => ({ value, label: value === "trae" ? "TraeCode" : value === "zcode" ? "ZCode" : "Codex" }))} onChange={setTargets} />
                        <Button size="small" type="text" disabled={!connected || !title.trim() || !goal.trim() || !targets.length} loading={creating} onClick={() => void create()}>{t("agent.collaboration.publish")}</Button>
                    </div>
                </div>
                <div className="mt-3 divide-y" style={{ borderColor: theme.node.stroke }}>
                    {sessions.map((session) => (
                        <div key={session.id} className="py-2 text-xs">
                            <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{session.title}</span><span style={{ color: theme.node.muted }}>{session.completedTaskCount}/{session.taskCount}</span></div>
                            <div className="mt-1 line-clamp-2" style={{ color: theme.node.muted }}>{session.goal}</div>
                            {session.results.map((result) => {
                                const write = collaborationWrite(result.data);
                                return <div key={`${result.taskId}:${result.agentInstanceId}`} className="mt-1 border-l-2 pl-2" style={{ borderColor: theme.node.stroke }}>
                                    <div><span className="font-medium">{result.agentName}</span><span style={{ color: theme.node.muted }}> · {result.summary}</span></div>
                                    {write && canvasContext ? <Button size="small" type="text" className="!px-0" onClick={() => {
                                        try {
                                            canvasContext.applyOps(write.ops, { projectId: write.projectId, baseRevision: write.baseRevision });
                                        } catch (error) {
                                            message.error(error instanceof Error ? error.message : t("agent.collaboration.applyFailed"));
                                        }
                                    }}>{t("agent.collaboration.apply")}</Button> : null}
                                </div>;
                            })}
                            <code className="mt-1 block truncate text-[10px]" style={{ color: theme.node.muted }}>{session.id}</code>
                        </div>
                    ))}
                </div>
            </section>
            <section className="mt-5">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}><Activity className="size-3.5" />{t("agent.collaboration.activity")}</h3>
                <div className="space-y-2">
                    {activities.slice(0, 50).map((item) => (
                        <div key={item.activityId} className="border-b py-2 text-xs" style={{ borderColor: theme.node.stroke }}>
                            <div className="flex items-center justify-between gap-2">
                                <span className="truncate font-medium">{item.agent.name} · {item.tool || item.mode}</span>
                                <span className="shrink-0" style={{ color: item.status === "failed" ? "#dc2626" : theme.node.muted }}>{t(`agent.collaboration.status.${item.status}`)}</span>
                            </div>
                            <div className="mt-1 tabular-nums" style={{ color: theme.node.muted }}>
                                {item.baseRevision ? `r${item.baseRevision}` : ""}{item.resultRevision ? ` → r${item.resultRevision}` : ""}{item.errorCode ? ` · ${item.errorCode}` : ""}
                            </div>
                        </div>
                    ))}
                    {!activities.length ? <div className="py-4 text-center text-sm" style={{ color: theme.node.muted }}>{t("agent.collaboration.noActivity")}</div> : null}
                </div>
            </section>
        </div>
    );
}

function collaborationWrite(value: unknown): { projectId: string; baseRevision: number; ops: CanvasAgentOp[] } | null {
    if (!value || typeof value !== "object") return null;
    const data = value as Record<string, unknown>;
    return typeof data.projectId === "string" && Number.isInteger(data.baseRevision) && Array.isArray(data.ops)
        ? { projectId: data.projectId, baseRevision: Number(data.baseRevision), ops: data.ops as CanvasAgentOp[] }
        : null;
}
