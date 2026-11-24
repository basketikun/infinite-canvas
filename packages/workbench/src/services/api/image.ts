import { nanoid } from "nanoid";

import { channelWrites, resolveModelRequestConfig, type AiConfig } from "@workbench/stores/use-config-store";
import { callScriptsReady } from "@workbench/stores/use-call-script-store";
import { models } from "./models/runtime";
import type { ModelRequestOptions } from "./models/types";
import type { AiTextMessage } from "@infinite-canvas/shared/model-execution";
import { buildImageReferencePromptText } from "@workbench/lib/image-reference-prompt";
import { imageSizePresets } from "@workbench/lib/media-size";
import type { ReferenceImage } from "@workbench/types/image";

const DEFAULT_IMAGE_SHORT_SIDE = 1024;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MAX_RATIO = 3;

/** Map a bare ratio such as "1:1" to an explicit pixel dimension like "1024x1024". */
function resolveSize(ratio: string): string {
    const parsedRatio = parseImageRatio(ratio);
    const preset = imageSizePresets["1k"][ratio];
    if (preset) return preset;
    const isLandscape = parsedRatio.width >= parsedRatio.height;
    const longRatio = isLandscape ? parsedRatio.width / parsedRatio.height : parsedRatio.height / parsedRatio.width;
    const shortSide = DEFAULT_IMAGE_SHORT_SIDE;
    const longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    const width = isLandscape ? longSide : shortSide;
    const height = isLandscape ? shortSide : longSide;
    return `${width}x${height}`;
}

function parseRatioValue(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error("图像比例必须是正数，例如 9:16");
    return { width: w, height: h };
}

function parseImageRatio(value: string) {
    const ratio = parseRatioValue(value);
    if (Math.max(ratio.width, ratio.height) / Math.min(ratio.width, ratio.height) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    return ratio;
}

function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function resolveRequestSize(size: string) {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    const dimensions = parseImageDimensions(value);
    if (dimensions) {
        return `${dimensions.width}x${dimensions.height}`;
    }
    if (value.includes(":")) return resolveSize(value);
    throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], options?: ModelRequestOptions) {
    return requestGeneration(config, buildImageReferencePromptText(prompt, references), options, references);
}

export async function requestGeneration(config: AiConfig, prompt: string, options?: ModelRequestOptions, references: ReferenceImage[] = []) {
    await Promise.all([callScriptsReady, channelWrites.flush()]);
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const dimensions = parseImageDimensions(config.size);
    const ratio = dimensions ? `${dimensions.width}:${dimensions.height}` : config.size === "auto" ? undefined : config.size;
    const resolution = dimensions ? Object.keys(imageSizePresets).find((scale) => Object.values(imageSizePresets[scale]).includes(config.size))?.toUpperCase() : undefined;
    const result = await models.generateImages({
        call: requestConfig,
        prompt: config.systemPrompt ? `${config.systemPrompt}\n\n${prompt}` : prompt,
        images: references.map((image) => ({ url: image.url || image.dataUrl, storageKey: image.storageKey })),
        options: {
            size: resolveRequestSize(config.size),
            ratio,
            resolution,
            quality: config.quality,
            count: Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1))),
            background: config.background,
        },
    }, options);
    return result.map((dataUrl) => ({ id: nanoid(), dataUrl }));
}

export async function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: ModelRequestOptions) {
    await Promise.all([callScriptsReady, channelWrites.flush()]);
    const requestConfig = resolveModelRequestConfig(config, config.model || config.textModel);
    return models.generateText({
        call: requestConfig,
        messages: config.systemPrompt ? [{ role: "system", content: config.systemPrompt }, ...messages] : messages,
    }, { ...options, onEvent: (event) => onDelta(event.text) });
}

