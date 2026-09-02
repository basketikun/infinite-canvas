import { defaultConfig, resolveModelForCapability, type AiConfig } from "@/stores/use-config-store";
import i18n from "@/i18n";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { imageMetadata, referenceUrl } from "@/lib/canvas/canvas-node-factory";
import type { NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export function imageExtension(dataUrl: string) {
    return dataUrl.match(/^data:image[/]([^;]+)/)?.[1] || dataUrl.match(/image[/]([^;]+)/)?.[1] || "png";
}

export function audioExtension(mimeType?: string) {
    if (mimeType?.includes("wav")) return "wav";
    if (mimeType?.includes("opus")) return "opus";
    if (mimeType?.includes("aac")) return "aac";
    if (mimeType?.includes("flac")) return "flac";
    if (mimeType?.includes("pcm")) return "pcm";
    return "mp3";
}

export function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios?: Array<{ storageKey?: string; url?: string }> }) {
    return [
        ...context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)),
        ...context.referenceVideos.map((video) => video.storageKey || video.url).filter((url): url is string => Boolean(url)),
        ...(context.referenceAudios || []).map((audio) => audio.storageKey || audio.url).filter((url): url is string => Boolean(url)),
    ];
}

export async function resolveMetadataReferences(metadata: CanvasNodeMetadata) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    const references = await Promise.all(
        metadata.references.map(async (url, index) => {
            const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
            return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, storageKey: url.startsWith("image:") ? url : undefined } : null;
        }),
    );
    return references.every(Boolean) ? (references as ReferenceImage[]) : null;
}

export async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    return Promise.all(
        nodes.map(async (node) => {
            const metadata = node.metadata;
            const content = metadata?.content;
            const hydrateH3Ref = async <T extends { url?: string; dataUrl?: string; storageKey?: string; type?: string }>(ref: T) => {
                const fallback = ref.url || ref.dataUrl || "";
                if (!ref.storageKey) {
                    if (!/^blob:|^data:/i.test(fallback)) return ref;
                    try {
                        const stored = await uploadImage(fallback);
                        return { ...ref, url: stored.url, ...(ref.dataUrl !== undefined ? { dataUrl: stored.url } : {}), storageKey: stored.storageKey };
                    } catch {
                        return ref;
                    }
                }
                const url = ref.type?.startsWith("image") || ref.dataUrl !== undefined
                    ? await resolveImageUrl(ref.storageKey, fallback)
                    : await resolveMediaUrl(ref.storageKey, fallback);
                return { ...ref, url, ...(ref.dataUrl !== undefined ? { dataUrl: url } : {}) };
            };
            const extendedMetadata = metadata as (CanvasNodeMetadata & Record<string, unknown>) | undefined;
            const isH3Node = Boolean(extendedMetadata && (node.type === CanvasNodeType.Video || node.type === "minimax-h3:video" || Array.isArray(extendedMetadata.segments) || (extendedMetadata.h3Refs && typeof extendedMetadata.h3Refs === "object")));
            if (isH3Node && extendedMetadata) {
                const segments = Array.isArray(extendedMetadata.segments) ? await Promise.all(extendedMetadata.segments.map(async (segment: unknown) => {
                    if (!segment || typeof segment !== "object") return segment;
                    const value = segment as Record<string, unknown>;
                    const refs = Array.isArray(value.refItems) ? await Promise.all(value.refItems.map((ref) => ref && typeof ref === "object" ? hydrateH3Ref(ref as { url?: string; dataUrl?: string; storageKey?: string; type?: string }) : ref)) : value.refItems;
                    const grouped = value.refs && typeof value.refs === "object" ? Object.fromEntries(await Promise.all(Object.entries(value.refs as Record<string, unknown>).map(async ([kind, list]) => [kind, Array.isArray(list) ? await Promise.all(list.map((ref) => ref && typeof ref === "object" ? hydrateH3Ref({ ...(ref as Record<string, unknown>), type: kind } as { url?: string; dataUrl?: string; storageKey?: string; type?: string }) : ref)) : list]))) : value.refs;
                    const result = typeof value.result === "string" && value.resultStorageKey
                        ? await resolveMediaUrl(String(value.resultStorageKey), value.result)
                        : value.result;
                    const results = Array.isArray(value.results)
                        ? await Promise.all(value.results.map((item) => item && typeof item === "object" ? hydrateH3Ref({ ...(item as Record<string, unknown>), type: "video" } as { url?: string; dataUrl?: string; storageKey?: string; type?: string }) : item))
                        : value.results;
                    return { ...value, ...(Array.isArray(refs) ? { refItems: refs } : {}), ...(grouped ? { refs: grouped } : {}), ...(result !== undefined ? { result } : {}), ...(Array.isArray(results) ? { results } : {}) };
                })) : extendedMetadata.segments;
                const h3Refs = extendedMetadata.h3Refs && typeof extendedMetadata.h3Refs === "object" ? Object.fromEntries(await Promise.all(Object.entries(extendedMetadata.h3Refs as Record<string, unknown>).map(async ([kind, list]) => [kind, Array.isArray(list) ? await Promise.all(list.map((ref) => ref && typeof ref === "object" ? hydrateH3Ref({ ...(ref as Record<string, unknown>), type: kind } as { url?: string; dataUrl?: string; storageKey?: string; type?: string }) : ref)) : list]))) : extendedMetadata.h3Refs;
                const h3CharacterAssets = Array.isArray(extendedMetadata.h3CharacterAssets) ? await Promise.all(extendedMetadata.h3CharacterAssets.map(async (asset: unknown) => {
                    if (!asset || typeof asset !== "object") return asset;
                    const value = asset as Record<string, unknown>;
                    if (!Array.isArray(value.images)) return asset;
                    const images = await Promise.all(value.images.map((image) => image && typeof image === "object" ? hydrateH3Ref({ ...(image as Record<string, unknown>), type: "image" } as { url?: string; dataUrl?: string; storageKey?: string; type?: string }) : image));
                    return { ...value, images };
                })) : extendedMetadata.h3CharacterAssets;
                const materials = Array.isArray(extendedMetadata.materials)
                    ? await Promise.all(extendedMetadata.materials.map((item) => item && typeof item === "object" ? hydrateH3Ref({ ...(item as Record<string, unknown>), type: "video" } as { url?: string; dataUrl?: string; storageKey?: string; type?: string }) : item))
                    : extendedMetadata.materials;
                const outputContent = extendedMetadata.storageKey
                    ? await resolveMediaUrl(String(extendedMetadata.storageKey), content || "")
                    : content;
                return { ...node, metadata: { ...metadata, ...(outputContent !== undefined ? { content: outputContent } : {}), ...(Array.isArray(segments) ? { segments } : {}), ...(h3Refs ? { h3Refs } : {}), ...(Array.isArray(h3CharacterAssets) ? { h3CharacterAssets } : {}), ...(Array.isArray(materials) ? { materials } : {}) } };
            }
            if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && metadata?.storageKey) return { ...node, metadata: { ...metadata, content: await resolveMediaUrl(metadata.storageKey, content) } };
            if (node.type !== CanvasNodeType.Image || !metadata || !content) return node;
            const images = await Promise.all((metadata.images || []).map(async (image) => (image.content ? { ...image, content: await resolveImageUrl(image.storageKey, image.content) } : image)));
            if (metadata.storageKey) return { ...node, metadata: { ...metadata, content: await resolveImageUrl(metadata.storageKey, content), images } };
            if (!content.startsWith("data:image/")) return node;
            return { ...node, metadata: { ...metadata, ...imageMetadata(await uploadImage(content)) } };
        }),
    );
}

