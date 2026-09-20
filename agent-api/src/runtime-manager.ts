import { AppError } from "./errors.js";
import { EventHub } from "./event-hub.js";
import type { AgentRuntime, RuntimeAdapter } from "./runtime.js";
import type { ResearchStore } from "./store.js";
import { AGENT_PROTOCOL_VERSION, type NewRuntimeEvent, type RequestContext, type RuntimeEventType } from "./types.js";

export class RuntimeManager implements AgentRuntime {
    private readonly active = new Map<string, AbortController>();

    constructor(private readonly adapter: RuntimeAdapter, private readonly hub: EventHub) {}

    async runTurn(store: ResearchStore, ctx: RequestContext, input: { conversationId: string; prompt: string }) {
        const prompt = input.prompt.trim();
        if (!prompt) throw new AppError("消息不能为空", 400, "prompt_required");
        const conversation = await store.readConversation(ctx, input.conversationId);
        if (conversation.status !== "active") throw new AppError("对话已归档", 409, "conversation_archived");
        const run = await store.beginRun(ctx, input.conversationId);
        const controller = new AbortController();
        this.active.set(run.id, controller);
        try {
            await this.emit(store, ctx, input.conversationId, run.id, "run.started", run.id, { prompt });
        } catch (error) {
            this.active.delete(run.id);
            await store.finishRun(ctx, run.id, "failed").catch(() => {});
            throw error;
        }
        void this.execute(store, ctx, input.conversationId, run.id, prompt, controller);
        return { runId: run.id };
    }

    async abort(store: ResearchStore, ctx: RequestContext, conversationId: string, runId: string) {
        const run = await store.readRun(ctx, conversationId, runId);
        if (run.status !== "running") throw new AppError("运行已经结束", 409, "run_not_active");
        const controller = this.active.get(runId);
        if (!controller) throw new AppError("运行不在当前 Agent 实例中", 409, "run_not_on_instance");
        controller.abort();
    }

    private async execute(store: ResearchStore, ctx: RequestContext, conversationId: string, runId: string, prompt: string, controller: AbortController) {
        let status: "completed" | "failed" | "aborted" = "completed";
        let payload: Record<string, unknown> = {};
        try {
            await this.adapter.execute({
                ctx,
                store,
                conversationId,
                runId,
                prompt,
                signal: controller.signal,
                emit: (event) => this.emit(store, ctx, conversationId, runId, event.type, event.itemId, event.payload),
            });
            if (controller.signal.aborted) status = "aborted";
        } catch {
            status = controller.signal.aborted ? "aborted" : "failed";
            if (status === "failed") payload = { message: "Agent 运行失败" };
        }
        try {
            await this.finish(store, ctx, conversationId, runId, status, payload);
        } catch {
            console.error("Failed to persist Agent run terminal state");
        } finally {
            this.active.delete(runId);
        }
    }

    private async finish(store: ResearchStore, ctx: RequestContext, conversationId: string, runId: string, status: "completed" | "failed" | "aborted", payload: Record<string, unknown>) {
        await store.finishRun(ctx, runId, status);
        await this.emit(store, ctx, conversationId, runId, `run.${status}` as RuntimeEventType, runId, payload);
    }

    private async emit(store: ResearchStore, ctx: RequestContext, conversationId: string, runId: string, type: RuntimeEventType, itemId: string, payload: Record<string, unknown>) {
        const event: NewRuntimeEvent = {
            protocolVersion: AGENT_PROTOCOL_VERSION,
            type,
            projectId: ctx.projectId,
            canvasWorkspaceId: ctx.canvasWorkspaceId,
            conversationId,
            threadId: conversationId,
            runId,
            turnId: runId,
            itemId,
            payload,
        };
        const saved = await store.appendEvent(ctx, event);
        this.hub.publish(saved);
    }
}
