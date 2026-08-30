import type { TaskEnvelope } from "../types.js";

export type DispatchResult = { summary: string; data?: unknown };

export interface DispatchAdapter {
    readonly capabilities: { streaming: boolean; interrupt: boolean };
    dispatch(task: TaskEnvelope): Promise<DispatchResult>;
    interrupt(taskId: string): Promise<boolean>;
    status(taskId: string): "idle" | "running";
}
