import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { CONFIG_DIR } from "../config.js";

const AUTH_URL = "https://auth.openai.com";
const API_URL = "https://api.openai.com/v1";
const RESOURCE = API_URL;
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const CREDENTIAL_FILE = path.join(CONFIG_DIR, "chatgpt-auth.json");

type OidcConfiguration = { issuer: string; authorization_endpoint: string; token_endpoint: string; revocation_endpoint: string; jwks_uri: string };
type ChatGPTCredentials = {
    profile: { email: string; subject: string; clientId: string; hostId: string; issuer: string; scopes: string[]; expiresAt: number };
    tokens: { accessToken: string; refreshToken: string; idToken: string };
};
type TokenResponse = { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number; scope?: string; error?: string };
type PendingSignIn = { state: string; nonce: string; verifier: string; redirectUri: string; clientId: string; hostId: string; previousSubject?: string };

export class ChatGPTPlanError extends Error {
    override name = "ChatGPTPlanError";
    constructor(readonly code: string, readonly statusCode: number, message: string) {
        super(message);
    }
}

let pendingSignIn: PendingSignIn | null = null;
let oidcConfiguration: Promise<OidcConfiguration> | null = null;
let refreshInFlight: Promise<ChatGPTCredentials> | null = null;

/** Build the user-authorized Sign in with ChatGPT browser URL for this local installation. */
export async function startChatGPTSignIn(redirectUri: string, hostId: string) {
    const current = await readCredentials();
    const oidc = await getOidcConfiguration();
    const state = crypto.randomBytes(32).toString("base64url");
    const nonce = crypto.randomBytes(32).toString("base64url");
    const verifier = crypto.randomBytes(32).toString("base64url");
    const clientId = current?.profile.clientId || "dynamic_agent_client";
    pendingSignIn = { state, nonce, verifier, redirectUri, clientId, hostId, previousSubject: current?.profile.subject };

    const authorize = new URL(oidc.authorization_endpoint);
    const params = authorize.searchParams;
    params.set("client_id", clientId);
    if (clientId === "dynamic_agent_client") params.set("agent_name_hint", "Infinite Canvas");
    params.set("ext_agent_host_id", hostId);
    params.set("response_type", "code");
    params.set("redirect_uri", redirectUri);
    params.set("scope", "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct");
    params.set("resource", RESOURCE);
    params.set("state", state);
    params.set("nonce", nonce);
    params.set("code_challenge_method", "S256");
    params.set("code_challenge", crypto.createHash("sha256").update(verifier).digest("base64url"));
    if (current?.tokens.idToken) params.set("id_token_hint", current.tokens.idToken);
    if (current?.profile.email) params.set("login_hint", current.profile.email);
    return { url: authorize.toString() };
}

/** Validate the loopback callback, exchange its code, and persist the authorized ChatGPT plan session. */
export async function completeChatGPTSignIn(query: URLSearchParams, redirectUri: string) {
    const pending = pendingSignIn;
    if (!pending || query.get("state") !== pending.state || redirectUri !== pending.redirectUri) throw new ChatGPTPlanError("CHATGPT_SIGN_IN_FAILED", 400, "ChatGPT sign-in could not be verified. Start again from Infinite Canvas.");
    pendingSignIn = null;
    const oauthError = query.get("error");
    if (oauthError) throw new ChatGPTPlanError("CHATGPT_SIGN_IN_FAILED", 400, "ChatGPT authorization was cancelled or denied.");

    const code = query.get("code") || "";
    const returnedClientId = query.get("client_id") || "";
    const clientId = pending.clientId === "dynamic_agent_client" ? returnedClientId : pending.clientId;
    if (!code || !clientId || (pending.clientId !== "dynamic_agent_client" && returnedClientId && returnedClientId !== pending.clientId)) {
        throw new ChatGPTPlanError("CHATGPT_SIGN_IN_FAILED", 400, "ChatGPT sign-in returned an invalid authorization response.");
    }

    const oidc = await getOidcConfiguration();
    const tokens = await requestToken(oidc.token_endpoint, {
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: pending.verifier,
        redirect_uri: pending.redirectUri,
        resource: RESOURCE,
    });
    const scopes = (tokens.scope || "").split(/[\s+]+/).filter(Boolean);
    if (!tokens.access_token || !tokens.refresh_token || !tokens.id_token || !scopes.includes(PLAN_SCOPE)) {
        throw new ChatGPTPlanError("CHATGPT_PLAN_UNAVAILABLE", 403, "This ChatGPT account did not authorize ChatGPT plan usage. Reconnect and approve plan usage.");
    }

    let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
    try {
        const jwks = createRemoteJWKSet(new URL(oidc.jwks_uri));
        ({ payload } = await jwtVerify(tokens.id_token, jwks, { issuer: oidc.issuer, audience: clientId, nonce: pending.nonce }));
    } catch {
        throw new ChatGPTPlanError("CHATGPT_SIGN_IN_FAILED", 401, "The ChatGPT identity token could not be verified.");
    }
    const subject = typeof payload.sub === "string" ? payload.sub : "";
    const email = typeof payload.email === "string" ? payload.email : "";
    if (!subject || !email || (pending.previousSubject && pending.previousSubject !== subject)) throw new ChatGPTPlanError("CHATGPT_SIGN_IN_FAILED", 401, "The signed-in ChatGPT account did not match the selected account.");

    await writeCredentials({
        profile: { email, subject, clientId, hostId: pending.hostId, issuer: oidc.issuer, scopes, expiresAt: Date.now() + Math.max(1, Number(tokens.expires_in) || 3600) * 1000 },
        tokens: { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, idToken: tokens.id_token },
    });
}

