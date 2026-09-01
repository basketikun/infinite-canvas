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
