import { interruptCodexTurn, runCodexTurn, startCodexThread } from "../../agent/codex.js";
import type { AgentEmit } from "../../agent/types.js";
import type { DispatchAdapter, DispatchResult } from "./types.js";
import type { TaskEnvelope } from "../types.js";

export class CodexDispatchAdapter implements DispatchAdapter {
    readonly capabilities = { streaming: true, interrupt: true };
    private active = new Map<string, string>();
    private cancelled = new Set<string>();

    constructor(private readonly emit: AgentEmit, private readonly cwd: () => string) {}

    async dispatch(task: TaskEnvelope): Promise<DispatchResult> {
        this.active.set(task.id, "");
        try {
            const thread = await startCodexThread(this.emit, this.cwd(), "request", true);
            const threadId = String((thread as Record<string, unknown>).id || "");
            if (!threadId) throw new Error("Codex 主动调度未能创建线程");
            this.active.set(task.id, threadId);
            if (this.cancelled.has(task.id)) {
                await interruptCodexTurn(threadId);
                throw new Error("Codex 主动调度任务已取消");
            }
            let summary = "";
            const collect: AgentEmit = (type, payload) => {
                this.emit(type, payload);
                const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
                const item = value.item && typeof value.item === "object" ? value.item as Record<string, unknown> : {};
                if (type === "agent_event" && (item.type === "agent_message" || item.type === "agentMessage") && typeof item.text === "string") summary = item.text;
            };
            await runCodexTurn(`${task.title}\n\n${task.instructions}`, collect, [], { threadId, cwd: this.cwd(), permissionMode: "request" });
            return { summary: summary || "Codex 已完成主动调度任务", data: { threadId } };
        } finally {
            this.active.delete(task.id);
            this.cancelled.delete(task.id);
        }
    }

    async interrupt(taskId: string) {
        if (!this.active.has(taskId)) return false;
        this.cancelled.add(taskId);
        const threadId = this.active.get(taskId);
        return threadId ? await interruptCodexTurn(threadId) : true;
    }

    status(taskId: string) {
        return this.active.has(taskId) ? "running" as const : "idle" as const;
    }
}
