import type { AgentAttachment, AgentEmit, AgentPermissionMode } from "./types.js";

export type AgentAdapterCapabilities = {
    threads: boolean;
    streaming: boolean;
    history: boolean;
    approvals: boolean;
    models: boolean;
    skills: boolean;
    attachments: boolean;
    interrupt: boolean;
};

export type AgentTurnInput = {
    prompt: string;
    threadId?: string;
    cwd: string;
    attachments?: AgentAttachment[];
    permissionMode?: AgentPermissionMode;
    model?: string;
};

export interface AgentAdapter {
    readonly kind: string;
    readonly capabilities: AgentAdapterCapabilities;
    runTurn(input: AgentTurnInput, emit: AgentEmit): Promise<void>;
    interrupt(threadId?: string): Promise<boolean>;
}
