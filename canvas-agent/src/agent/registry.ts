import crypto from "node:crypto";

import type { ExternalAgentIdentity } from "./identity.js";

export type ExternalAgentMode = "independent" | "broadcast" | "orchestrated";
export type ExternalAgentStatus = "connected" | "idle" | "waiting" | "running" | "approval" | "completed" | "failed" | "offline";
export type ExternalAgentRecord = ExternalAgentIdentity & {
    status: ExternalAgentStatus;
    mode: ExternalAgentMode;
    currentTool?: string;
    connectedAt: number;
    lastSeenAt: number;
};
export type ExternalAgentActivity = {
    activityId: string;
    agent: ExternalAgentIdentity;
    mode: ExternalAgentMode;
    status: ExternalAgentStatus;
    tool?: string;
    projectId?: string;
    baseRevision?: number;
    resultRevision?: number;
    errorCode?: string;
    startedAt: number;
    updatedAt: number;
};

const DEFAULT_TTL_MS = 45_000;
const MAX_ACTIVITIES = 200;

export class AgentRegistry {
    private agents = new Map<string, ExternalAgentRecord>();
    private activities: ExternalAgentActivity[] = [];

    constructor(private readonly onChange: (type: "agents_changed" | "agent_activity", payload: unknown) => void, private readonly ttlMs = DEFAULT_TTL_MS) {}

    touch(identity: ExternalAgentIdentity, patch: Partial<Pick<ExternalAgentRecord, "status" | "mode" | "currentTool">> = {}) {
        const now = Date.now();
        const current = this.agents.get(identity.instanceId);
        const next: ExternalAgentRecord = {
            ...identity,
            status: patch.status || (current?.status === "offline" ? "idle" : current?.status) || "idle",
            mode: patch.mode || current?.mode || "independent",
            currentTool: Object.prototype.hasOwnProperty.call(patch, "currentTool") ? patch.currentTool : current?.currentTool,
            connectedAt: !current || current.status === "offline" ? now : current.connectedAt,
            lastSeenAt: now,
        };
        this.agents.set(identity.instanceId, next);
        this.onChange("agents_changed", this.snapshot());
        return next;
    }

    begin(identity: ExternalAgentIdentity, tool: string, mode: ExternalAgentMode = "independent", baseRevision?: number, projectId?: string) {
        this.expire();
        this.touch(identity, { status: "running", mode, currentTool: tool });
        const now = Date.now();
        const activity: ExternalAgentActivity = {
            activityId: crypto.randomUUID(),
            agent: identity,
            mode,
            status: "running",
            tool,
            projectId,
            baseRevision,
            startedAt: now,
            updatedAt: now,
        };
        this.activities.push(activity);
        this.trim();
        this.onChange("agent_activity", activity);
        return activity;
    }

    approval(activityId: string) {
        this.update(activityId, { status: "approval" });
    }

    finish(activityId: string, result: { resultRevision?: number; errorCode?: string } = {}) {
        const status: ExternalAgentStatus = result.errorCode ? "failed" : "completed";
        const activity = this.update(activityId, { ...result, status });
        if (activity) {
            const active = [...this.activities].reverse().find((item) =>
                item.activityId !== activityId
                && item.agent.instanceId === activity.agent.instanceId
                && (item.status === "running" || item.status === "waiting" || item.status === "approval"));
            this.touch(activity.agent, active ? { status: active.status, mode: active.mode, currentTool: active.tool } : { status: "idle", currentTool: undefined });
        }
    }

    unregister(identity: ExternalAgentIdentity) {
        const current = this.agents.get(identity.instanceId);
        if (!current) return;
        this.agents.set(identity.instanceId, { ...current, status: "offline", currentTool: undefined, lastSeenAt: Date.now() });
        this.onChange("agents_changed", this.snapshot());
    }

    snapshot() {
        this.expire();
        return [...this.agents.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    }

    activitySnapshot() {
        return [...this.activities];
    }

    private update(activityId: string, patch: Partial<ExternalAgentActivity>) {
        const index = this.activities.findIndex((item) => item.activityId === activityId);
        if (index < 0) return undefined;
        const next = { ...this.activities[index], ...patch, updatedAt: Date.now() };
        this.activities[index] = next;
        this.onChange("agent_activity", next);
        return next;
    }

    private expire() {
        const now = Date.now();
        let changed = false;
        this.agents.forEach((agent, id) => {
            if (agent.status !== "offline" && now - agent.lastSeenAt > this.ttlMs) {
                this.agents.set(id, { ...agent, status: "offline", currentTool: undefined });
                changed = true;
            }
        });
        if (changed) this.onChange("agents_changed", [...this.agents.values()]);
    }

    private trim() {
        if (this.activities.length > MAX_ACTIVITIES) this.activities.splice(0, this.activities.length - MAX_ACTIVITIES);
    }
}
