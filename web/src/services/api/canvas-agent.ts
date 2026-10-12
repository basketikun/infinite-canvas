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
export type AgentSkillImportPreview = Pick<AgentSkillDetail, "name" | "description" | "instructions"> & { displayName?: string; nameAdjusted: boolean };
export type AgentSkillDraft = { name: string; displayName: string; description: string; instructions: string; shortDescription: string; defaultPrompt: string };
export type AgentSkillDraftInput = { source: "conversation" | "canvas"; threadId: string; clientId: string; model?: string; effort?: AgentReasoningEffort };
export type ChatGPTPlanModel = { model: string; displayName: string };
export type ChatGPTPlanSession = { connected: boolean; email?: string; expiresAt?: number };
export type DreaminaCapability = { command: "text2video" | "image2video" | "frames2video" | "multiframe2video" | "multimodal2video"; flags: string[]; models: string[]; ratios: string[]; durations?: [number, number]; resolutions: string[] };
export type DreaminaStatus = { installed: boolean; path?: string; version?: string; loggedIn?: boolean; credits?: string; creditsRemaining?: number; creditRefreshDate?: string; error?: string };
export type DreaminaVideoInput = { command: DreaminaCapability["command"]; prompt: string; model?: string; duration?: number; ratio?: string; resolution?: string; generateAudio?: boolean; imageIds?: string[]; videoIds?: string[]; audioIds?: string[] };
export type DreaminaAsset = { id: string; name: string; kind: "image" | "video" | "audio" };
export type VideoCliProvider = "dreamina" | "libtv";
export type VideoCliSetting = { key: string; label: string; type: "select" | "number" | "switch"; options?: Array<{ value: string | number; label: string }>; min?: number; max?: number; step?: number; defaultValue?: unknown };
export type VideoCliModel = { id: string; label: string };
export type VideoCliSchema = { model: string; label: string; mode: string; modes: string[]; settings: VideoCliSetting[] };
export type VideoCliTaskState = { status: "pending" } | { status: "failed"; error: string } | { status: "completed"; fileUrl?: string; url?: string };
export type AgentSkillsResponse = { ok?: boolean; data?: AgentSkillSummary[]; errors?: unknown[] };
export type AgentSkillResponse = { ok?: boolean; data?: AgentSkillDetail };
export type AgentSkillImportPreviewResponse = { ok?: boolean; data?: AgentSkillImportPreview };
export type AgentSkillDraftResponse = { ok?: boolean; data?: AgentSkillDraft };

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

