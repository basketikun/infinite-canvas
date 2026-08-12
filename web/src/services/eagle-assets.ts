import type { Asset } from "@/stores/use-asset-store";

type EagleListResponse = { assets: Asset[]; folders: Array<{ id: string; name: string; parent?: string }> };
export type EagleConnection = { connected: boolean; version?: string; buildVersion?: string; error?: string };

type EagleWriteResponse<T> = { status: "success" | "error"; data?: T; message?: string };

async function eagleWrite<T>(url: string, init: RequestInit) {
    const response = await fetch(url, init);
    const payload = (await response.json()) as EagleWriteResponse<T>;
    if (!response.ok || payload.status === "error") throw new Error(payload.message || `Eagle bridge returned HTTP ${response.status}`);
    return payload.data as T;
}

export async function fetchEagleAssets(signal?: AbortSignal) {
    const response = await fetch("/api/eagle/items", { signal });
    const payload = (await response.json()) as { status: "success" | "error"; data?: EagleListResponse; message?: string };
    if (!response.ok || payload.status === "error" || !payload.data) throw new Error(payload.message || `Eagle bridge returned HTTP ${response.status}`);
    return payload.data;
}

export async function fetchEagleConnection(signal?: AbortSignal): Promise<EagleConnection> {
    try {
        const response = await fetch("/api/eagle/status", { signal });
        const payload = (await response.json()) as { status: "success" | "error"; connected?: boolean; data?: EagleConnection; message?: string };
        if (!response.ok || payload.status === "error") throw new Error(payload.message || `Eagle bridge returned HTTP ${response.status}`);
        return { connected: Boolean(payload.connected), ...payload.data };
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        return { connected: false, error: error instanceof Error ? error.message : "Eagle is unavailable" };
    }
}

export async function createEagleAsset(input: { base64: string; name?: string; tags?: string[]; annotation?: string }) {
    return eagleWrite<{ id?: string; ids?: string[] }>("/api/eagle/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
}

export async function createEagleTextAsset(input: { content: string; name?: string; tags?: string[]; annotation?: string }) {
    return eagleWrite<{ id?: string; ids?: string[] }>("/api/eagle/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "text", ...input }),
    });
}

export async function updateEagleAsset(asset: Asset, patch: { name: string; tags: string[]; annotation: string; content?: string }) {
    const id = asset.metadata?.eagleItemId;
    if (typeof id !== "string") throw new Error("Eagle asset id is missing");
    return eagleWrite<boolean>(`/api/eagle/items/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
    });
}

export async function deleteEagleAsset(asset: Asset) {
    const id = asset.metadata?.eagleItemId;
    if (typeof id !== "string") throw new Error("Eagle asset id is missing");
    return eagleWrite<boolean>(`/api/eagle/items/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function isEagleAsset(asset: Asset) {
    return asset.metadata?.source === "eagle" && typeof asset.metadata.eagleItemId === "string";
}
