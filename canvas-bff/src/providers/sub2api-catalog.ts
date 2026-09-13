import { createHash } from "node:crypto";

import { HttpError } from "../http/errors.js";

export const SUB2API_CATALOG_PATHS = [
    "/api/v1/keys",
    "/api/v1/groups/available",
    "/api/v1/groups/rates",
    "/api/v1/channels/available",
] as const;

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

type FetchLike = typeof fetch;

export class Sub2ApiCatalogAdapter {
    private readonly baseUrl: string;
    private readonly fetchImpl: FetchLike;
    private readonly timeoutMs: number;

    constructor(baseUrl: string, fetchImpl: FetchLike = fetch, timeoutMs = 5_000) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.fetchImpl = fetchImpl;
        this.timeoutMs = timeoutMs;
    }

    async listCatalog(accessToken: string): Promise<ProviderCatalog> {
        const [keys, groups, rates, channels] = await Promise.all([
            this.listPath("/api/v1/keys", accessToken),
            this.listPath("/api/v1/groups/available", accessToken),
            this.listPath("/api/v1/groups/rates", accessToken),
            this.listPath("/api/v1/channels/available", accessToken),
        ]);
        return {
            keys: keys.map((item) => normalizeCatalogItem(item, true)),
            groups: groups.map((item) => normalizeCatalogItem(item)),
            rates: rates.map((item) => normalizeCatalogItem(item)),
            channels: channels.map((item) => normalizeCatalogItem(item)),
        };
    }

    async getApiKeySecret(accessToken: string, keyId: string): Promise<{ secret: string; item: ProviderCatalogItem }> {
        const records = await this.listPath("/api/v1/keys", accessToken);
        const match = records.find((item) => String(item.id ?? item.key_id ?? item.keyId ?? "") === keyId);
        if (!match) throw new HttpError(404, "SUB2API_KEY_NOT_FOUND", "Sub2API API key was not found");
        const secret = asString(match.key ?? match.api_key ?? match.apiKey);
        if (!secret) throw new HttpError(502, "SUB2API_INVALID_RESPONSE", "Sub2API API key response is missing a key");
        return { secret, item: normalizeCatalogItem(match, true) };
    }

    async listModels(apiKey: string, baseUrl = this.baseUrl): Promise<string[]> {
        if (!apiKey.trim()) throw new HttpError(400, "PROVIDER_SECRET_REQUIRED", "Provider secret is required");
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await this.fetchImpl(`${baseUrl.replace(/\/$/, "")}/v1/models`, { headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` }, signal: controller.signal });
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) throw new HttpError(401, "PROVIDER_UNAUTHORIZED", "Sub2API rejected this provider API key");
                throw new HttpError(502, "PROVIDER_MODELS_UNAVAILABLE", "Provider models are unavailable");
            }
            const body = await response.json() as { data?: unknown; models?: unknown };
            return modelNames(body.data ?? body.models);
        } catch (error) {
            if (error instanceof HttpError) throw error;
            if (error instanceof Error && error.name === "AbortError") throw new HttpError(503, "PROVIDER_MODELS_TIMEOUT", "Provider model list timed out");
            throw new HttpError(503, "PROVIDER_MODELS_UNAVAILABLE", "Provider model list could not be loaded");
        } finally {
            clearTimeout(timeout);
        }
    }

    private async listPath(path: (typeof SUB2API_CATALOG_PATHS)[number], accessToken: string): Promise<Record<string, unknown>[]> {
        if (!SUB2API_CATALOG_PATHS.includes(path)) throw new Error("Sub2API catalog path is not allowlisted");
        if (!accessToken.trim()) throw new HttpError(401, "SUB2API_TOKEN_REQUIRED", "A Sub2API access token is required for catalog access");
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
                headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
                signal: controller.signal,
            });
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) throw new HttpError(401, "SUB2API_UNAUTHORIZED", "Sub2API rejected the session");
                throw new HttpError(502, "SUB2API_CATALOG_UNAVAILABLE", "Sub2API catalog is unavailable");
            }
            const body = await response.json() as { data?: unknown };
            return asRecords(body.data);
        } catch (error) {
            if (error instanceof HttpError) throw error;
            if (error instanceof Error && error.name === "AbortError") throw new HttpError(503, "SUB2API_UNAVAILABLE", "Sub2API did not respond in time");
            throw new HttpError(503, "SUB2API_UNAVAILABLE", "Sub2API could not be reached");
        } finally {
            clearTimeout(timeout);
        }
    }
}

function normalizeCatalogItem(value: Record<string, unknown>, keyRecord = false): ProviderCatalogItem {
    const id = asString(value.id ?? value.key_id ?? value.keyId ?? value.name) ?? "unknown";
    const secret = keyRecord ? asString(value.key ?? value.api_key ?? value.apiKey) : undefined;
    return {
        id,
        name: asString(value.name ?? value.display_name ?? value.displayName ?? value.label) ?? id,
        ...(asString(value.provider ?? value.provider_type ?? value.providerType) ? { providerType: asString(value.provider ?? value.provider_type ?? value.providerType) } : {}),
        ...(asString(value.model ?? value.model_name ?? value.modelName) ? { model: asString(value.model ?? value.model_name ?? value.modelName) } : {}),
        ...(asString(value.group ?? value.group_name ?? value.groupName) ? { group: asString(value.group ?? value.group_name ?? value.groupName) } : {}),
        ...(asString(value.channel ?? value.channel_name ?? value.channelName) ? { channel: asString(value.channel ?? value.channel_name ?? value.channelName) } : {}),
        ...(secret ? { fingerprint: createHash("sha256").update(secret).digest("hex").slice(0, 16), maskedKey: `****${secret.slice(-4)}` } : {}),
        ...(asString(value.status) ? { status: asString(value.status) } : {}),
    };
}

function asRecords(value: unknown): Record<string, unknown>[] {
    const source = Array.isArray(value) ? value : value && typeof value === "object" && "items" in value ? (value as { items?: unknown }).items : [];
    return Array.isArray(source) ? source.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : value === undefined || value === null ? undefined : String(value);
}

function modelNames(value: unknown): string[] {
    const records = Array.isArray(value) ? value : value && typeof value === "object" && "items" in value ? (value as { items?: unknown }).items : [];
    if (!Array.isArray(records)) return [];
    return [...new Set(records.map((item) => {
        if (typeof item === "string") return item.trim();
        if (!item || typeof item !== "object") return "";
        const record = item as Record<string, unknown>;
        return asString(record.id ?? record.name ?? record.model) || "";
    }).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