export function previewCodexSkillImport(endpoint: string, token: string, document: string) {
    return fetchAgentJson<AgentSkillImportPreviewResponse>(endpoint, token, "/agent/codex/skills/import-preview", jsonPost({ document }));
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

export function fetchChatGPTPlanSession(endpoint: string, token: string) {
    return fetchAgentJson<{ ok?: boolean } & ChatGPTPlanSession>(endpoint, token, "/agent/chatgpt/session");
}

export function fetchChatGPTPlanModels(endpoint: string, token: string) {
    return fetchAgentJson<{ ok?: boolean; data?: ChatGPTPlanModel[] }>(endpoint, token, "/agent/chatgpt/models");
}

export function startChatGPTPlanSignIn(endpoint: string, token: string) {
    return fetchAgentJson<{ ok?: boolean; url?: string }>(endpoint, token, "/agent/chatgpt/sign-in", jsonPost({}));
}

export function disconnectChatGPTPlan(endpoint: string, token: string) {
    return fetchAgentJson<{ ok?: boolean; revoked?: boolean }>(endpoint, token, "/agent/chatgpt/session", { method: "DELETE" });
}

export function fetchDreaminaStatus(endpoint: string, token: string) {
    return fetchAgentJson<{ ok?: boolean } & DreaminaStatus>(endpoint, token, "/agent/dreamina/status");
}

export function fetchVideoCliModels(endpoint: string, token: string, provider: VideoCliProvider) {
    return fetchAgentJson<{ ok?: boolean; data?: { models: VideoCliModel[] } }>(endpoint, token, `/agent/video-cli/models?provider=${provider}`);
}

export function fetchVideoCliSchema(endpoint: string, token: string, provider: VideoCliProvider, model: string) {
    return fetchAgentJson<{ ok?: boolean; data?: VideoCliSchema }>(endpoint, token, `/agent/video-cli/schema?provider=${provider}&model=${encodeURIComponent(model)}`);
}

export function fetchLibTvProjects(endpoint: string, token: string) {
    return fetchAgentJson<{ ok?: boolean; data?: Array<{ id: string; name: string }> }>(endpoint, token, "/agent/video-cli/projects");
}

export function createVideoCliTask(endpoint: string, token: string, input: { provider: VideoCliProvider; prompt: string; model: string; settings: Record<string, string | number | boolean>; projectId?: string }) {
    return fetchAgentJson<{ ok?: boolean; data?: { id: string; provider: VideoCliProvider } }>(endpoint, token, "/agent/video-cli/tasks", jsonPost(input));
}

export function fetchVideoCliTask(endpoint: string, token: string, id: string, signal?: AbortSignal) {
    return fetchAgentJson<{ ok?: boolean; data?: VideoCliTaskState }>(endpoint, token, `/agent/video-cli/tasks/${encodeURIComponent(id)}`, { signal });
}

export async function fetchVideoCliFile(endpoint: string, token: string, fileUrl: string, signal?: AbortSignal) {
    const response = await fetch(`${endpoint}${fileUrl}${fileUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`, { signal });
    if (!response.ok) throw new AgentApiError(response.status, await response.json().catch(() => ({})));
    return await response.blob();
}

export function fetchDreaminaCapabilities(endpoint: string, token: string, forceRefresh = false) {
    return fetchAgentJson<{ ok?: boolean; data?: DreaminaCapability[] }>(endpoint, token, `/agent/dreamina/capabilities${forceRefresh ? "?refresh=1" : ""}`);
}

export function startDreaminaLogin(endpoint: string, token: string) {
    return fetchAgentJson<{ ok?: boolean; started?: boolean; verificationUri?: string; userCode?: string; deviceCode?: string }>(endpoint, token, "/agent/dreamina/login", jsonPost({}));
}

export function checkDreaminaLogin(endpoint: string, token: string, deviceCode: string) {
    return fetchAgentJson<{ ok?: boolean; authorized?: boolean }>(endpoint, token, "/agent/dreamina/login/check", jsonPost({ deviceCode }));
}

export function uploadDreaminaAsset(endpoint: string, token: string, file: Blob, fileName: string, signal?: AbortSignal) {
    return fetchAgentJson<{ ok?: boolean; data?: DreaminaAsset }>(endpoint, token, "/agent/dreamina/assets", {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream", "x-filename": encodeURIComponent(fileName) },
        body: file,
        signal,
    });
}

export function deleteDreaminaAsset(endpoint: string, token: string, id: string) {
    return fetchAgentJson<{ ok?: boolean }>(endpoint, token, `/agent/dreamina/assets/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function submitDreaminaVideo(endpoint: string, token: string, input: DreaminaVideoInput) {
    return fetchAgentJson<{ ok?: boolean; data?: { id: string; command: string; model: string } }>(endpoint, token, "/agent/dreamina/tasks", jsonPost(input));
}

export async function waitForDreaminaVideo(endpoint: string, token: string, submitId: string, signal?: AbortSignal) {
    while (true) {
        if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
        const state = await fetchAgentJson<{ status?: "pending" | "completed" | "failed"; error?: string }>(endpoint, token, `/agent/dreamina/tasks/${encodeURIComponent(submitId)}`, { signal });
        if (state.status === "failed") {
            const error = new Error(state.error || i18n.t("canvas.dreamina.taskFailed"));
            error.name = "VideoTaskFailed";
            throw error;
        }
        if (state.status === "completed") {
            const url = `${endpoint}/agent/dreamina/tasks/${encodeURIComponent(submitId)}/video?token=${encodeURIComponent(token)}`;
            const response = await fetch(url, { signal });
            if (!response.ok) throw new AgentApiError(response.status, { error: i18n.t("canvas.dreamina.videoDownloadFailed") });
            return await response.blob();
        }
        await delayForDreamina(2500, signal);
    }
}

export function deleteDreaminaTask(endpoint: string, token: string, submitId: string) {
    return fetchAgentJson<{ ok?: boolean }>(endpoint, token, `/agent/dreamina/tasks/${encodeURIComponent(submitId)}`, { method: "DELETE" });
}

export async function requestChatGPTPlanResponse(
    endpoint: string,
    token: string,
    input: { model: string; instructions?: string; userInput: string },
    onDelta: (text: string) => void,
    options?: { signal?: AbortSignal },
) {
    const url = `${endpoint}/agent/chatgpt/responses?token=${encodeURIComponent(token)}`;
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal: options?.signal });
    if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
        throw new AgentApiError(response.status, { ...data, error: data.code?.startsWith("CHATGPT_") ? chatGPTPlanErrorMessage(data.code, data.error || "") : data.error });
    }
    if (!response.body) throw new Error(i18n.t("canvas.agentStep.chatgptRequestFailed"));

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventName = "";
    let dataLines: string[] = [];
    let result = "";
    let completed = false;
    const dispatch = () => {
        if (!dataLines.length) { eventName = ""; return; }
        const raw = dataLines.join("\n");
        dataLines = [];
        let event: { delta?: string; text?: string; code?: string; error?: string };
        try { event = JSON.parse(raw) as typeof event; } catch { eventName = ""; return; }
        if (eventName === "delta" && event.delta) {
            result += event.delta;
            onDelta(event.delta);
        } else if (eventName === "done") {
            result = event.text ?? result;
            completed = true;
        } else if (eventName === "error") {
            throw new Error(chatGPTPlanErrorMessage(event.code || "", event.error || ""));
        }
        eventName = "";
    };

    try {
        while (true) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
            let newline = buffer.indexOf("\n");
            while (newline >= 0) {
                const line = buffer.slice(0, newline).replace(/\r$/, "");
                buffer = buffer.slice(newline + 1);
                if (!line) dispatch();
                else if (line.startsWith("event:")) eventName = line.slice(6).trim();
                else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
                newline = buffer.indexOf("\n");
            }
            if (done) break;
        }
        if (buffer.startsWith("data:")) dataLines.push(buffer.slice(5).trimStart());
        dispatch();
        if (!completed) throw new Error(i18n.t("canvas.agentStep.chatgptRequestFailed"));
        return result;
    } finally {
        if (!completed) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}

function chatGPTPlanErrorMessage(code: string, fallback: string) {
    const errorKeys: Record<string, string> = {
        CHATGPT_USAGE_LIMIT: "canvas.agentStep.chatgptUsageLimit",
        CHATGPT_PLAN_UNAVAILABLE: "canvas.agentStep.chatgptPlanUnavailable",
        CHATGPT_MODEL_UNAVAILABLE: "canvas.agentStep.chatgptModelUnavailable",
        CHATGPT_NOT_CONNECTED: "canvas.agentStep.chatgptNotConnected",
        CHATGPT_RECONNECT_REQUIRED: "canvas.agentStep.chatgptReconnectRequired",
        CHATGPT_SIGN_IN_FAILED: "canvas.agentStep.chatgptSignInFailed",
        CHATGPT_CREDENTIALS_UNREADABLE: "canvas.agentStep.chatgptCredentialsUnreadable",
        CHATGPT_REQUEST_FAILED: "canvas.agentStep.chatgptRequestFailed",
    };
    const key = errorKeys[code];
    return key ? i18n.t(key) : fallback || i18n.t("canvas.agentStep.chatgptRequestFailed");
}

export async function fetchAgentJson<T>(endpoint: string, token: string, path: string, init?: RequestInit) {
    const url = `${endpoint}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
    const res = await fetch(url, init);
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; msg?: string };
    const code = (data as { code?: string }).code;
    if (!res.ok) throw new AgentApiError(res.status, { ...data, error: code?.startsWith("CHATGPT_") ? chatGPTPlanErrorMessage(code, data.error || "") : data.error });
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

function delayForDreamina(milliseconds: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
        const timer = window.setTimeout(() => {
            signal?.removeEventListener("abort", abort);
            resolve();
        }, milliseconds);
        const abort = () => {
            window.clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            reject(signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", abort, { once: true });
    });
}