/** Expose only account display information; OAuth credentials stay in the local process. */
export async function getChatGPTPlanSession() {
    const credentials = await readCredentials();
    return credentials?.tokens.accessToken && credentials.profile.scopes.includes(PLAN_SCOPE)
        ? { connected: true, email: credentials.profile.email, expiresAt: credentials.profile.expiresAt }
        : { connected: false };
}

/** Revoke the renewable session when possible, then remove its local credentials. */
export async function disconnectChatGPTPlan() {
    const credentials = await readCredentials();
    let revoked = !credentials?.tokens.refreshToken;
    if (credentials?.tokens.refreshToken) {
        try {
            const oidc = await getOidcConfiguration();
            const response = await fetch(oidc.revocation_endpoint, {
                method: "POST",
                headers: { "content-type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ token: credentials.tokens.refreshToken, token_type_hint: "refresh_token", client_id: credentials.profile.clientId }),
            });
            revoked = response.status === 200;
        } catch {
            revoked = false;
        }
    }
    await fs.unlink(CREDENTIAL_FILE).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    return { revoked };
}

/** Fetch the account-specific model catalog using its refreshed OAuth access token. */
export async function listChatGPTPlanModels() {
    const accessToken = await getAccessToken();
    const response = await fetch(`${API_URL}/models`, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw await inferenceError(response);
    const payload = await response.json() as { models?: Array<{ slug?: string; display_name?: string; visibility?: string }> };
    return { data: (payload.models || []).filter((model) => model.slug && model.display_name && model.visibility === "list").map((model) => ({ model: model.slug!, displayName: model.display_name! })) };
}

/** Stream one text-only Responses API turn and report only text deltas to the canvas. */
export async function streamChatGPTPlanResponse(input: { model: string; instructions?: string; userInput: string }, signal: AbortSignal, onDelta: (text: string) => void) {
    if (!input.model.trim() || !input.userInput.trim()) throw new ChatGPTPlanError("CHATGPT_REQUEST_FAILED", 400, "A model and user prompt are required.");
    const accessToken = await getAccessToken();
    const response = await fetch(`${API_URL}/responses`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ model: input.model, ...(input.instructions?.trim() ? { instructions: input.instructions.trim() } : {}), input: [{ role: "user", content: input.userInput }], store: false, stream: true }),
        signal,
    });
    if (!response.ok) throw await inferenceError(response);
    if (!response.body) throw new ChatGPTPlanError("CHATGPT_REQUEST_FAILED", 502, "The ChatGPT response stream was empty.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventName = "";
    let dataLines: string[] = [];
    let text = "";
    let completed = false;
    const dispatch = () => {
        if (!dataLines.length) { eventName = ""; return; }
        const raw = dataLines.join("\n");
        dataLines = [];
        let event: { type?: string; delta?: string; response?: { error?: { code?: string }; incomplete_details?: { reason?: string } } };
        try { event = JSON.parse(raw) as typeof event; } catch { eventName = ""; return; }
        const type = event.type || eventName;
        if (type === "response.output_text.delta" && event.delta) {
            text += event.delta;
            onDelta(event.delta);
        } else if (type === "response.failed") {
            throw inferenceCodeError(event.response?.error?.code || "CHATGPT_REQUEST_FAILED");
        } else if (type === "response.incomplete") {
            throw inferenceCodeError(event.response?.incomplete_details?.reason || "CHATGPT_REQUEST_FAILED");
        } else if (type === "response.completed") completed = true;
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
        if (buffer) {
            if (buffer.startsWith("data:")) dataLines.push(buffer.slice(5).trimStart());
            else if (buffer.startsWith("event:")) eventName = buffer.slice(6).trim();
        }
        dispatch();
        if (!completed) throw new ChatGPTPlanError("CHATGPT_REQUEST_FAILED", 502, "ChatGPT ended the stream before completing the response.");
        return text;
    } finally {
        if (!completed) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}

async function getAccessToken() {
    const credentials = await readCredentials();
    if (!credentials || !credentials.profile.scopes.includes(PLAN_SCOPE)) throw new ChatGPTPlanError("CHATGPT_NOT_CONNECTED", 401, "Connect a ChatGPT account with plan usage enabled first.");
    if (credentials.profile.expiresAt > Date.now() + 60_000) return credentials.tokens.accessToken;
    refreshInFlight ||= refreshCredentials(credentials).finally(() => { refreshInFlight = null; });
    return (await refreshInFlight).tokens.accessToken;
}

async function refreshCredentials(current: ChatGPTCredentials) {
    const oidc = await getOidcConfiguration();
    const tokens = await requestToken(oidc.token_endpoint, { grant_type: "refresh_token", client_id: current.profile.clientId, refresh_token: current.tokens.refreshToken, resource: RESOURCE });
    if (!tokens.access_token) throw new ChatGPTPlanError("CHATGPT_RECONNECT_REQUIRED", 401, "Reconnect your ChatGPT account to continue.");
    const scopes = tokens.scope ? tokens.scope.split(/[\s+]+/).filter(Boolean) : current.profile.scopes;
    if (!scopes.includes(PLAN_SCOPE)) throw new ChatGPTPlanError("CHATGPT_PLAN_UNAVAILABLE", 403, "ChatGPT plan usage is no longer authorized for this connection.");
    const next: ChatGPTCredentials = {
        profile: { ...current.profile, scopes, expiresAt: Date.now() + Math.max(1, Number(tokens.expires_in) || 3600) * 1000 },
        tokens: { ...current.tokens, accessToken: tokens.access_token, refreshToken: tokens.refresh_token || current.tokens.refreshToken, idToken: tokens.id_token || current.tokens.idToken },
    };
    await writeCredentials(next);
    return next;
}

async function requestToken(endpoint: string, body: Record<string, string>): Promise<TokenResponse> {
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
    const payload = await response.json().catch(() => ({})) as TokenResponse;
    if (!response.ok) {
        if (payload.error === "invalid_grant") throw new ChatGPTPlanError("CHATGPT_RECONNECT_REQUIRED", 401, "Reconnect your ChatGPT account to continue.");
        const providerCode = typeof payload.error === "string" && /^[a-z0-9_-]{1,64}$/i.test(payload.error) ? payload.error : "unknown_error";
        throw new ChatGPTPlanError("CHATGPT_SIGN_IN_FAILED", response.status, `ChatGPT authorization could not be completed (${providerCode}).`);
    }
    return payload;
}

async function inferenceError(response: Response) {
    const payload = await response.json().catch(() => ({})) as { error?: { code?: string } };
    return inferenceCodeError(payload.error?.code || `HTTP_${response.status}`);
}

function inferenceCodeError(code: string) {
    if (code === "subscription_sharing_usage_limit_exceeded") return new ChatGPTPlanError("CHATGPT_USAGE_LIMIT", 429, "The ChatGPT plan usage limit has been reached. Manage usage in ChatGPT settings.");
    if (code === "subscription_sharing_usage_unavailable") return new ChatGPTPlanError("CHATGPT_PLAN_UNAVAILABLE", 403, "ChatGPT plan usage is unavailable for this account or workspace.");
    if (code === "model_not_found" || code === "model_not_available") return new ChatGPTPlanError("CHATGPT_MODEL_UNAVAILABLE", 400, "This model is not available for the connected ChatGPT account.");
    return new ChatGPTPlanError("CHATGPT_REQUEST_FAILED", 502, `ChatGPT request failed (${code}).`);
}

async function getOidcConfiguration() {
    const current = oidcConfiguration ||= (async () => {
        const response = await fetch(`${AUTH_URL}/.well-known/openid-configuration`);
        if (!response.ok) throw new ChatGPTPlanError("CHATGPT_SIGN_IN_FAILED", 502, "Could not load ChatGPT sign-in configuration.");
        const value = await response.json() as OidcConfiguration;
        if (value.issuer !== AUTH_URL || !value.authorization_endpoint || !value.token_endpoint || !value.revocation_endpoint || !value.jwks_uri) throw new ChatGPTPlanError("CHATGPT_SIGN_IN_FAILED", 502, "ChatGPT sign-in configuration is incomplete.");
        return value;
    })();
    try {
        return await current;
    } catch (error) {
        if (oidcConfiguration === current) oidcConfiguration = null;
        throw error;
    }
}

async function readCredentials(): Promise<ChatGPTCredentials | null> {
    let content: string;
    try { content = await fs.readFile(CREDENTIAL_FILE, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    try {
        const value = JSON.parse(content) as ChatGPTCredentials;
        if (!value.profile?.clientId || !value.profile.hostId || !value.tokens?.accessToken || !value.tokens.refreshToken || !value.tokens.idToken) throw new Error();
        return value;
    } catch {
        throw new ChatGPTPlanError("CHATGPT_CREDENTIALS_UNREADABLE", 500, "The saved ChatGPT connection is damaged. Remove chatgpt-auth.json and connect again.");
    }
}

async function writeCredentials(credentials: ChatGPTCredentials) {
    await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
    const temp = `${CREDENTIAL_FILE}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    await fs.writeFile(temp, JSON.stringify(credentials, null, 2), { mode: 0o600 });
    await fs.chmod(temp, 0o600);
    await fs.rename(temp, CREDENTIAL_FILE);
    await fs.chmod(CREDENTIAL_FILE, 0o600);
    await fs.chmod(CONFIG_DIR, 0o700);
}
