import { defaultConfig, resolveModelForCapability, type AiConfig } from "@workbench/stores/use-config-store";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { ModelExecutionError } from "@infinite-canvas/shared/model-http";

import { canvasMediaReferences } from "@workbench/lib/canvas/canvas-node-factory";
import { hasNodeMedia } from "@workbench/lib/media-source";
import type { CanvasNodeGenerationMode } from "@workbench/components/canvas/canvas-node-prompt-panel";
import type { ImageAngleParams, ReadonlyCanvasNode } from "@infinite-canvas/plugin-sdk";
import type { ReferenceImage } from "@workbench/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@workbench/types/media";
import { CanvasNodeType, isCanvasTaskBinding, isWebVideoTaskOwner, type CanvasMediaReference, type CanvasNodeData } from "@infinite-canvas/shared/canvas/schema/canvas";
import { readNodeResource } from "@workbench/lib/canvas/node-registry";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";

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

export function generationReferences(context: { referenceImages: ReferenceImage[]; referenceVideos: ReferenceVideo[]; referenceAudios: ReferenceAudio[] }) {
    return [
        ...canvasMediaReferences("image", context.referenceImages),
        ...canvasMediaReferences("video", context.referenceVideos),
        ...canvasMediaReferences("audio", context.referenceAudios),
    ];
}

export function resolveMetadataReferences(references: readonly CanvasMediaReference[]) {
    const images: ReferenceImage[] = [], videos: ReferenceVideo[] = [], audios: ReferenceAudio[] = [];
    for (const [index, reference] of references.entries()) {
        const id = String(index);
        const source = "storageKey" in reference ? { storageKey: reference.storageKey } : { url: reference.url };
        if (reference.kind === "image") images.push({ id, name: `reference-${id}.png`, type: "image/png", ...source });
        else if (reference.kind === "video") videos.push({ id, name: `reference-${id}.mp4`, type: "video/mp4", ...source });
        else audios.push({ id, name: `reference-${id}.mp3`, type: "audio/mpeg", ...source });
    }
    return { images, videos, audios };
}

export function getGenerationCount(count: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
}

export function buildGenerationConfig(config: AiConfig, node: ReadonlyCanvasNode | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    return {
        ...config,
        model: resolveModelForCapability(config, node?.metadata?.model, mode),
        reasoningEffort: node?.metadata?.reasoningEffort || config.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: node?.metadata?.size || (mode === "video" ? config.videoSize : config.size) || defaultConfig.size,
        background: node?.metadata?.background ?? config.background ?? defaultConfig.background,
        videoSeconds: node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        vquality: node?.metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        videoMode: node?.metadata?.videoMode || config.videoMode || defaultConfig.videoMode,
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        count: String(node?.metadata?.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
}

export function hasResumableVideoTask(projectId: string, node: ReadonlyCanvasNode, localMode: boolean) {
    const task = node.metadata?.webVideoTask;
    return !localMode && !!task && !task.paused && isWebVideoTaskOwner(projectId, node, task);
}

export function resetWebVideoSubmission(node: CanvasNodeData): CanvasNodeData {
    if (!node.metadata?.webVideoSubmissionId) return node;
    const metadata = { ...node.metadata };
    delete metadata.webVideoSubmissionId;
    if (node.type === CanvasNodeType.Video && !metadata.webVideoTask) {
        metadata.status = "error";
        metadata.errorDetails = "未取得视频任务编号，请先核对已提交的生成，再决定是否重新生成。";
    }
    return { ...node, metadata };
}

export function resetInterruptedGeneration(nodes: CanvasNodeData[], projectId: string, localMode: boolean) {
    const current = nodes.map((original) => {
        const node = resetWebVideoSubmission(original);
        const tasks = node.metadata?.tasks;
        if (!tasks?.length) return node;
        const owned = tasks.filter((task) => localMode && isCanvasTaskBinding(projectId, node, task));
        return owned.length === tasks.length ? node : { ...node, metadata: { ...node.metadata, tasks: owned } };
    });
    const activeNodes = new Set<string>();
    for (const node of current) {
        for (const binding of node.metadata?.tasks ?? []) {
            activeNodes.add(node.id);
            activeNodes.add(binding.sourceId);
        }
        const task = node.metadata?.webVideoTask;
        if (task && hasResumableVideoTask(projectId, node, localMode)) {
            activeNodes.add(node.id);
            activeNodes.add(task.sourceId);
        }
    }
    return current.map<CanvasNodeData>((node) => {
        if (node.metadata?.status !== "loading" || activeNodes.has(node.id)) return node;
        const hasResult = (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && hasNodeMedia(node);
        return {
            ...node, metadata: {
                ...node.metadata,
                status: hasResult ? "success" : "error",
                errorDetails: hasResult ? undefined : "页面刷新后生成已中断，请重新生成。",
                images: node.metadata.images?.map((image) => (image.status === "loading" ? { ...image, status: "error" as const, errorDetails: "页面刷新后生成已中断，请重新生成。" } : image)),
                texts: node.metadata.texts?.map((text) => (text.status === "loading" ? { ...text, status: "error" as const, errorDetails: "页面刷新后生成已中断，请重新生成。" } : text)),
            },
        };
    });
}

export function isGenerationCanceled(error: unknown) {
    if (error instanceof ModelExecutionError && error.code === "MODEL_TASK_CANCELLED") return true;
    if (error instanceof PluginError && ["PLUGIN_PROJECT_CHANGED", "PLUGIN_SCOPE_CLOSED", "PLUGIN_INACTIVE"].includes(error.code)) return true;
    return error instanceof Error && (error.message === "请求已取消" || error.name === "AbortError" || error.name === "CanceledError");
}

export function sourceNodeReferenceImages(node: CanvasNodeData | null, binding?: ScopeBinding) {
    if (!node) return [];
    const resource = readNodeResource(node, "execute", binding);
    if (resource?.kind !== "image" || !(resource.storageKey || resource.url)) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata?.mimeType || "image/png",
            dataUrl: resource.url,
            storageKey: resource.storageKey,
        },
    ];
}

export function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name);
}

export function buildAngleLabel(params: ImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? "正面视角" : params.horizontalAngle > 0 ? `向右旋转 ${params.horizontalAngle} 度` : `向左旋转 ${Math.abs(params.horizontalAngle)} 度`;
    const pitch = params.pitchAngle === 0 ? "水平视角" : params.pitchAngle > 0 ? `俯视 ${params.pitchAngle} 度` : `仰视 ${Math.abs(params.pitchAngle)} 度`;
    return `AI 多角度：${horizontal}，${pitch}，镜头距离 ${params.cameraDistance.toFixed(1)}，${(params.wideAngle ? "广角" : "标准")}镜头`;
}

export function buildAnglePrompt(params: ImageAngleParams) {
    return `基于参考图重新生成同一主体的新视角，保持主体、颜色、材质和画面风格一致，不要只做透视变形。${buildAngleLabel(params)}。`;
}
