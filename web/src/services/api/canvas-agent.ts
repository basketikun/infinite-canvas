import i18n from "@/i18n";
import type { CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { AgentClarificationAnswers, AgentReasoningEffort } from "@/stores/use-agent-store";

type AgentConfigResponse = { ok?: boolean; protocolVersion?: number; url?: string; token?: string; hasToken?: boolean };
const AGENT_MESSAGE_ASSET_PATTERN = /^agent-asset:([a-f0-9]{64})\/([a-f0-9]{64}\.(?:gif|jpe?g|png|webp))$/;

export class AgentApiError<T = unknown> extends Error {
    constructor(
        readonly status: number,
        readonly response: T & { code?: string; error?: string; msg?: string },
    ) {
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
export type AgentProject = { id: string; name: string; workspacePath: string; activeThreadId?: string; isDefault?: boolean };
export type AgentProjectsResponse = { ok?: boolean; project?: AgentProject; projects?: AgentProject[]; workspace?: AgentProject };
export type AgentSkillsResponse = { ok?: boolean; data?: AgentSkillSummary[]; errors?: unknown[] };
export type AgentSkillResponse = { ok?: boolean; data?: AgentSkillDetail };
export type AgentSkillDraftResponse = { ok?: boolean; data?: AgentSkillDraft };
export type AgentCodexTurnInput = {
    prompt: string;
    messageText: string;
    messageId: string;
    clientId: string;
    threadId: string;
    conversationId: string;
    expectedRevision: number;
    permissionMode: "request" | "automatic" | "full";
    model?: string;
    effort?: AgentReasoningEffort | "";
    skill?: Pick<AgentSkillSummary, "name" | "path">;
    attachments?: unknown[];
    messageMetadata?: unknown;
    replaceLastTurnId?: string;
};

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

export async function postCodexClarification(endpoint: string, token: string, requestId: string, answers?: AgentClarificationAnswers) {
    return await fetchAgentJson<{ ok?: boolean; state?: string }>(endpoint, token, "/agent/codex/clarification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId, answers: answers || null }),
    });
}

export async function interruptCodexTurn(endpoint: string, token: string, threadId?: string) {
    await fetchAgentJson(endpoint, token, "/agent/codex/interrupt", jsonPost({ threadId }));
}

export function postCodexTurn(endpoint: string, token: string, input: AgentCodexTurnInput) {
    return fetchAgentJson<{ ok?: boolean; threadId?: string }>(endpoint, token, "/agent/codex/turn", jsonPost(input));
}

export async function acknowledgeCodexHistory(endpoint: string, token: string, clientId: string, threadId: string, turnIds: string[]) {
    await fetchAgentJson(endpoint, token, "/agent/codex/history/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, threadId, turnIds }) });
}

export async function revealAgentLocalFile(endpoint: string, token: string, path: string) {
    await fetchAgentJson(endpoint, token, "/agent/local-file/reveal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
}

export async function selectAgentLocalDirectory(endpoint: string, token: string, signal?: AbortSignal) {
    const result = await fetchAgentJson<{ ok?: boolean; path?: string | null }>(endpoint, token, "/agent/local-directory/select", { method: "POST", signal });
    return result.path || "";
}

export function resolveAgentMessageAssetUrl(endpoint: string, token: string, value: string) {
    const match = AGENT_MESSAGE_ASSET_PATTERN.exec(value);
    if (!match) return value.startsWith("agent-asset:") ? "" : value;
    const baseUrl = endpoint.trim().replace(/\/$/, "");
    return baseUrl && token ? `${baseUrl}/agent/message-assets/${match[1]}/${match[2]}?token=${encodeURIComponent(token)}` : "";
}

export function fetchCodexProjects(endpoint: string, token: string, clientId: string) {
    return fetchAgentJson<AgentProjectsResponse>(endpoint, token, `/agent/codex/projects?clientId=${encodeURIComponent(clientId)}`);
}

export function activateCodexProject(endpoint: string, token: string, clientId: string, projectId: string, permissionMode: "request" | "automatic" | "full") {
    return fetchAgentJson<AgentProjectsResponse>(endpoint, token, `/agent/codex/projects/${encodeURIComponent(projectId)}/activate`, jsonPost({ clientId, permissionMode }));
}

export function createCodexProject(endpoint: string, token: string, clientId: string, input: { name: string; workspacePath: string; permissionMode: "request" | "automatic" | "full" }) {
    return fetchAgentJson<AgentProjectsResponse>(endpoint, token, "/agent/codex/projects", jsonPost({ clientId, ...input }));
}

export function deleteCodexProject(endpoint: string, token: string, clientId: string, projectId: string, permissionMode: "request" | "automatic" | "full") {
    return fetchAgentJson<AgentProjectsResponse>(endpoint, token, `/agent/codex/projects/${encodeURIComponent(projectId)}/delete`, jsonPost({ clientId, permissionMode }));
}

export function fetchCodexSkills(endpoint: string, token: string, clientId: string, forceReload = false) {
    return fetchAgentJson<AgentSkillsResponse>(endpoint, token, `/agent/codex/skills?clientId=${encodeURIComponent(clientId)}${forceReload ? "&forceReload=1" : ""}`);
}

export function fetchCodexSkill(endpoint: string, token: string, clientId: string, name: string) {
    return fetchAgentJson<AgentSkillResponse>(endpoint, token, `/agent/codex/skills/${encodeURIComponent(name)}?clientId=${encodeURIComponent(clientId)}`);
}

export function createCodexSkill(endpoint: string, token: string, clientId: string, input: AgentSkillInput) {
    return fetchAgentJson<AgentSkillResponse>(endpoint, token, "/agent/codex/skills", jsonPost({ ...input, clientId }));
}

export function createCodexSkillDraft(endpoint: string, token: string, input: AgentSkillDraftInput) {
    return fetchAgentJson<AgentSkillDraftResponse>(endpoint, token, "/agent/codex/skills/draft", jsonPost(input));
}

export function updateCodexSkill(endpoint: string, token: string, clientId: string, name: string, input: AgentSkillInput) {
    return fetchAgentJson<AgentSkillResponse>(endpoint, token, `/agent/codex/skills/${encodeURIComponent(name)}`, jsonPost({ ...input, clientId }));
}

export function deleteCodexSkill(endpoint: string, token: string, clientId: string, name: string, expectedRevision: string) {
    return fetchAgentJson<{ ok?: boolean }>(endpoint, token, `/agent/codex/skills/${encodeURIComponent(name)}/delete`, jsonPost({ expectedRevision, clientId }));
}

export function setCodexSkillEnabled(endpoint: string, token: string, clientId: string, skill: Pick<AgentSkillSummary, "name" | "path">, enabled: boolean) {
    return fetchAgentJson<{ ok?: boolean }>(endpoint, token, `/agent/codex/skills/${encodeURIComponent(skill.name)}/enabled`, jsonPost({ ...skill, enabled, clientId }));
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
