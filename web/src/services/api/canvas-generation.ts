import { nanoid } from "nanoid";

import { useCanvasAccountStore } from "@/stores/use-canvas-account-store";
import { useCanvasProviderStore } from "@/stores/use-canvas-provider-store";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import { canvasBff, decodeCanvasModel, type CanvasGeneration } from "./canvas-bff";

export type CanvasGenerationInput = {
    projectId: string;
    providerId: string;
    kind: CanvasGeneration["kind"];
    input?: Record<string, unknown>;
    clientRequestId: string;
};

export function isCanvasAccountAuthenticated() {
    return useCanvasAccountStore.getState().status === "authenticated";
}

export async function submitCanvasGeneration(kind: CanvasGeneration["kind"], config: AiConfig, prompt: string, extra: Record<string, unknown> = {}, options?: { signal?: AbortSignal }) {
    throwIfAborted(options?.signal);
    const [providers, projects] = await Promise.all([canvasBff.listProviders(), canvasBff.listProjects()]);
    const capabilityModel = kind === "image" ? config.imageModel : kind === "video" ? config.videoModel : kind === "audio" ? config.audioModel : config.textModel;
    const selectedValue = capabilityModel || config.model;
    const configuredModel = modelOptionName(selectedValue);
    const explicitModel = decodeCanvasModel(selectedValue) || decodeCanvasModel(config.model || "");
    const selectedProviderId = explicitModel?.providerId;
    const activeProviders = providers.filter((item) => item.status === "active");
    const preferredProviderId = useCanvasProviderStore.getState().selectedProviderId;
    const provider = selectedProviderId
        ? activeProviders.find((item) => item.id === selectedProviderId)
        : activeProviders.find((item) => item.id === preferredProviderId && item.model === configuredModel)
            || activeProviders.find((item) => item.model === configuredModel)
            || (activeProviders.length === 1 ? activeProviders[0] : undefined);
    if (!provider) throw new Error("No active Canvas provider is configured");
    const project = projects[0] || (await canvasBff.createProject({ name: "Canvas Workbench", data: { source: "workbench" } }));
    return canvasBff.createGeneration({
        projectId: project.id,
        providerId: provider.id,
        kind,
        input: { model: explicitModel?.model || configuredModel, prompt, ...extra },
        clientRequestId: `canvas-${kind}-${nanoid()}`,
    });
}

export async function waitForCanvasGeneration(generationId: string, options?: { signal?: AbortSignal }): Promise<CanvasGeneration> {
    for (;;) {
        throwIfAborted(options?.signal);
        const generation = await canvasBff.getGeneration(generationId);
        if (["succeeded", "failed", "cancelled"].includes(generation.status)) {
            if (generation.status !== "succeeded") throw new Error(generation.errorCode || "Canvas generation failed");
            return generation;
        }
        await delay(1_000, options?.signal);
    }
}

export async function readCanvasGenerationBlob(generation: CanvasGeneration, options?: { signal?: AbortSignal }) {
    const url = generation.asset?.signedUrl;
    if (!url) throw new Error("Canvas generation did not return an asset URL");
    const response = await fetch(url, { signal: options?.signal });
    if (!response.ok) throw new Error("Canvas output could not be downloaded");
    return response.blob();
}

export async function requestCanvasImage(config: AiConfig, prompt: string, options?: { signal?: AbortSignal }) {
    const generation = await submitCanvasGeneration("image", config, prompt, { count: config.count, size: config.size, quality: config.quality }, options);
    const completed = await waitForCanvasGeneration(generation.id, options);
    const blob = await readCanvasGenerationBlob(completed, options);
    return { id: nanoid(), dataUrl: await blobToDataUrl(blob) };
}

export async function requestCanvasVideo(config: AiConfig, prompt: string, options?: { signal?: AbortSignal }) {
    const generation = await submitCanvasGeneration("video", config, prompt, { seconds: config.videoSeconds, size: config.size, quality: config.vquality, generateAudio: config.videoGenerateAudio, watermark: config.videoWatermark }, options);
    const completed = await waitForCanvasGeneration(generation.id, options);
    return readCanvasGenerationBlob(completed, options);
}

export async function requestCanvasAudio(config: AiConfig, prompt: string, options?: { signal?: AbortSignal }) {
    const generation = await submitCanvasGeneration("audio", config, prompt, { voice: config.audioVoice, format: config.audioFormat, speed: config.audioSpeed, instructions: config.audioInstructions }, options);
    const completed = await waitForCanvasGeneration(generation.id, options);
    return readCanvasGenerationBlob(completed, options);
}

export async function requestCanvasText(config: AiConfig, prompt: string, options?: { signal?: AbortSignal }) {
    const generation = await submitCanvasGeneration("text", config, prompt, { reasoningEffort: config.reasoningEffort }, options);
    const completed = await waitForCanvasGeneration(generation.id, options);
    const blob = await readCanvasGenerationBlob(completed, options);
    return blob.text();
}

/** Account-backed generation calls. Provider credentials never cross this boundary. */
export const canvasGenerationApi = {
    list: () => canvasBff.listGenerations(),
    get: (generationId: string) => canvasBff.getGeneration(generationId),
    submit: (input: CanvasGenerationInput) => canvasBff.createGeneration(input),
    cancel: (generationId: string) => canvasBff.cancelGeneration(generationId),
};

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error("Canvas image could not be read"));
        reader.readAsDataURL(blob);
    });
}
