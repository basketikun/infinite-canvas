import crypto from "node:crypto";

import type { ExternalAgentIdentity, ExternalAgentKind } from "../agent/identity.js";
import { CollaborationStore } from "./store.js";
import type { DispatchAdapter } from "./adapters/types.js";
import type { CollaborationMode, CollaborationRole, CollaborationSession, TaskEnvelope, TaskResult } from "./types.js";

const DEFAULT_LEASE_SECONDS = 90;

export class CollaborationCoordinator {
    constructor(private readonly store = new CollaborationStore(), private readonly onChange?: (payload: unknown) => void, private readonly adapters: Partial<Record<ExternalAgentKind, DispatchAdapter>> = {}) {}

    async handle(name: string, input: Record<string, unknown>, agent: ExternalAgentIdentity) {
        if (name === "collaboration_create_plan") return await this.createPlan(input, agent);
        if (name === "collaboration_join") return await this.join(text(input.sessionId), role(input.role), agent);
        if (name === "collaboration_leave") return await this.leave(text(input.sessionId), agent);
        if (name === "collaboration_list_tasks") return await this.listTasks(text(input.sessionId), agent);
        if (name === "collaboration_claim_task") return await this.claim(text(input.sessionId), text(input.taskId), Number(input.leaseSeconds) || DEFAULT_LEASE_SECONDS, agent);
        if (name === "collaboration_renew_claim") return await this.renew(text(input.sessionId), text(input.taskId), Number(input.leaseSeconds) || DEFAULT_LEASE_SECONDS, agent);
        if (name === "collaboration_submit_result") return await this.complete(text(input.sessionId), text(input.taskId), text(input.summary), input.data, false, agent);
        if (name === "collaboration_fail_task") return await this.complete(text(input.sessionId), text(input.taskId), text(input.error), undefined, true, agent);
        if (name === "collaboration_cancel_task") return await this.cancelTask(text(input.sessionId), text(input.taskId), agent);
        if (name === "collaboration_cancel_session") return await this.cancelSession(text(input.sessionId), agent);
        if (name === "collaboration_delegate_task") return await this.delegate(input, agent);
        if (name === "collaboration_get_results") return await this.getResults(text(input.sessionId), agent);
        if (name === "collaboration_complete_session") return await this.completeSession(text(input.sessionId), text(input.summary), agent);
        throw new Error(`未知协作工具：${name}`);
    }

    async listSessions() {
        const data = await this.store.read();
        return data.sessions.map(({ tasks, ...session }) => ({
            ...session,
            taskCount: tasks.length,
            completedTaskCount: tasks.filter((task) => task.status === "completed").length,
            results: tasks.flatMap((task) => task.results.map((result) => ({ taskId: task.id, taskTitle: task.title, agentName: result.agent.name, agentKind: result.agent.kind, agentInstanceId: result.agent.instanceId, status: result.status, summary: result.summary, data: result.data }))),
        }));
    }

    async modeFor(sessionId: string): Promise<CollaborationMode> {
        return findSession((await this.store.read()).sessions, sessionId).mode;
    }

    createFromWeb(input: Record<string, unknown>) {
        return this.createPlan({ ...input, mode: "broadcast" });
    }

