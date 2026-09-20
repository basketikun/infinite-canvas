import { AGENT_API_URL } from "@/constant/runtime-config";

const baseUrl = AGENT_API_URL.replace(/\/$/, "");

export type HostedProject = { id: string; ownerUserId: string; name: string; canvasWorkspaceId: string; createdAt: string; updatedAt: string };
export type HostedConversation = { id: string; projectId: string; ownerUserId: string; title: string; status: "active" | "archived"; sessionRevision: number; createdAt: string; updatedAt: string };
export type HostedRuntimeEvent = {
    protocolVersion: number;
    sequence: number;
    type: "run.started" | "assistant.delta" | "assistant.completed" | "tool.started" | "tool.updated" | "tool.completed" | "canvas.tool.requested" | "run.completed" | "run.failed" | "run.aborted";
    projectId: string;
    canvasWorkspaceId: string;
    conversationId: string;
    threadId: string;
    runId: string;
    turnId: string;
    itemId: string;
    payload: Record<string, unknown>;
    createdAt: string;
};

export const hostedAgentApi = {
    createProject: (token: string, name: string) => request<HostedProject>(token, "/v1/projects", { method: "POST", body: JSON.stringify({ name }) }),
    listProjects: (token: string) => request<HostedProject[]>(token, "/v1/projects"),
    deleteProject: (token: string, projectId: string) => request(token, `/v1/projects/${projectId}`, { method: "DELETE" }),
    createConversation: (token: string, projectId: string, title = "新对话") => request<HostedConversation>(token, `/v1/projects/${projectId}/conversations`, { method: "POST", body: JSON.stringify({ title }) }),
    listConversations: (token: string, projectId: string) => request<HostedConversation[]>(token, `/v1/projects/${projectId}/conversations`),
    runTurn: (token: string, projectId: string, conversationId: string, prompt: string) => request<{ runId: string }>(token, `/v1/projects/${projectId}/conversations/${conversationId}/turns`, { method: "POST", body: JSON.stringify({ prompt }) }),
    abort: (token: string, projectId: string, conversationId: string, runId: string) => request<{ runId: string; abortRequested: boolean }>(token, `/v1/projects/${projectId}/conversations/${conversationId}/runs/${runId}/abort`, { method: "POST" }),
    publishCanvas: (token: string, projectId: string, clientId: string, revision: number, snapshot: Record<string, unknown>) => request(token, `/v1/projects/${projectId}/canvas/snapshot`, { method: "POST", body: JSON.stringify({ clientId, revision, snapshot }) }),
    completeCanvasTool: (token: string, projectId: string, input: { callId: string; clientId?: string; revision?: number; snapshot?: Record<string, unknown>; result: Record<string, unknown> }) => request(token, `/v1/projects/${projectId}/canvas/tool-results`, { method: "POST", body: JSON.stringify(input) }),
    streamEvents,
};

async function request<T = unknown>(token: string, path: string, init: RequestInit = {}): Promise<T> {
    if (!baseUrl) throw new Error("托管 Agent API 尚未配置");
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers } });
    if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message || `Agent API 请求失败（${response.status}）`);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
}

async function streamEvents(token: string, projectId: string, conversationId: string, after: number, signal: AbortSignal, onEvent: (event: HostedRuntimeEvent) => void) {
    if (!baseUrl) throw new Error("托管 Agent API 尚未配置");
    const response = await fetch(`${baseUrl}/v1/projects/${projectId}/conversations/${conversationId}/events?after=${after}`, { headers: { Authorization: `Bearer ${token}` }, signal });
    if (!response.ok || !response.body) throw new Error(`Agent 事件连接失败（${response.status}）`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        blocks.forEach((block) => {
            const data = block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
            if (data) onEvent(JSON.parse(data) as HostedRuntimeEvent);
        });
        if (done) return;
    }
}
