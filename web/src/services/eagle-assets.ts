import type { Asset } from "@/stores/use-asset-store";

type EagleListResponse = { assets: Asset[]; folders: Array<{ id: string; name: string; parent?: string }> };
export type EagleConnection = { connected: boolean; version?: string; buildVersion?: string; error?: string };

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

export function isEagleAsset(asset: Asset) {
    return asset.metadata?.source === "eagle" && typeof asset.metadata.eagleItemId === "string";
}
