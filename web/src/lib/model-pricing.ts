import i18n from "@/i18n";

import type { ModelPricing } from "./model-catalog";
import type { ModelCapability } from "@/stores/use-config-store";

/**
 * Every price in ModelPricing is USD per token; providers quote them per million tokens,
 * which is also how OpenRouter displays them ("$60.00/M tokens" for an image-output rate).
 */
const TOKENS_PER_UNIT = 1_000_000;

/** Format a per-million-token rate with enough precision to distinguish cheap models. */
function formatRate(perToken: number): string {
    const value = perToken * TOKENS_PER_UNIT;
    if (value === 0) return "$0";
    if (value >= 1) return `$${value.toFixed(2)}`;
    if (value >= 0.01) return `$${value.toFixed(2)}`;
    return `$${value.toPrecision(2)}`;
}

/**
 * Short price label for a model, in the unit the provider actually publishes (per 1M tokens).
 * Returns "" when there is no usable price, so callers render nothing rather than a
 * misleading "$0.00" — and never a per-image figure, which no provider here reports.
 */
export function formatModelPrice(pricing: ModelPricing | undefined, capability: ModelCapability): string {
    if (!pricing) return "";
    if (capability === "image" && typeof pricing.imageOutputToken === "number") {
        return `${formatRate(pricing.imageOutputToken)} ${i18n.t("modelPricing.perMillionImageTokens")}`;
    }
    const { prompt, completion } = pricing;
    if (typeof prompt === "number" || typeof completion === "number") {
        const input = typeof prompt === "number" ? formatRate(prompt) : "—";
        const output = typeof completion === "number" ? formatRate(completion) : "—";
        return `${input} / ${output} ${i18n.t("modelPricing.perMillionTokens")}`;
    }
    if (typeof pricing.audio === "number") return `${formatRate(pricing.audio)} ${i18n.t("modelPricing.perMillionAudioTokens")}`;
    return "";
}

/** Full breakdown of every published rate, for tooltips in the channel editor and model list. */
export function describeModelPrice(pricing: ModelPricing | undefined): string {
    if (!pricing) return "";
    const parts: string[] = [];
    const add = (key: string, value: number | undefined) => {
        if (typeof value === "number") parts.push(`${i18n.t(`modelPricing.${key}`)}: ${formatRate(value)}/M`);
    };
    add("input", pricing.prompt);
    add("output", pricing.completion);
    add("imageOutput", pricing.imageOutputToken);
    add("imageInput", pricing.imageInputToken);
    add("audioInput", pricing.audio);
    return parts.join(" · ");
}
