import type { ModelMessage } from "ai";
import type { AgentTokenUsage } from "@workbench/lib/agent/agent-chat-usage";
import { storage } from "@workbench/services/storage/runtime";
import type { ReferenceImage } from "@workbench/types/image";
import { notifyCreateSessionsChanged } from "@workbench/lib/create-sessions-events";
import type { CreateSession } from "@workbench/services/create/logs";

export type CreateAgentItem =
    | { id: string; role: "user"; text: string; createdAt: number }
    | { id: string; role: "assistant"; text: string; reasoning?: string; status: "running" | "done" | "failed"; usage?: AgentTokenUsage; createdAt: number }
    | { id: string; role: "tool"; toolName: string; input: unknown; output?: string; status: "running" | "waiting" | "generating" | "done" | "failed" | "rejected"; createdAt: number; logId?: string; references?: ReferenceImage[] }
    | { id: string; role: "notice"; text: string; usage?: AgentTokenUsage; createdAt: number }
    | { id: string; role: "error"; text: string; createdAt: number };

export type CreateAgentThread = {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    items: CreateAgentItem[];
    messages: ModelMessage[];
    /** 最近一次模型请求后的上下文用量，用于在 80% 时触发压缩。 */
    contextTokens?: number;
};

const sessionSummaries = new Map<string, string>();

function sessionSummary(thread: CreateAgentThread) {
    return `${thread.title}\n${thread.items.filter((item) => item.role === "user").length}`;
}

export async function readAgentThreads(signal?: AbortSignal) {
    const threads: CreateAgentThread[] = [];
    await storage.agentRecords.iterate<CreateAgentThread, void>((thread) => {
        if (!thread?.id || !Array.isArray(thread.items)) return;
        // 刷新后仍在进行的会话无法恢复，保留已完成内容并标记中断的步骤。
        threads.push({
            ...thread,
            items: thread.items.map((item) => item.role === "assistant" && item.status === "running" ? { ...item, status: "failed" as const } : item.role === "tool" && (item.status === "running" || item.status === "generating") ? { ...item, status: (item.logId ? "done" : "failed") as "done" | "failed" } : item),
        });
    });
    signal?.throwIfAborted();
    return threads.sort((left, right) => right.updatedAt - left.updatedAt);
}

export function saveAgentThread(thread: CreateAgentThread) {
    return storage.agentRecords.setItem(thread.id, thread).then((value) => {
        const summary = sessionSummary(thread);
        if (sessionSummaries.get(thread.id) !== summary) {
            sessionSummaries.set(thread.id, summary);
            notifyCreateSessionsChanged();
        }
        return value;
    });
}

export function deleteAgentThread(id: string) {
    sessionSummaries.delete(id);
    return storage.agentRecords.removeItem(id).then(() => { notifyCreateSessionsChanged(); });
}

export function agentSession(thread: CreateAgentThread): CreateSession {
    return { id: thread.id, title: thread.title || "新对话", count: thread.items.filter((item) => item.role === "user").length, updatedAt: thread.updatedAt };
}

/** 会话标题取首条用户消息，保持和生成记录一致。 */
export function agentTitle(prompt: string) {
    return prompt.slice(0, 18) || "未命名";
}
