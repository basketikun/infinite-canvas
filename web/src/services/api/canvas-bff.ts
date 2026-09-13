export type CanvasAccount = {
    id: string;
    sub2ApiUserId: string;
    displayName: string;
    email?: string;
    status: string;
};

export type CanvasSession = {
    account: CanvasAccount;
    sessionExpiresAt: string;
};

export type CanvasProvider = {
    id: string;
    name: string;
    providerType: string;
    baseUrl?: string;
    model?: string;
    group?: string;
    channel?: string;
    sub2ApiKeyId?: string;
    status: "active" | "disabled" | string;
    fingerprint: string;
    maskedKey: string;
    createdAt: string;
    updatedAt: string;
};

const CANVAS_MODEL_PREFIX = "canvas::";

export function encodeCanvasModel(providerId: string, model: string) {
    return `${CANVAS_MODEL_PREFIX}${providerId}::${model.trim()}`;
}

export function decodeCanvasModel(value: string) {
    if (!value.startsWith(CANVAS_MODEL_PREFIX)) return null;
    const separator = value.indexOf("::", CANVAS_MODEL_PREFIX.length);
    if (separator < 0) return null;
    const providerId = value.slice(CANVAS_MODEL_PREFIX.length, separator);
    const model = value.slice(separator + 2).trim();
    return providerId && model ? { providerId, model } : null;
}

export type ProviderCatalogItem = {
    id: string;
    name: string;
    providerType?: string;
    model?: string;
    group?: string;
    channel?: string;
    fingerprint?: string;
    maskedKey?: string;
    status?: string;
};

export type ProviderCatalog = {
    keys: ProviderCatalogItem[];
    groups: ProviderCatalogItem[];
    rates: ProviderCatalogItem[];
    channels: ProviderCatalogItem[];
};

export type CanvasProject = {
    id: string;
    name: string;
    data: Record<string, unknown>;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type CanvasGeneration = {
    id: string;
    projectId: string;
    providerId: string;
    kind: "image" | "video" | "audio" | "text";
    status: "queued" | "running" | "provider_polling" | "succeeded" | "failed" | "cancelled";
    progress: number;
    attempt: number;
    errorCode?: string;
    outputAssetId?: string;
    asset?: { id: string; kind: string; providerUrl?: string; metadata: Record<string, unknown>; signedUrl?: string };
    createdAt: string;
    updatedAt: string;
};

export type CanvasAsset = {
    id: string;
    accountId: string;
    projectId?: string;
    kind: "image" | "video" | "audio" | "file";
    providerUrl?: string;
    metadata: Record<string, unknown>;
    signedUrl?: string;
    createdAt: string;
};

type Envelope<T> = { data: T; requestId?: string };

export class CanvasBffError extends Error {
    readonly status: number;
    readonly code: string;
    readonly requestId?: string;

    constructor(status: number, code: string, message: string, requestId?: string) {
        super(message);
        this.name = "CanvasBffError";
        this.status = status;
        this.code = code;
        this.requestId = requestId;
    }
}

const configuredCanvasBffUrl = (import.meta.env.VITE_CANVAS_BFF_URL || "/api").trim().replace(/\/+$/, "");
const canvasBffUrl = configuredCanvasBffUrl.endsWith("/api") ? configuredCanvasBffUrl : `${configuredCanvasBffUrl}/api`;

export const canvasBff = {
    getSession: () => request<CanvasSession>("/v1/session"),
    exchangeSub2ApiLaunchCode: (launchCode: string) => request<CanvasSession>("/v1/sso/launch/exchange", { method: "POST", body: { launch_code: launchCode } }),
    logout: () => request<{ ok: true }>("/v1/logout", { method: "POST" }),
    listProviders: () => request<CanvasProvider[]>("/v1/providers"),
    listProviderModels: (providerId: string) => request<string[]>(`/v1/providers/${encodeURIComponent(providerId)}/models`),
    getProviderCatalog: () => request<ProviderCatalog>("/v1/providers/catalog"),
    createProvider: (input: { name: string; providerType?: string; baseUrl?: string; model?: string; group?: string; channel?: string; catalogKeyId?: string; secret?: string }) => request<CanvasProvider>("/v1/providers", { method: "POST", body: input }),
    updateProvider: (providerId: string, input: { name?: string; model?: string; group?: string; channel?: string; status?: "active" | "disabled" }) =>
        request<CanvasProvider>(`/v1/providers/${encodeURIComponent(providerId)}`, { method: "PATCH", body: input }),
    deleteProvider: (providerId: string) => request<void>(`/v1/providers/${encodeURIComponent(providerId)}`, { method: "DELETE" }),
    listProjects: () => request<CanvasProject[]>("/v1/projects"),
    createProject: (input: { name: string; data?: Record<string, unknown> }) => request<CanvasProject>("/v1/projects", { method: "POST", body: input }),
    getProject: (projectId: string) => request<CanvasProject>(`/v1/projects/${encodeURIComponent(projectId)}`),
    updateProject: (projectId: string, input: { name?: string; data?: Record<string, unknown>; revision?: number }) => request<CanvasProject>(`/v1/projects/${encodeURIComponent(projectId)}`, { method: "PATCH", body: input }),
    deleteProject: (projectId: string) => request<void>(`/v1/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" }),
    listAssets: (projectId?: string) => request<CanvasAsset[]>(`/v1/assets${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
    listGenerations: () => request<CanvasGeneration[]>("/v1/generations"),
    getGeneration: (generationId: string) => request<CanvasGeneration>(`/v1/generations/${encodeURIComponent(generationId)}`),
    createGeneration: (input: { projectId: string; providerId: string; kind: CanvasGeneration["kind"]; input?: Record<string, unknown>; clientRequestId: string }) => request<CanvasGeneration>("/v1/generations", { method: "POST", body: input }),
    cancelGeneration: (generationId: string) => request<CanvasGeneration>(`/v1/generations/${encodeURIComponent(generationId)}/cancel`, { method: "POST" }),
};

async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const headers = new Headers({ Accept: "application/json" });
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    const response = await fetch(`${canvasBffUrl}${path}`, {
        method: options.method || "GET",
        headers,
        credentials: "include",
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (response.status === 204) return undefined as T;
    const body = await readJson(response);
    if (!response.ok) {
        const error = isErrorBody(body) ? body : undefined;
        throw new CanvasBffError(response.status, error?.code || "BFF_REQUEST_FAILED", error?.message || "Canvas request failed", error?.requestId);
    }
    if (!isEnvelope<T>(body)) throw new CanvasBffError(502, "INVALID_BFF_RESPONSE", "Canvas BFF returned an invalid response");
    return body.data;
}

async function readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return undefined;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return undefined;
    }
}

function isEnvelope<T>(value: unknown): value is Envelope<T> {
    return Boolean(value && typeof value === "object" && "data" in value);
}

function isErrorBody(value: unknown): value is { code: string; message: string; requestId?: string } {
    return Boolean(value && typeof value === "object" && typeof (value as { code?: unknown }).code === "string" && typeof (value as { message?: unknown }).message === "string");
}
