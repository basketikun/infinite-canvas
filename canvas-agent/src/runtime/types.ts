export type RuntimeTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type RuntimeTask = {
    id: string;
    kind: string;
    status: RuntimeTaskStatus;
    progress: number;
    input: Record<string, unknown>;
    params: Record<string, unknown>;
    result?: Record<string, unknown> | null;
    error?: string | null;
    createdAt: string;
    updatedAt: string;
};

export type RuntimeTaskEvent = {
    id: number;
    taskId: string;
    type: string;
    payload: Record<string, unknown>;
    createdAt: string;
};

export type GenerationLogStatus = "queued" | "running" | "success" | "failed" | "cancelled";

export type GenerationLog = {
    id: string;
    projectId: string;
    nodeId?: string;
    segmentId?: string;
    status: GenerationLogStatus;
    platform: string;
    workflow?: string;
    model?: string;
    taskMode?: string;
    prompt?: string;
    references: Array<Record<string, unknown>>;
    inputCounts: Record<string, number>;
    runtimeTaskId?: string;
    promptId?: string;
    startedAt: string;
    finishedAt?: string;
    durationMs: number;
    outputs: Array<Record<string, unknown>>;
    error?: string;
    params: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
};
