import type { AiConfig } from "../../../../stores/use-config-store";

import type { CanvasGenerationMode, CanvasNodeData } from "../types";

export const CANVAS_IMAGE_GENERATION_COUNT = 1;
const FALLBACK_MODEL = "default::gpt-image-2";
const FALLBACK_QUALITY = "auto";
const FALLBACK_SIZE = "1:1";

export function buildCanvasImageGenerationConfig(config: AiConfig, node?: CanvasNodeData): AiConfig {
    return {
        ...config,
        model: resolveCanvasGenerationNodeModel(node, "image") || config.imageModel || config.model || FALLBACK_MODEL,
        quality: node?.metadata?.quality || config.quality || FALLBACK_QUALITY,
        size: node?.metadata?.size || config.size || FALLBACK_SIZE,
        count: String(CANVAS_IMAGE_GENERATION_COUNT),
    };
}

export function resolveCanvasGenerationNodeModel(node: CanvasNodeData | undefined, mode: CanvasGenerationMode) {
    if (!node?.metadata?.model) return "";
    if (node.type === "config") return node.metadata.model;
    if (mode === "image" && node.type === "image") return node.metadata.model;
    if (mode === "video" && node.type === "video") return node.metadata.model;
    if (mode === "audio" && node.type === "audio") return node.metadata.model;
    if (mode === "text" && node.type === "text") return node.metadata.model;
    return "";
}