    private async createPlan(input: Record<string, unknown>, agent?: ExternalAgentIdentity) {
        const session = await this.store.mutate((data) => {
            const now = Date.now();
            const mode = input.mode === "orchestrated" ? "orchestrated" : "broadcast";
            const session: CollaborationSession = {
                id: crypto.randomUUID(),
                title: limited(input.title, 160),
                goal: limited(input.goal, 20_000),
                mode,
                status: "open",
                coordinator: agent,
                members: agent ? [{ ...agent, role: mode === "orchestrated" ? "coordinator" : "worker", joinedAt: now, lastSeenAt: now }] : [],
                tasks: [],
                maxDepth: bounded(input.maxDepth, 1, 5, 2),
                maxTasks: bounded(input.maxTasks, 1, 100, 30),
                maxParallelClaims: bounded(input.maxParallelClaims, 1, 20, 6),
                createdAt: now,
                updatedAt: now,
            };
            const targets = kinds(input.targetKinds);
            if (mode === "broadcast") session.tasks.push(task(session.id, { title: session.title, instructions: session.goal, targetKinds: targets.length ? targets : ["codex", "zcode", "trae"], codexDispatch: input.codexDispatch === "active" ? "active" : "mailbox" }));
            data.sessions.push(session);
            this.changed(session);
            return session;
        });
        const codexTask = session.tasks.find((item) => item.codexDispatch === "active" && item.targetKinds.includes("codex"));
        if (codexTask) void this.dispatchActive(session.id, codexTask.id, "codex");
        return session;
    }

    private join(sessionId: string, memberRole: CollaborationRole, agent: ExternalAgentIdentity) {
        return this.store.mutate((data) => {
            const session = findSession(data.sessions, sessionId);
            assertOpen(session);
            const now = Date.now();
            session.members = [...session.members.filter((item) => item.instanceId !== agent.instanceId), { ...agent, role: memberRole, joinedAt: now, lastSeenAt: now }];
            session.updatedAt = now;
            this.changed(session);
            return session;
        });
    }

    private leave(sessionId: string, agent: ExternalAgentIdentity) {
        return this.store.mutate((data) => {
            const session = findSession(data.sessions, sessionId);
            session.members = session.members.filter((item) => item.instanceId !== agent.instanceId);
            session.tasks.forEach((item) => {
                item.claims = item.claims.filter((claim) => claim.agent.instanceId !== agent.instanceId);
                if (item.status === "claimed" && !item.claims.length) item.status = "open";
            });
            session.updatedAt = Date.now();
            this.changed(session);
            return { sessionId, left: true };
        });
    }

    private listTasks(sessionId: string, agent: ExternalAgentIdentity) {
        return this.store.mutate((data) => {
            const session = findSession(data.sessions, sessionId);
            touchMember(session, agent);
            expireClaims(session);
            return {
                sessionId,
                mode: session.mode,
                status: session.status,
                tasks: session.tasks.filter((item) => item.targetKinds.includes(agent.kind) && dependenciesMet(session, item) && !item.results.some((result) => result.agent.instanceId === agent.instanceId)),
            };
        });
    }

    private claim(sessionId: string, taskId: string, leaseSeconds: number, agent: ExternalAgentIdentity) {
        return this.store.mutate((data) => {
            const session = findSession(data.sessions, sessionId);
            assertOpen(session);
            touchMember(session, agent);
            expireClaims(session);
            const target = taskId ? findTask(session, taskId) : session.tasks.find((item) => item.status === "open" && item.targetKinds.includes(agent.kind) && dependenciesMet(session, item) && !item.results.some((result) => result.agent.instanceId === agent.instanceId));
            if (!target) throw new Error("当前没有可领取的协作任务");
            if (!target.targetKinds.includes(agent.kind)) throw new Error("该任务未分派给当前 Agent");
            if (!dependenciesMet(session, target)) throw new Error("任务依赖尚未完成");
            if (target.results.some((result) => result.agent.instanceId === agent.instanceId)) throw new Error("当前 Agent 已提交该任务");
            const existing = target.claims.find((item) => item.agent.instanceId === agent.instanceId);
            if (existing) return { task: target, claim: existing };
            if (target.status !== "open" && target.status !== "claimed") throw new Error("协作任务已结束");
            const activeClaims = session.tasks.flatMap((item) => item.claims).filter((item) => item.leaseUntil > Date.now()).length;
            if (activeClaims >= session.maxParallelClaims) throw new Error("协作会话已达到最大并行任务数");
            const attempt = (target.attempts[agent.instanceId] || 0) + 1;
            target.attempts[agent.instanceId] = attempt;
            const claim = { agent, attempt, claimedAt: Date.now(), leaseUntil: Date.now() + bounded(leaseSeconds, 15, 600, DEFAULT_LEASE_SECONDS) * 1000 };
            target.claims.push(claim);
            target.status = "claimed";
            target.updatedAt = Date.now();
            session.updatedAt = target.updatedAt;
            this.changed(session);
            return { task: target, claim };
        });
    }

