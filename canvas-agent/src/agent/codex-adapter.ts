import type { AgentAdapter, AgentTurnInput } from "./adapter.js";
import { interruptCodexTurn, runCodexTurn } from "./codex.js";
import type { AgentEmit } from "./types.js";

export class CodexAgentAdapter implements AgentAdapter {
    readonly kind = "codex";
    readonly capabilities = {
        threads: true,
        streaming: true,
        history: true,
        approvals: true,
        models: true,
        skills: true,
        attachments: true,
        interrupt: true,
    };

    async runTurn(input: AgentTurnInput, emit: AgentEmit) {
        await runCodexTurn(input.prompt, emit, input.attachments || [], {
            threadId: input.threadId,
            cwd: input.cwd,
            permissionMode: input.permissionMode,
            model: input.model,
        });
    }

    interrupt(threadId?: string) {
        return interruptCodexTurn(threadId);
    }
}
