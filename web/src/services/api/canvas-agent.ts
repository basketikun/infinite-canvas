import i18n from "@/i18n";
import type { CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { AgentReasoningEffort } from "@/stores/use-agent-store";

type AgentConfigResponse = { ok?: boolean; protocolVersion?: number; url?: string; token?: string; hasToken?: boolean };
const AGENT_MESSAGE_ASSET_PATTERN = /^agent-asset:([a-f0-9]{64})\/([a-f0-9]{64}\.(?:gif|jpe?g|png|webp))$/;

export class AgentApiError<T = unknown> extends Error {
    constructor(readonly status: number, readonly response: T & { code?: string; error?: string; msg?: string }) {
        super(response.error || response.msg || i18n.t("agent.state.requestFailed"));
        this.name = "AgentApiError";
    }
}

export type AgentSkillScope = "user" | "repo" | "system" | "admin";
export type AgentSkillInterface = { displayName?: string | null; shortDescription?: string | null; defaultPrompt?: string | null };
export type AgentSkillSummary = {
    name: string;
    description: string;
    shortDescription?: string | null;
    interface?: AgentSkillInterface | null;
    dependencies?: unknown;
    path: string;
    scope: AgentSkillScope;
    enabled: boolean;
    managed: boolean;
};
export type AgentSkillDetail = {
    name: string;
    description: string;
    instructions: string;
    interface?: AgentSkillInterface | null;
    path: string;
    managed: true;
    revision: string;
};
export type AgentSkillInput = { name?: string; description: string; instructions: string; interface?: AgentSkillInterface | null; expectedRevision?: string };
export type AgentSkillDraft = { name: string; displayName: string; description: string; instructions: string; shortDescription: string; defaultPrompt: string };
export type AgentSkillDraftInput = { source: "conversation" | "canvas"; threadId: string; clientId: string; model?: string; effort?: AgentReasoningEffort };
export type AgentSkillsResponse = { ok?: boolean; data?: AgentSkillSummary[]; errors?: unknown[] };
export type AgentSkillResponse = { ok?: boolean; data?: AgentSkillDetail };
export type AgentSkillDraftResponse = { ok?: boolean; data?: AgentSkillDraft };
export type ComfyPreset = { id: string; name: string; kind: "image" | "video"; inputs: string[]; params: string[] };
export type ComfyPresetsResponse = { ok?: boolean; data?: ComfyPreset[] };
export type GenerationLogStatus = "queued" | "running" | "success" | "failed" | "cancelled";
export type GenerationLog = {
    id: string; projectId: string; nodeId?: string; segmentId?: string; status: GenerationLogStatus;
    platform: string; workflow?: string; model?: string; taskMode?: string; prompt?: string;
    references: Array<Record<string, unknown>>; inputCounts: Record<string, number>; runtimeTaskId?: string; promptId?: string;
    startedAt: string; finishedAt?: string; durationMs: number; outputs: Array<Record<string, unknown>>;
    error?: string; params: Record<string, unknown>; createdAt: string; updatedAt: string;
};
export type GenerationLogInput = Omit<GenerationLog, "id" | "createdAt" | "updatedAt">;

export function fetchGenerationLogs(endpoint: string, token: string, options: { projectId?: string; nodeId?: string; status?: GenerationLogStatus; limit?: number } = {}) {
    const query = new URLSearchParams(Object.entries(options).filter(([, value]) => value !== undefined && value !== "") as Array<[string, string]>);
    return fetchAgentJson<{ ok?: boolean; logs?: GenerationLog[] }>(endpoint, token, `/runtime/generation-logs${query.toString() ? `?${query}` : ""}`);
}

export function createGenerationLog(endpoint: string, token: string, input: GenerationLogInput) {
    return fetchAgentJson<{ ok?: boolean; log?: GenerationLog }>(endpoint, token, "/runtime/generation-logs", jsonPost(input));
}

export function updateGenerationLog(endpoint: string, token: string, id: string, patch: Partial<GenerationLogInput>) {
    return fetchAgentJson<{ ok?: boolean; log?: GenerationLog }>(endpoint, token, `/runtime/generation-logs/${encodeURIComponent(id)}`, jsonRequest(patch, "PATCH"));
}

export function deleteGenerationLogs(endpoint: string, token: string, options: { id?: string; projectId?: string; nodeId?: string }) {
    const query = new URLSearchParams(Object.entries(options).filter(([, value]) => value !== undefined && value !== "") as Array<[string, string]>);
    return fetchAgentJson<{ ok?: boolean; deleted?: number }>(endpoint, token, `/runtime/generation-logs${query.toString() ? `?${query}` : ""}`, { method: "DELETE" });
}

export async function postState(endpoint: string, token: string, clientId: string, snapshot: CanvasAgentSnapshot | null) {
    try {
        const response = await fetch(`${endpoint}/canvas/state?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(snapshot ? { ...snapshot, hasCanvas: true } : { hasCanvas: false }),
        });
        return response.ok;
    } catch {
        return false;
    }
}

export function fetchComfyPresets(endpoint: string, token: string) {
    return fetchAgentJson<ComfyPresetsResponse>(endpoint, token, "/comfy/presets");
}

export function fetchComfyStatus(endpoint: string, token: string) {
    return fetchAgentJson<{ ok?: boolean; connected?: boolean; url?: string; error?: string }>(endpoint, token, "/comfy/status");
}

export function fetchComfyModels(endpoint: string, token: string) {
    return fetchAgentJson<{ ok?: boolean; data?: { models?: string[]; loras?: string[]; refreshedAt?: string; error?: string } }>(endpoint, token, "/comfy/models");
}

export function syncRuntimeMedia(endpoint: string, token: string, name: string, dataUrl: string) {
    return fetchAgentJson<{ ok?: boolean; media?: { id: string; path: string; name: string; mimeType: string; bytes: number } }>(endpoint, token, "/runtime/media", jsonPost({ name, dataUrl }));
}

export async function activateAgentClient(endpoint: string, token: string, clientId: string) {
    try {
        await fetch(`${endpoint}/canvas/activate?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`, { method: "POST" });
    } catch {}
}

export async function postToolResult(endpoint: string, token: string, clientId: string, body: { requestId: string; result?: unknown; error?: string }) {
    await fetchAgentJson(endpoint, token, `/canvas/result?clientId=${encodeURIComponent(clientId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export async function postCodexApproval(endpoint: string, token: string, requestId: string, decision: "accept" | "acceptForSession" | "decline") {
    await fetchAgentJson(endpoint, token, "/agent/codex/approval", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId, decision }) });
}

export async function interruptCodexTurn(endpoint: string, token: string, threadId?: string) {
    await fetchAgentJson(endpoint, token, "/agent/codex/interrupt", jsonPost({ threadId }));
}

export async function acknowledgeCodexHistory(endpoint: string, token: string, threadId: string, turnIds: string[]) {
    await fetchAgentJson(endpoint, token, "/agent/codex/history/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId, turnIds }) });
}

export async function revealAgentLocalFile(endpoint: string, token: string, path: string) {
    await fetchAgentJson(endpoint, token, "/agent/local-file/reveal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
}

export function resolveAgentMessageAssetUrl(endpoint: string, token: string, value: string) {
    const match = AGENT_MESSAGE_ASSET_PATTERN.exec(value);
    if (!match) return value.startsWith("agent-asset:") ? "" : value;
    const baseUrl = endpoint.trim().replace(/\/$/, "");
    return baseUrl && token ? `${baseUrl}/agent/message-assets/${match[1]}/${match[2]}?token=${encodeURIComponent(token)}` : "";
}

// 插件声明的 MCP 工具(浏览器 -> Agent 的声明线)
export type AgentPluginMcpTool = { id: string; version: string; name: string; description: string; inputJsonSchema: Record<string, unknown> };
export type AgentPluginMcpDeclaration = {
    id: string;
    name: string;
    version: string;
    mcp: { tools: AgentPluginMcpTool[]; enabled: boolean };
};

/** 通知 Agent 当前已启用插件的 MCP 声明,驱动 Agent 动态注册/注销 MCP 工具。 */
export async function notifyAgentPluginMcp(endpoint: string, token: string, plugins: AgentPluginMcpDeclaration[]) {
    try {
        await fetchAgentJson<{ ok?: boolean }>(endpoint, token, "/api/plugins/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plugins }) });
    } catch (error) {
        console.warn("[plugin] 通知 Agent 插件 MCP 状态失败", error);
    }
}

export function fetchCodexSkills(endpoint: string, token: string, forceReload = false) {
    return fetchAgentJson<AgentSkillsResponse>(endpoint, token, `/agent/codex/skills${forceReload ? "?forceReload=1" : ""}`);
}

export function fetchCodexSkill(endpoint: string, token: string, name: string) {
    return fetchAgentJson<AgentSkillResponse>(endpoint, token, `/agent/codex/skills/${encodeURIComponent(name)}`);
}

export function createCodexSkill(endpoint: string, token: string, input: AgentSkillInput) {
    return fetchAgentJson<AgentSkillResponse>(endpoint, token, "/agent/codex/skills", jsonPost(input));
}

export function createCodexSkillDraft(endpoint: string, token: string, input: AgentSkillDraftInput) {
    return fetchAgentJson<AgentSkillDraftResponse>(endpoint, token, "/agent/codex/skills/draft", jsonPost(input));
}

export function updateCodexSkill(endpoint: string, token: string, name: string, input: AgentSkillInput) {
    return fetchAgentJson<AgentSkillResponse>(endpoint, token, `/agent/codex/skills/${encodeURIComponent(name)}`, jsonPost(input));
}

export function deleteCodexSkill(endpoint: string, token: string, name: string, expectedRevision: string) {
    return fetchAgentJson<{ ok?: boolean }>(endpoint, token, `/agent/codex/skills/${encodeURIComponent(name)}/delete`, jsonPost({ expectedRevision }));
}

export function setCodexSkillEnabled(endpoint: string, token: string, skill: Pick<AgentSkillSummary, "name" | "path">, enabled: boolean) {
    return fetchAgentJson<{ ok?: boolean }>(endpoint, token, `/agent/codex/skills/${encodeURIComponent(skill.name)}/enabled`, jsonPost({ ...skill, enabled }));
}

export async function fetchAgentJson<T>(endpoint: string, token: string, path: string, init?: RequestInit) {
    const url = `${endpoint}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
    const res = await fetch(url, init);
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; msg?: string };
    if (!res.ok) throw new AgentApiError(res.status, data);
    return data;
}

export async function discoverAgentConfig(endpoint: string) {
    try {
        const res = await fetch(`${endpoint}/config`);
        if (!res.ok) return null;
        const data = (await res.json()) as AgentConfigResponse;
        return data.ok ? data : null;
    } catch {
        return null;
    }
}

function jsonPost(body: unknown): RequestInit {
    return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function jsonRequest(body: unknown, method: "POST" | "PATCH"): RequestInit {
    return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