    private renew(sessionId: string, taskId: string, leaseSeconds: number, agent: ExternalAgentIdentity) {
        return this.store.mutate((data) => {
            const session = findSession(data.sessions, sessionId);
            assertOpen(session);
            expireClaims(session);
            const target = findTask(session, taskId);
            const claim = target.claims.find((item) => item.agent.instanceId === agent.instanceId);
            if (!claim) throw new Error("当前 Agent 没有可续期的任务租约");
            claim.leaseUntil = Date.now() + bounded(leaseSeconds, 15, 600, DEFAULT_LEASE_SECONDS) * 1000;
            target.updatedAt = Date.now();
            session.updatedAt = target.updatedAt;
            this.changed(session);
            return claim;
        });
    }

    private complete(sessionId: string, taskId: string, summary: string, resultData: unknown, failed: boolean, agent: ExternalAgentIdentity) {
        return this.store.mutate((data) => {
            const session = findSession(data.sessions, sessionId);
            const target = findTask(session, taskId);
            const latest = [...target.results].reverse().find((item) => item.agent.instanceId === agent.instanceId);
            if (latest) return latest;
            assertOpen(session);
            expireClaims(session);
            const claim = target.claims.find((item) => item.agent.instanceId === agent.instanceId);
            if (!claim) throw new Error("当前 Agent 未领取该任务");
            const result: TaskResult = { agent, attempt: claim.attempt, status: failed ? "failed" : "completed", summary: limited(summary, 20_000), data: normalizeResultData(resultData), createdAt: Date.now() };
            target.results.push(result);
            target.claims = target.claims.filter((item) => item.agent.instanceId !== agent.instanceId);
            const settledKinds = new Set(target.results.map((item) => item.agent.kind));
            target.status = target.targetKinds.every((kind) => settledKinds.has(kind)) ? (target.results.some((item) => item.status === "completed") ? "completed" : "failed") : "open";
            target.updatedAt = Date.now();
            session.updatedAt = target.updatedAt;
            if (session.mode === "broadcast" && session.tasks.every((item) => item.status === "completed" || item.status === "failed" || item.status === "cancelled")) session.status = "completed";
            this.changed(session);
            return result;
        });
    }

    private async delegate(input: Record<string, unknown>, agent: ExternalAgentIdentity) {
        const next = await this.store.mutate((data) => {
            const session = findSession(data.sessions, text(input.sessionId));
            assertOpen(session);
            if (session.mode !== "orchestrated" || session.coordinator?.instanceId !== agent.instanceId) throw new Error("只有当前主 Agent 可以分派子任务");
            if (session.tasks.length >= session.maxTasks) throw new Error("协作会话已达到最大任务数");
            const parentTaskId = text(input.parentTaskId);
            const parent = parentTaskId ? findTask(session, parentTaskId) : undefined;
            const depth = (parent?.depth ?? -1) + 1;
            if (depth > session.maxDepth) throw new Error("子任务超过最大委派深度");
            const next = task(session.id, {
                parentTaskId: parent?.id,
                title: limited(input.title, 160),
                instructions: limited(input.instructions, 20_000),
                targetKinds: kinds(input.targetKinds),
                dependsOn: strings(input.dependsOn),
                depth,
                deadlineAt: Number(input.deadlineAt) || undefined,
                canvasProjectId: text(input.canvasProjectId) || undefined,
                canvasRevision: Number(input.canvasRevision) || undefined,
                codexDispatch: input.codexDispatch === "active" ? "active" : "mailbox",
            });
            if (!next.targetKinds.length) throw new Error("子任务至少需要一个目标 Agent");
            next.dependsOn.forEach((id) => findTask(session, id));
            session.tasks.push(next);
            session.updatedAt = Date.now();
            this.changed(session);
            return next;
        });
        if (next.codexDispatch === "active" && next.targetKinds.includes("codex")) void this.dispatchActive(next.sessionId, next.id, "codex");
        return next;
    }

