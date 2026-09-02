/** 总后台 API client（Web 端）。 */

export type BackendMediaResult = {
    storageKey: string;
    url: string;
    mimeType: string;
    bytes: number;
    width: number | null;
    height: number | null;
    durationMs: number | null;
};

export type BackendTokenResponse = { ok: boolean; token: string };

const DEFAULT_URL = "http://127.0.0.1:17370";

export function getBackendUrl(): string {
    if (typeof window === "undefined") return DEFAULT_URL;
    return localStorage.getItem("backend-url") || DEFAULT_URL;
}

export function getBackendToken(): string {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("backend-token") || "";
}

export function setBackendConnection(url: string, token: string) {
    if (typeof window === "undefined") return;
    localStorage.setItem("backend-url", url.replace(/\/$/, ""));
    localStorage.setItem("backend-token", token);
}

async function request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${getBackendUrl().replace(/\/$/, "")}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(getBackendToken())}`;
    const res = await fetch(url, {
        method,
        headers: body ? { "content-type": "application/json" } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
    if (!res.ok) throw new Error(`Backend ${method} ${path} failed: HTTP ${res.status} ${data.error || ""}`);
    return data;
}

export async function backendHealth(): Promise<{ ok: boolean; protocolVersion?: number; node?: string; pid?: number }> {
    try {
        const res = await fetch(`${getBackendUrl().replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) return { ok: false };
        return await res.json();
    } catch {
        return { ok: false };
    }
}

/** 自动发现 backend token（读 backend.json）。 */
export async function discoverBackendToken(): Promise<BackendTokenResponse> {
    try {
        const res = await fetch(`${getBackendUrl().replace(/\/$/, "")}/config`);
        if (!res.ok) return { ok: false, token: "" };
        const data = await res.json();
        return { ok: Boolean(data.ok), token: data.token || "" };
    } catch {
        return { ok: false, token: "" };
    }
}

// ── Canvas projects ──────────────────────────────────────────────────────

export function fetchBackendProjects() {
    return request<{ ok: boolean; projects?: Record<string, unknown>[] }>("GET", "/canvas/projects");
}

export function saveBackendProjects(projects: Record<string, unknown>[]) {
    return request<{ ok: boolean; projects?: Record<string, unknown>[] }>("PUT", "/canvas/projects", { projects });
}

export function upsertBackendProject(project: Record<string, unknown>) {
    return request<{ ok: boolean; project?: Record<string, unknown> }>("POST", "/canvas/projects", project);
}

// ── Assets ───────────────────────────────────────────────────────────────

export function fetchBackendAssets(options: { kind?: string; folderId?: string } = {}) {
    const params = new URLSearchParams();
    if (options.kind) params.set("kind", options.kind);
    if (options.folderId) params.set("folderId", options.folderId);
    const qs = params.toString();
    return request<{ ok: boolean; assets?: unknown[]; folders?: unknown[] }>("GET", `/canvas/assets${qs ? `?${qs}` : ""}`);
}

export function saveBackendAssets(assets: unknown[], folders: unknown[]) {
    return request<{ ok: boolean }>("PUT", "/canvas/assets", { assets, folders });
}

export function upsertBackendAsset(asset: Record<string, unknown>) {
    return request<{ ok: boolean; asset?: Record<string, unknown> }>("POST", "/canvas/assets", asset);
}

// ── Media ────────────────────────────────────────────────────────────────

export async function uploadBackendMedia(options: {
    name: string;
    blob: Blob;
    storageKey?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    durationMs?: number;
}): Promise<BackendMediaResult> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("Failed to read media"));
        reader.readAsDataURL(options.blob);
    });
    return uploadBackendMediaDataUrl({ name: options.name, storageKey: options.storageKey, dataUrl, mimeType: options.mimeType || options.blob.type || "application/octet-stream", width: options.width, height: options.height, durationMs: options.durationMs });
}

export async function uploadBackendMediaDataUrl(options: {
    name: string;
    dataUrl: string;
    storageKey?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    durationMs?: number;
}): Promise<BackendMediaResult> {
    const data = await request<{ ok: boolean; media: BackendMediaResult }>("POST", "/media/upload", options);
    return data.media;
}

export function backendMediaUrl(storageKey: string): string {
    return `${getBackendUrl().replace(/\/$/, "")}/media/${encodeURIComponent(storageKey)}?token=${encodeURIComponent(getBackendToken())}`;
}

export function deleteBackendMedia(storageKey: string) {
    return request<{ ok: boolean; deleted?: number }>("DELETE", `/media/${encodeURIComponent(storageKey)}`);
}

// ── Generation logs ──────────────────────────────────────────────────────

export type BackendGenerationLog = {
    id: string; projectId: string; nodeId?: string; segmentId?: string;
    status: "queued" | "running" | "success" | "failed" | "cancelled";
    platform: string; workflow?: string; model?: string; taskMode?: string; prompt?: string;
    references: Array<Record<string, unknown>>; inputCounts: Record<string, number>;
    runtimeTaskId?: string; promptId?: string;
    startedAt: string; finishedAt?: string; durationMs: number;
    outputs: Array<Record<string, unknown>>; error?: string;
    params: Record<string, unknown>; createdAt: string; updatedAt: string;
};

export function fetchBackendGenerationLogs(options: { projectId?: string; nodeId?: string; status?: string; limit?: number } = {}) {
    const params = new URLSearchParams();
    if (options.projectId) params.set("projectId", options.projectId);
    if (options.nodeId) params.set("nodeId", options.nodeId);
    if (options.status) params.set("status", options.status);
    if (options.limit) params.set("limit", String(options.limit));
    const qs = params.toString();
    return request<{ ok: boolean; logs?: BackendGenerationLog[] }>("GET", `/generation-logs${qs ? `?${qs}` : ""}`);
}

export function createBackendGenerationLog(input: Record<string, unknown>) {
    return request<{ ok: boolean; log?: BackendGenerationLog }>("POST", "/generation-logs", input);
}

export function updateBackendGenerationLog(id: string, patch: Record<string, unknown>) {
    return request<{ ok: boolean; log?: BackendGenerationLog }>("PATCH", `/generation-logs/${encodeURIComponent(id)}`, patch);
}

export function deleteBackendGenerationLogs(options: { id?: string; projectId?: string; nodeId?: string }) {
    const params = new URLSearchParams(Object.entries(options).filter(([, v]) => v) as [string, string][]);
    const qs = params.toString();
    return request<{ ok: boolean; deleted?: number }>("DELETE", `/generation-logs${qs ? `?${qs}` : ""}`);
}

// ── Tasks ────────────────────────────────────────────────────────────────

export function fetchBackendTask(id: string) {
    return request<{ ok: boolean; task?: Record<string, unknown>; events?: unknown[] }>("GET", `/tasks/${encodeURIComponent(id)}`);
}

export function createBackendTask(kind: string, input: Record<string, unknown> = {}, params: Record<string, unknown> = {}) {
    return request<{ ok: boolean; task?: Record<string, unknown> }>("POST", "/tasks", { kind, input, params });
}

export function cancelBackendTask(id: string) {
    return request<{ ok: boolean; task?: Record<string, unknown> }>("POST", `/tasks/${encodeURIComponent(id)}/cancel`);
}
