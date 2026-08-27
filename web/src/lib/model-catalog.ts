import type { ModelCapability } from "@/stores/use-config-store";

/**
 * Normalized per-model price. Every field is USD **per token** — that is the unit OpenRouter
 * actually publishes and displays, including for images: it shows `image_output` of 0.00006 as
 * "$60.00/M tokens", not as a per-image price. (The OpenAPI description calling it "per output
 * image" is stale; the values contradict it — `image` equals `prompt` exactly on Gemini models.)
 * Absent keys mean the provider does not publish that price.
 */
export type ModelPricing = {
    /** USD per input (prompt) token. */
    prompt?: number;
    /** USD per output (completion) token. */
    completion?: number;
    /** USD per generated-image token. */
    imageOutputToken?: number;
    /** USD per input (reference) image token. */
    imageInputToken?: number;
    /** USD per audio input token. */
    audio?: number;
    /** Epoch ms of the catalog fetch that produced this, for staleness display. */
    fetchedAt: number;
};

/** One entry of a provider's live model catalog, with whatever metadata the provider publishes. */
export type CatalogModel = {
    id: string;
    /** Human-readable name from the provider, when it publishes one. */
    label?: string;
    /** e.g. ["text", "image"]. Absent when the provider publishes no modality metadata. */
    outputModalities?: string[];
    inputModalities?: string[];
    pricing?: ModelPricing;
};

/**
 * Parse a provider's price value into USD per unit.
 * Providers use sentinels for "not applicable" (OpenRouter sends the string "-1" for its auto-router),
 * so anything negative or non-finite is treated as unknown rather than as a real price of zero.
 */
export function parsePrice(value: unknown, scale = 1): number | undefined {
    if (value === null || value === undefined || value === "") return undefined;
    const parsed = typeof value === "number" ? value : Number(String(value));
    if (!Number.isFinite(parsed) || parsed < 0) return undefined;
    return parsed * scale;
}

/** Drop a pricing object that carries no usable numbers, so callers can render nothing instead of "$0.00". */
export function normalizePricing(pricing: Omit<ModelPricing, "fetchedAt">, fetchedAt = Date.now()): ModelPricing | undefined {
    const entries = Object.entries(pricing).filter(([, value]) => typeof value === "number");
    if (!entries.length) return undefined;
    return { ...(Object.fromEntries(entries) as Omit<ModelPricing, "fetchedAt">), fetchedAt };
}

/**
 * Capability implied by a provider's declared output modalities — authoritative, unlike name guessing.
 * Image wins over text when a model does both, because this app selects such models to make pictures.
 */
export function capabilityFromModalities(outputModalities: string[] | undefined): ModelCapability | undefined {
    if (!outputModalities?.length) return undefined;
    const modalities = outputModalities.map((value) => value.toLowerCase());
    if (modalities.includes("video")) return "video";
    if (modalities.includes("image")) return "image";
    if (modalities.includes("audio")) return "audio";
    if (modalities.includes("text")) return "text";
    return undefined;
}

/** True when a provider says the model accepts image input (image-to-image / editing). */
export function acceptsImageInput(inputModalities: string[] | undefined): boolean | undefined {
    if (!inputModalities?.length) return undefined;
    return inputModalities.some((value) => value.toLowerCase() === "image");
}

/** Narrow a catalog down to bare ids, for the call sites that only need names. */
export function catalogModelIds(models: CatalogModel[]): string[] {
    return models.map((model) => model.id).filter(Boolean);
}

/** Wrap plain ids as catalog entries, for providers that publish no metadata. */
export function catalogFromIds(ids: string[]): CatalogModel[] {
    return ids.filter(Boolean).map((id) => ({ id }));
}
