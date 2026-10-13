import { defaultConfig, resolveModelForCapability, type AiConfig } from "@/stores/use-config-store";
import i18n from "@/i18n";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { liveMediaFallback, resolveMediaUrl } from "@/services/file-storage";
import { MULTIVIEW_VIEWS, type MultiviewView } from "@/services/api/model3d-ops";
import { imageMetadata, referenceUrl } from "@/lib/canvas/canvas-node-factory";
import { buildNodeGenerationInputs, flattenGenerationInputs, type NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
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

/**
 * A 3D node's own file is not always a glb: rig and retarget can emit FBX, so the extension follows the
 * stored mime rather than the generation default. Conversion artifacts are named from their format instead,
 * since they live on a separate key.
 */
export function model3dExtension(mimeType?: string) {
    if (mimeType?.includes("fbx")) return "fbx";
    if (mimeType?.includes("gltf+json")) return "gltf";
    if (mimeType?.includes("3mf")) return "3mf";
    if (mimeType?.includes("obj")) return "obj";
    if (mimeType?.includes("stl")) return "stl";
    if (mimeType?.includes("usd")) return "usdz";
    return "glb";
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
            if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && metadata?.storageKey) return { ...node, metadata: { ...metadata, content: await resolveMediaUrl(metadata.storageKey, content) } };
            // Tripo's signed URLs expire, so the 3D node reads both the model and its preview back from local storage.
            // Both are cleared when storage cannot produce them, rather than left holding the blob: URL the last
            // session handed out: that URL is dead on arrival, and an empty preview is what makes the node render
            // once and save a new still instead of showing a broken image.
            if (node.type === CanvasNodeType.Model3d && metadata) {
                const preview = metadata.model3dPreviewKey ? await resolveMediaUrl(metadata.model3dPreviewKey, metadata.model3dPreview) : liveMediaFallback(metadata.model3dPreview || "");
                return {
                    ...node,
                    metadata: {
                        ...metadata,
                        content: metadata.storageKey ? await resolveMediaUrl(metadata.storageKey, content) : liveMediaFallback(content || ""),
                        model3dPreview: preview,
                        ...(preview ? {} : { model3dPreviewKey: undefined }),
                    },
                };
            }
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

/**
 * Parameter keys a config node can hand downstream. Deliberately a whitelist: a parameter node carries the same
 * metadata shape as any other node, and passing it wholesale would drag `content`, `prompt`, `storageKey` and
 * `status` into the node being generated.
 */
export const PARAMETER_METADATA_KEYS = [
    "model",
    "reasoningEffort",
    "quality",
    "size",
    "background",
    "imageTemplate",
    "count",
    "textCount",
    "seconds",
    "vquality",
    "generateAudio",
    "watermark",
    "videoMode",
    "audioVoice",
    "audioFormat",
    "audioSpeed",
    "audioInstructions",
    "model3dTexture",
    "model3dPbr",
    "model3dTextureQuality",
    "model3dFaceLimit",
    "model3dQuad",
] as const satisfies ReadonlyArray<keyof CanvasNodeMetadata>;

export type ParameterMetadata = Pick<CanvasNodeMetadata, (typeof PARAMETER_METADATA_KEYS)[number]>;

export function pickParameterMetadata(metadata: CanvasNodeMetadata | undefined): ParameterMetadata {
    if (!metadata) return {};
    return Object.fromEntries(PARAMETER_METADATA_KEYS.flatMap((key) => (metadata[key] === undefined ? [] : [[key, metadata[key]]]))) as ParameterMetadata;
}

/**
 * Resolves the config a node generates with. An upstream parameter node (a config node wired into this node)
 * wins over the node's own metadata, which in turn wins over the global config.
 */
export function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode, parameters?: ParameterMetadata): AiConfig {
    const metadata = { ...node?.metadata, ...parameters };
    return {
        ...config,
        model: resolveModelForCapability(config, metadata.model, mode),
        reasoningEffort: metadata.reasoningEffort || config.reasoningEffort || defaultConfig.reasoningEffort,
        quality: metadata.quality || config.quality || defaultConfig.quality,
        size: metadata.size || config.size || defaultConfig.size,
        background: metadata.background ?? config.background ?? defaultConfig.background,
        imageTemplate: metadata.imageTemplate ?? config.imageTemplate ?? defaultConfig.imageTemplate,
        videoSeconds: metadata.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        vquality: metadata.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: metadata.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: metadata.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        videoMode: metadata.videoMode || config.videoMode || defaultConfig.videoMode,
        audioVoice: metadata.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: metadata.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: metadata.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: metadata.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        model3dTexture: metadata.model3dTexture || config.model3dTexture || defaultConfig.model3dTexture,
        model3dPbr: metadata.model3dPbr || config.model3dPbr || defaultConfig.model3dPbr,
        model3dTextureQuality: metadata.model3dTextureQuality || config.model3dTextureQuality || defaultConfig.model3dTextureQuality,
        model3dFaceLimit: metadata.model3dFaceLimit ?? config.model3dFaceLimit ?? defaultConfig.model3dFaceLimit,
        model3dQuad: metadata.model3dQuad || config.model3dQuad || defaultConfig.model3dQuad,
        count: String(metadata.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
}

export function hasResumableVideoTask(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Video && Boolean(node.metadata?.videoTaskId) && !node.metadata?.content;
}

export function hasResumableModel3dTask(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Model3d && Boolean(node.metadata?.model3dTaskId) && !node.metadata?.content && !node.metadata?.model3dOpKind;
}

/**
 * A format conversion runs on a node that already holds a model, so it cannot reuse the resumable check
 * above (which requires an empty node). Conversions are billed, so a refresh mid-conversion resumes too.
 */
export function hasResumableModel3dConvertTask(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Model3d && Boolean(node.metadata?.model3dConvertTaskId) && Boolean(node.metadata?.model3dConvertedFormat || node.metadata?.model3dOpParams) && !node.metadata?.model3dConvertedKey;
}

/**
 * Which multiview angle each upstream image feeds, assigned across the whole set rather than one image at a
 * time. An image produced by a multiview run carries its own angle and keeps it; every other image fills an
 * angle nobody claimed, in front/left/back/right order. Deciding per image duplicates an angle as soon as a
 * carried angle also comes up in connection order — Tripo canonicalizes two front views without complaining
 * and returns a mangled mesh, and a duplicate that leaves front unclaimed fails the request outright.
 *
 * Callers pass at most MULTIVIEW_VIEWS.length images, so a free angle is always left for each unclaimed one.
 */
export function assignMultiviewViews(images: ReferenceImage[], nodes: CanvasNodeData[]): MultiviewView[] {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const claimed = new Set<MultiviewView>();
    const carried = images.map((image) => {
        const view = nodeById.get(image.id)?.metadata?.multiviewView;
        if (!view || claimed.has(view)) return null;
        claimed.add(view);
        return view;
    });
    const free = MULTIVIEW_VIEWS.filter((view) => !claimed.has(view));
    let next = 0;
    return carried.map((view) => view ?? free[next++]);
}

/**
 * Loose images plugged into a 3D view socket carry that angle on the connection. Overlay it onto the image
 * node's own metadata so assignMultiviewViews sees the socket as the source of truth for that image.
 * Group wires have no toHandle; their members keep the badge they were marked with.
 */
export function nodesWithSocketViews(nodes: CanvasNodeData[], connections: CanvasConnection[], nodeId: string) {
    const socketViews = new Map<string, MultiviewView>();
    connections.forEach((connection) => {
        if (connection.toNodeId !== nodeId || !connection.toHandle) return;
        socketViews.set(connection.fromNodeId, connection.toHandle);
    });
    if (!socketViews.size) return nodes;
    return nodes.map((node) => {
        const socketView = socketViews.get(node.id);
        return socketView ? { ...node, metadata: { ...node.metadata, multiviewView: socketView } } : node;
    });
}

/**
 * The angle each upstream image feeds a 3D node, resolved the same way the request itself resolves it: the
 * generation input order, trimmed to the views Tripo accepts, then run through assignMultiviewViews. Reading the
 * assignment anywhere else (canvas labels, the angle menu) has to go through here, or the labels drift from what
 * actually gets sent.
 *
 * A single image runs image-to-model instead, which has no angles, so that case returns nothing.
 */
export function resolveMultiviewAssignment(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const images = flattenGenerationInputs(buildNodeGenerationInputs(nodeId, nodes, connections)).filter((input) => input.type === "image" && input.image);
    if (images.length < 2) return [];
    const usable = images.slice(0, MULTIVIEW_VIEWS.length);
    const referenceImages = usable.map((input) => input.image!);
    const views = assignMultiviewViews(referenceImages, nodesWithSocketViews(nodes, connections, nodeId));
    return usable.map((input, index) => ({ nodeId: input.nodeId, view: views[index] }));
}

export function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    return nodes.map((node) =>
        node.metadata?.status === "loading"
            ? hasResumableVideoTask(node) || hasResumableModel3dTask(node) || Boolean(node.metadata?.model3dOpKind && (node.metadata?.model3dTaskId || node.metadata?.model3dConvertTaskId))
                ? node
                : {
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

/**
 * The config node a failed generation was orchestrated from, so a retry reuses its prompt and references. Parameter
 * connections are skipped: a config node that only supplies parameters holds no prompt or references of its own, and
 * taking it as the source would retry with an empty context.
 */
export function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const upstream = (id: string) => connections.filter((connection) => connection.toNodeId === id && connection.kind !== "parameter").map((connection) => connection.fromNodeId);
    const queue = upstream(nodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.find((item) => item.id === id);
        if (node?.type === CanvasNodeType.Config) return node;
        upstream(id).forEach((fromNodeId) => queue.push(fromNodeId));
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