    private getResults(sessionId: string, agent: ExternalAgentIdentity) {
        return this.store.mutate((data) => {
            const session = findSession(data.sessions, sessionId);
            touchMember(session, agent);
            return { sessionId, status: session.status, results: session.tasks.map(({ id, title, status, results }) => ({ taskId: id, title, status, results })) };
        });
    }

    private completeSession(sessionId: string, summary: string, agent: ExternalAgentIdentity) {
        return this.store.mutate((data) => {
            const session = findSession(data.sessions, sessionId);
            assertOpen(session);
            if (session.coordinator?.instanceId !== agent.instanceId) throw new Error("只有当前主 Agent 可以结束协作会话");
            if (session.tasks.some((item) => item.status === "open" || item.status === "claimed")) throw new Error("仍有未完成的协作任务");
            session.status = "completed";
            session.goal = summary ? `${session.goal}\n\n完成摘要：${limited(summary, 4000)}` : session.goal;
            session.updatedAt = Date.now();
            this.changed(session);
            return session;
        });
    }

    private async cancelTask(sessionId: string, taskId: string, agent: ExternalAgentIdentity) {
        const result = await this.store.mutate((data) => {
            const session = findSession(data.sessions, sessionId);
            assertOpen(session);
            assertCoordinator(session, agent);
            const target = findTask(session, taskId);
            const cancelled = cancelTaskTree(session, target.id);
            session.updatedAt = Date.now();
            this.changed(session);
            return { target, cancelled };
        });
        await this.interruptTasks(result.cancelled);
        return result.target;
    }

    private async cancelSession(sessionId: string, agent: ExternalAgentIdentity) {
        const result = await this.store.mutate((data) => {
            const session = findSession(data.sessions, sessionId);
            assertOpen(session);
            assertCoordinator(session, agent);
            const cancelled: TaskEnvelope[] = [];
            session.tasks.forEach((item) => {
                if (item.status === "open" || item.status === "claimed" || item.status === "draft") {
                    item.status = "cancelled";
                    item.claims = [];
                    item.updatedAt = Date.now();
                    cancelled.push(item);
                }
            });
            session.status = "cancelled";
            session.updatedAt = Date.now();
            this.changed(session);
            return { session, cancelled };
        });
        await this.interruptTasks(result.cancelled);
        return result.session;
    }

    private changed(session: CollaborationSession) {
        this.onChange?.({ sessionId: session.id, mode: session.mode, status: session.status, updatedAt: session.updatedAt });
    }

    private async interruptTasks(tasks: TaskEnvelope[]) {
        await Promise.all(tasks.map(async (task) => {
            if (task.codexDispatch !== "active") return;
            await Promise.all(task.targetKinds.map(async (kind) => {
                const adapter = this.adapters[kind];
                if (adapter?.capabilities.interrupt && adapter.status(task.id) === "running") await adapter.interrupt(task.id);
            }));
        }));
    }

    private async dispatchActive(sessionId: string, taskId: string, kind: ExternalAgentKind) {
        const adapter = this.adapters[kind];
        if (!adapter) return;
        const identity: ExternalAgentIdentity = { kind, name: `${kind === "codex" ? "Codex" : kind} Active`, instanceId: `active-${kind}` };
        try {
            await this.join(sessionId, "worker", identity);
            const claimed = await this.claim(sessionId, taskId, 600, identity) as { task: TaskEnvelope };
            const result = await adapter.dispatch(claimed.task);
            await this.complete(sessionId, taskId, result.summary, result.data, false, identity);
        } catch (error) {
            await this.complete(sessionId, taskId, error instanceof Error ? error.message : String(error), undefined, true, identity).catch(() => undefined);
        }
    }
}

