import type { AiTextMessage } from "@infinite-canvas/shared/model-execution";

import { imageReferenceLabel } from "@workbench/lib/image-reference-prompt";
import type { ReferenceImage } from "@workbench/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@workbench/types/media";
import { CanvasNodeType } from "@infinite-canvas/shared/canvas/schema/canvas";
import { parseComposerTokens } from "@infinite-canvas/shared/canvas/config-references";
import type { ReadonlyCanvasNode, ReadonlyCanvasConnection } from "@infinite-canvas/plugin-sdk";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { getGenerationResourceNodes, getGroupResourceNodes } from "@workbench/lib/canvas/canvas-resource-references";
import { readNodeResource } from "@workbench/lib/canvas/node-registry";

export type NodeGenerationContext = {
    prompt: string;
    signal: AbortSignal;
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
};

type NodeGenerationResourceInput = {
    nodeId: string;
    signal: AbortSignal;
    type: "text" | "image" | "video" | "audio";
    title: string;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
};

type NodeGenerationGroupInput = {
    nodeId: string;
    type: "group";
    title: string;
    children: NodeGenerationResourceInput[];
};

export type NodeGenerationInput = NodeGenerationResourceInput | NodeGenerationGroupInput;

export function buildNodeGenerationContext(nodeId: string, nodes: readonly ReadonlyCanvasNode[], connections: readonly ReadonlyCanvasConnection[], prompt: string, binding?: ScopeBinding): NodeGenerationContext {
    const inputs = buildNodeGenerationInputs(nodeId, nodes, connections, "execute", binding);
    const tokens = parseComposerTokens(prompt);
    if (tokens.some((token) => token.type === "reference")) {
        return buildComposerGenerationContext(inputs, tokens);
    }

    const resourceInputs = flattenGenerationInputs(inputs);
    let textIndex = 0;
    const upstreamText = resourceInputs.flatMap((input) => (input.text ? [textBlock(generationLabel("text", textIndex++), input.text)] : [])).join("\n\n");
    const referenceImages = resourceInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = resourceInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = resourceInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: upstreamText ? `${prompt}\n\n${upstreamText}` : prompt,
        signal: AbortSignal.any(resourceInputs.map((input) => input.signal)),
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: resourceInputs.filter((input) => input.type === "text").length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

function buildComposerGenerationContext(inputs: NodeGenerationInput[], tokens: ReturnType<typeof parseComposerTokens>): NodeGenerationContext {
    const inputByNodeId = new Map(inputs.map((input) => [input.nodeId, input]));
    const selectedInputs: NodeGenerationResourceInput[] = [];
    const labelByNodeId = new Map<string, string>();
    const textBlocks: string[] = [];
    const signals: AbortSignal[] = [];
    const counts = { image: 0, video: 0, audio: 0, text: 0 };
    let nextPrompt = "";

    for (const token of tokens) {
        if (token.type === "text") {
            nextPrompt += token.value;
            continue;
        }
        const input = inputByNodeId.get(token.nodeId);
        if (input) {
            const labels = flattenGenerationInputs([input]).map((resource) => {
                let label = labelByNodeId.get(resource.nodeId);
                if (!label) {
                    label = generationLabel(resource.type, counts[resource.type]++);
                    labelByNodeId.set(resource.nodeId, label);
                    signals.push(resource.signal);
                    if (resource.type === "text") textBlocks.push(textBlock(label, resource.text || ""));
                    else selectedInputs.push(resource);
                }
                return resource.type === "text" ? `【${label}】` : label;
            });
            nextPrompt += labels.join("、");
        }
    }

    if (textBlocks.length) nextPrompt = `${nextPrompt}\n\n${textBlocks.join("\n\n")}`;
    const referenceImages = selectedInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = selectedInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = selectedInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: nextPrompt,
        signal: AbortSignal.any(signals),
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: counts.text,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

export function buildNodeGenerationInputs(nodeId: string, nodes: readonly ReadonlyCanvasNode[], connections: readonly ReadonlyCanvasConnection[], mode: "render" | "execute" = "render", binding?: ScopeBinding): NodeGenerationInput[] {
    return getGenerationResourceNodes(nodeId, nodes, connections, mode, binding).flatMap((node): NodeGenerationInput[] => {
        if (node.type === CanvasNodeType.Group) {
            const children = getGroupResourceNodes(node.id, nodes, mode, binding).flatMap((child) => readNodeGenerationResource(child, mode, binding));
            return children.length ? [{ nodeId: node.id, type: "group", title: node.title, children }] : [];
        }
        return readNodeGenerationResource(node, mode, binding);
    });
}

function flattenGenerationInputs(inputs: NodeGenerationInput[]) {
    const resources = inputs.flatMap((input) => (input.type === "group" ? input.children : [input]));
    return [...new Map(resources.map((input) => [input.nodeId, input])).values()];
}

function readNodeGenerationResource(node: ReadonlyCanvasNode, mode: "render" | "execute", binding?: ScopeBinding): NodeGenerationResourceInput[] {
    const resource = readNodeResource(node, mode, binding);
    if (resource?.kind === "image" && (resource.storageKey || resource.url)) return [{ nodeId: node.id, signal: resource.signal, type: "image", title: node.title, image: { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata?.mimeType || "image/png", dataUrl: resource.url, storageKey: resource.storageKey } }];
    if (resource?.kind === "video" && (resource.storageKey || resource.url)) return [{ nodeId: node.id, signal: resource.signal, type: "video", title: node.title, video: { id: node.id, name: `${node.title || node.id}.mp4`, type: node.metadata?.mimeType || "video/mp4", url: resource.url, storageKey: resource.storageKey, bytes: node.metadata?.bytes, width: node.metadata?.naturalWidth, height: node.metadata?.naturalHeight, durationMs: node.metadata?.durationMs } }];
    if (resource?.kind === "audio" && (resource.storageKey || resource.url)) return [{ nodeId: node.id, signal: resource.signal, type: "audio", title: node.title, audio: { id: node.id, name: `${node.title || node.id}.mp3`, type: node.metadata?.mimeType || "audio/mpeg", url: resource.url, storageKey: resource.storageKey, durationMs: node.metadata?.durationMs } }];
    if (resource?.kind === "text" && resource.text) return [{ nodeId: node.id, signal: resource.signal, type: "text", title: node.title, text: resource.text }];
    return [];
}

export function buildNodeResponseMessages(context: NodeGenerationContext): AiTextMessage[] {
    if (!context.referenceImages.length) {
        return [{ role: "user", content: context.prompt }];
    }

    return [
        {
            role: "user",
            content: [{ type: "text" as const, text: context.prompt }, ...context.referenceImages.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl, storageKey: image.storageKey } }))],
        },
    ];
}

function textBlock(label: string, text: string) {
    return `【${label}】\n${text}`;
}

function generationLabel(type: NodeGenerationResourceInput["type"], index: number) {
    if (type === "image") return imageReferenceLabel(index);
    if (type === "video") return "参考视频" + ` ${index + 1}`;
    if (type === "audio") return "参考音频" + ` ${index + 1}`;
    return `文本${index + 1}`;
}

