import type { JsonObject, RequestContext, RunTurnInput, RuntimeEventType } from "./types.js";
import type { ResearchStore } from "./store.js";

export type AdapterEvent = {
    type: Exclude<RuntimeEventType, "run.started" | "run.completed" | "run.failed" | "run.aborted">;
    itemId: string;
    payload: JsonObject;
};

export type RuntimeExecutionInput = {
    store: ResearchStore;
    ctx: RequestContext;
    conversationId: string;
    runId: string;
    prompt: string;
    signal: AbortSignal;
    emit: (event: AdapterEvent) => Promise<void>;
};

export interface RuntimeAdapter {
    execute(input: RuntimeExecutionInput): Promise<void>;
}

export interface AgentRuntime {
    runTurn(store: ResearchStore, ctx: RequestContext, input: RunTurnInput): Promise<{ runId: string }>;
    abort(store: ResearchStore, ctx: RequestContext, conversationId: string, runId: string): Promise<void>;
}