export async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydrateItem = async <T extends { dataUrl?: string; storageKey?: string }>(item: T) => {
        if (item.storageKey) return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        if (item.dataUrl?.startsWith("data:image/")) {
            const image = await uploadImage(item.dataUrl);
            return { ...item, dataUrl: image.url, storageKey: image.storageKey };
        }
        return item;
    };
    return Promise.all(
        sessions.map(async (session) => ({
            ...session,
            messages: await Promise.all(
                session.messages.map(async (message) => ({
                    ...message,
                    references: await Promise.all((message.references || []).map(hydrateItem)),
                })),
            ),
        })),
    );
}

export function getGenerationCount(count: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
}

export function getInputSummary(inputs: NodeGenerationInput[]) {
    const resources = [...new Map(inputs.flatMap((input) => (input.type === "group" ? input.children : [input])).map((input) => [input.nodeId, input])).values()];
    return {
        textCount: resources.filter((input) => input.type === "text").length,
        imageCount: resources.filter((input) => input.type === "image").length,
        videoCount: resources.filter((input) => input.type === "video").length,
        audioCount: resources.filter((input) => input.type === "audio").length,
    };
}

export function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    return {
        ...config,
        model: resolveModelForCapability(config, node?.metadata?.model, mode),
        reasoningEffort: node?.metadata?.reasoningEffort || config.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: node?.metadata?.size || config.size || defaultConfig.size,
        background: node?.metadata?.background ?? config.background ?? defaultConfig.background,
        videoSeconds: node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        vquality: node?.metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        count: String(node?.metadata?.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
}

export function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    return nodes.map((node) =>
        node.metadata?.status === "loading"
            ? {
                  ...node,
                  metadata: {
                      ...node.metadata,
                      status: "error" as const,
                      errorDetails: i18n.t("canvas.generation.interrupted"),
                      images: node.metadata.images?.map((image) => (image.status === "loading" ? { ...image, status: "error" as const, errorDetails: i18n.t("canvas.generation.interrupted") } : image)),
                      texts: node.metadata.texts?.map((text) => (text.status === "loading" ? { ...text, status: "error" as const, errorDetails: i18n.t("canvas.generation.interrupted") } : text)),
                  },
              }
            : node,
    );
}

export function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === i18n.t("common.requestCanceled") || error.name === "AbortError");
}

export function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const queue = connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.find((item) => item.id === id);
        if (node?.type === CanvasNodeType.Config) return node;
        connections.filter((connection) => connection.toNodeId === id).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return null;
}

export function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    if (!node || node.type !== CanvasNodeType.Image || !node.metadata?.content) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata.mimeType || "image/png",
            dataUrl: node.metadata.content,
            storageKey: node.metadata.storageKey,
        },
    ];
}

export function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name);
}

export function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? i18n.t("canvas.generation.front") : params.horizontalAngle > 0 ? i18n.t("canvas.generation.rotateRight", { angle: params.horizontalAngle }) : i18n.t("canvas.generation.rotateLeft", { angle: Math.abs(params.horizontalAngle) });
    const pitch = params.pitchAngle === 0 ? i18n.t("canvas.generation.level") : params.pitchAngle > 0 ? i18n.t("canvas.generation.topDown", { angle: params.pitchAngle }) : i18n.t("canvas.generation.lowAngle", { angle: Math.abs(params.pitchAngle) });
    return i18n.t("canvas.generation.angleLabel", { horizontal, pitch, distance: params.cameraDistance.toFixed(1), lens: i18n.t(params.wideAngle ? "canvas.editors.wide" : "canvas.editors.standard") });
}

export function buildAnglePrompt(params: CanvasImageAngleParams) {
    return i18n.t("canvas.generation.anglePrompt", { angle: buildAngleLabel(params) });
}