function task(sessionId: string, value: Partial<TaskEnvelope> & Pick<TaskEnvelope, "title" | "instructions" | "targetKinds">): TaskEnvelope {
    const now = Date.now();
    return { ...value, id: crypto.randomUUID(), sessionId, title: value.title, instructions: value.instructions, targetKinds: value.targetKinds, dependsOn: value.dependsOn || [], depth: value.depth || 0, status: "open", claims: [], results: [], attempts: {}, createdAt: now, updatedAt: now };
}

function findSession(sessions: CollaborationSession[], id: string) {
    const session = sessions.find((item) => item.id === id);
    if (!session) throw new Error("协作会话不存在");
    return session;
}

function findTask(session: CollaborationSession, id: string) {
    const item = session.tasks.find((task) => task.id === id);
    if (!item) throw new Error("协作任务不存在");
    return item;
}

function assertOpen(session: CollaborationSession) {
    if (session.status !== "open") throw new Error("协作会话已结束");
}

function assertCoordinator(session: CollaborationSession, agent: ExternalAgentIdentity) {
    if (session.coordinator?.instanceId !== agent.instanceId) throw new Error("只有当前主 Agent 可以取消协作任务");
}

function cancelTaskTree(session: CollaborationSession, taskId: string, cancelled: TaskEnvelope[] = []) {
    const target = findTask(session, taskId);
    if (target.status === "open" || target.status === "claimed" || target.status === "draft") {
        target.status = "cancelled";
        target.claims = [];
        target.updatedAt = Date.now();
        cancelled.push(target);
    }
    session.tasks.filter((item) => item.parentTaskId === taskId).forEach((item) => cancelTaskTree(session, item.id, cancelled));
    return cancelled;
}

function touchMember(session: CollaborationSession, agent: ExternalAgentIdentity) {
    const member = session.members.find((item) => item.instanceId === agent.instanceId);
    if (!member) throw new Error("当前 Agent 尚未加入协作会话");
    member.lastSeenAt = Date.now();
}

function expireClaims(session: CollaborationSession) {
    const now = Date.now();
    session.tasks.forEach((item) => {
        const active = item.claims.filter((claim) => claim.leaseUntil > now);
        if (active.length !== item.claims.length) {
            item.claims = active;
            if (!active.length && item.status === "claimed") item.status = "open";
            item.updatedAt = now;
        }
    });
}

function dependenciesMet(session: CollaborationSession, task: TaskEnvelope) {
    return task.dependsOn.every((id) => findTask(session, id).status === "completed");
}

function kinds(value: unknown): ExternalAgentKind[] {
    return [...new Set(strings(value).filter((item): item is ExternalAgentKind => item === "codex" || item === "zcode" || item === "trae"))];
}

function strings(value: unknown) {
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function role(value: unknown): CollaborationRole {
    return value === "coordinator" ? "coordinator" : "worker";
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function limited(value: unknown, max: number) {
    return text(value).slice(0, max);
}

function normalizeResultData(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const data = value as Record<string, unknown>;
    if (!Array.isArray(data.ops)) return value;
    return {
        ...data,
        ops: data.ops.map((value) => {
            if (!value || typeof value !== "object" || Array.isArray(value)) return value;
            const op = value as Record<string, unknown>;
            return op.type === "add_node" || op.type === "connect_nodes" ? { ...op, id: String(op.id || crypto.randomUUID()) } : op;
        }),
    };
}

function bounded(value: unknown, min: number, max: number, fallback: number) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
