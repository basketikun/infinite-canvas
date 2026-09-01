import { characterSwapLora, defaultH3Model } from "../constants";
import type { H3Ref, H3Segment } from "../types";

export function normalizeH3Model(value: unknown) {
    const model = String(value || "").trim();
    if (!model || /^(10eros\s*max\s*h3|minimax\s*h3)$/i.test(model)) return defaultH3Model;
    if (/hybrid_beta4_int8_convrot_2\.safetensors$/i.test(model)) return defaultH3Model;
    if (/hybrid_beta3_int8_convrot\.safetensors$/i.test(model)) return "h3\\10Eros_minimax_h3_TURBO-hybrid_beta3_int8_convrot.safetensors";
    const key = model.toLowerCase().replace(/^.*[\\/]/, "");
    const aliases: Record<string, string> = {
        "minimax_h3_ref2va_pruned_int8_convrot.safetensors": "h3\\minimax_h3_ref2va_pruned_int8_convrot.safetensors",
        "minimax_h3_ref2va_int8_convrot.safetensors": "h3\\minimax_h3_ref2va_int8_convrot.safetensors",
        "minimax_h3_fl2va_pruned_int8_convrot.safetensors": "h3\\minimax_h3_fl2va_pruned_int8_convrot.safetensors",
        "minimax_h3_fl2va_int8_convrot.safetensors": "h3\\minimax_h3_fl2va_int8_convrot.safetensors",
        "10eros_max_h3_turbo-hybrid_beta4_int8_convrot_2.safetensors": defaultH3Model,
        "10eros_minimax_h3_turbo-hybrid_beta4_int8_convrot_2.safetensors": defaultH3Model,
    };
    return aliases[key] || model;
}

export function compatibleH3Settings(segment: H3Segment, fallbackModel: string, fallbackLora: string, suppliedRefs: H3Ref[] = []) {
    const taskMode = String(segment.taskMode || "r2v");
    const segmentRefs = Array.isArray(segment.refItems) ? segment.refItems : [
        ...(segment.refs?.image || []),
        ...(segment.refs?.video || []),
        ...(segment.refs?.audio || []),
    ];
    const refs = [...segmentRefs, ...suppliedRefs].filter((ref, index, all) => all.findIndex((item) => sameRef(item, ref)) === index);
    const hasImage = refs.some((ref) => ref.type === "image");
    const hasVideo = refs.some((ref) => ref.type === "video");
    const imageToVideo = taskMode === "t2v" || taskMode === "i2v" || taskMode === "fl2v";
    const configuredModel = normalizeH3Model(segment.modelName || fallbackModel);
    const modelLooksCompatible = /hybrid|fl2va/i.test(configuredModel) || (imageToVideo ? /fl2va/i.test(configuredModel) : /ref2va/i.test(configuredModel));
    const modelName = taskMode === "rv2v" && hasImage && hasVideo
        ? "h3\\minimax_h3_ref2va_int8_convrot.safetensors"
        : modelLooksCompatible ? configuredModel : imageToVideo ? "h3\\minimax_h3_fl2va_pruned_int8_convrot.safetensors" : "h3\\minimax_h3_ref2va_pruned_int8_convrot.safetensors";
    const configuredLora = String(segment.loraName ?? fallbackLora ?? "");
    const loraName = taskMode === "rv2v" && hasImage && hasVideo ? characterSwapLora : configuredLora;
    return { modelName, loraName, defaultSteps: loraName.length > 0 ? 8 : 20 };
}

export function sameRef(left: H3Ref, right: H3Ref) {
    return Boolean(left.storageKey && right.storageKey) ? left.storageKey === right.storageKey : left.url === right.url;
}
