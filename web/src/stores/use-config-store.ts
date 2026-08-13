"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { apiGet } from "@/services/api/request";
import type { AdminPublicSettings } from "@/services/api/admin";
import { cleanImageParametersForModel, type ImageModelCapability } from "@/lib/image-model-capabilities";

export type AiConfig = {
    channelMode: "remote" | "local" | "newapi";
    baseUrl: string;
    apiKey: string;
    newApiGroup: string;
    newApiTextGroup: string;
    newApiImageGroup: string;
    newApiVideoGroup: string;
    newApiAudioGroup: string;
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    models: string[];
    imageModels: string[];
    videoModels: string[];
    textModels: string[];
    audioModels: string[];
    quality: string;
    size: string;
    imageResolution: string;
    imageAspectRatio: string;
    imageModelCapabilities: Record<string, ImageModelCapability>;
    count: string;
    canvasImageCount: string;
};

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
export type ModelCapability = "image" | "video" | "text" | "audio";
export type ChannelMode = AiConfig["channelMode"];
export type FetchedModelLists = {
    models: string[];
    imageModels?: string[];
    videoModels?: string[];
    textModels?: string[];
    audioModels?: string[];
};

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: "https://api.openai.com",
    apiKey: "",
    newApiGroup: "",
    newApiTextGroup: "",
    newApiImageGroup: "",
    newApiVideoGroup: "",
    newApiAudioGroup: "",
    model: "gpt-image-2",
    imageModel: "gpt-image-2",
    videoModel: "grok-imagine-video",
    textModel: "gpt-5.5",
    audioModel: "gpt-4o-mini-tts",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    models: [],
    imageModels: [],
    videoModels: [],
    textModels: [],
    audioModels: [],
    quality: "auto",
    size: "1:1",
    imageResolution: "1k",
    imageAspectRatio: "1:1",
    imageModelCapabilities: {},
    count: "1",
    canvasImageCount: "3",
};

type ConfigStore = {
    config: AiConfig;
    publicSettings: AdminPublicSettings | null;
    isPublicSettingsLoading: boolean;
    isConfigOpen: boolean;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    loadPublicSettings: () => Promise<void>;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

function resolveEffectiveConfig(config: AiConfig, modelChannel: AdminPublicSettings["modelChannel"] | null) {
    const channelMode = resolveAllowedChannelMode(config.channelMode, modelChannel);
    if (channelMode === "newapi") {
        return applyFetchedModelsToConfig(
            { ...config, channelMode, imageModelCapabilities: modelChannel?.imageModelCapabilities || config.imageModelCapabilities },
            {
                models: config.models,
                imageModels: config.imageModels,
                videoModels: config.videoModels,
                textModels: config.textModels,
                audioModels: config.audioModels,
            },
        );
    }
    if (!channelMode) {
        return { ...config, channelMode: config.channelMode, models: [], imageModels: [], videoModels: [], textModels: [], audioModels: [], model: "", imageModel: "", videoModel: "", textModel: "", audioModel: "" };
    }
    if (channelMode === "local" || !modelChannel) return { ...config, channelMode };
    const models = modelChannel.availableModels;
    const textModels = filterModelsByCapability(models, "text");
    const imageModels = filterModelsByCapability(models, "image");
    const videoModels = filterModelsByCapability(models, "video");
    const audioModels = filterModelsByCapability(models, "audio");
    const fallbackTextModel = validDefault(modelChannel.defaultTextModel, textModels) || preferredModel(textModels, isTextModelName);
    const fallbackModel = validDefault(modelChannel.defaultModel, textModels) || fallbackTextModel;
    const fallbackImageModel = validDefault(modelChannel.defaultImageModel, imageModels) || preferredModel(imageModels, isImageModelName);
    const fallbackVideoModel = validDefault(modelChannel.defaultVideoModel, videoModels) || preferredModel(videoModels, isVideoModelName);
    const fallbackAudioModel = preferredModel(audioModels, isAudioModelName);
    return {
        ...config,
        channelMode,
        models,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        model: textModels.includes(config.model) ? config.model : fallbackModel,
        imageModel: imageModels.includes(config.imageModel) ? config.imageModel : fallbackImageModel,
        imageModelCapabilities: modelChannel.imageModelCapabilities || {},
        videoModel: videoModels.includes(config.videoModel) ? config.videoModel : fallbackVideoModel,
        textModel: textModels.includes(config.textModel) ? config.textModel : fallbackTextModel || fallbackModel,
        audioModel: audioModels.includes(config.audioModel) ? config.audioModel : fallbackAudioModel,
        systemPrompt: modelChannel.systemPrompt,
    };
}

export function channelModeAllowed(modelChannel: AdminPublicSettings["modelChannel"] | null | undefined, mode: ChannelMode) {
    if (!modelChannel) return mode !== "local";
    if (mode === "local") return modelChannel.allowLocalChannel ?? modelChannel.allowCustomChannel;
    if (mode === "newapi") return modelChannel.allowNewApiChannel !== false;
    return modelChannel.allowRemoteChannel !== false;
}

export function resolveAllowedChannelMode(mode: ChannelMode, modelChannel: AdminPublicSettings["modelChannel"] | null | undefined): ChannelMode | null {
    if (channelModeAllowed(modelChannel, mode)) return mode;
    const fallbackModes: ChannelMode[] = ["remote", "newapi", "local"];
    return fallbackModes.find((item) => channelModeAllowed(modelChannel, item)) || null;
}

export function applyFetchedModelsToConfig(config: AiConfig, fetchedModels: string[] | FetchedModelLists): AiConfig {
    const fetched = Array.isArray(fetchedModels) ? { models: fetchedModels } : fetchedModels;
    const models = normalizeModelList(fetched.models);
    const suggestedImageModels = normalizeCapabilityModelList(fetched.imageModels, models, "image");
    const suggestedVideoModels = normalizeCapabilityModelList(fetched.videoModels, models, "video");
    const suggestedTextModels = normalizeCapabilityModelList(fetched.textModels, models, "text");
    const suggestedAudioModels = normalizeCapabilityModelList(fetched.audioModels, models, "audio");
    const imageModels = resolveNextCapabilityModels(config.imageModels, suggestedImageModels, suggestedImageModels);
    const videoModels = resolveNextCapabilityModels(config.videoModels, suggestedVideoModels, suggestedVideoModels);
    const textModels = resolveNextCapabilityModels(config.textModels, suggestedTextModels, suggestedTextModels);
    const audioModels = resolveNextCapabilityModels(config.audioModels, suggestedAudioModels, suggestedAudioModels);

    return {
        ...config,
        models,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        model: validDefault(config.model, textModels) || textModels[0] || "",
        imageModel: validDefault(config.imageModel, imageModels) || imageModels[0] || "",
        videoModel: validDefault(config.videoModel, videoModels) || videoModels[0] || "",
        textModel: validDefault(config.textModel, textModels) || textModels[0] || "",
        audioModel: validDefault(config.audioModel, audioModels) || audioModels[0] || "",
    };
}

function validDefault(model: string, models: string[]) {
    return models.includes(model) ? model : "";
}

function preferredModel(models: string[], predicate: (model: string) => boolean) {
    return models.find(predicate) || "";
}

function isVideoModelName(model: string) {
    const value = model.toLowerCase();
    return value.includes("seedance") || value.includes("video") || value.includes("sora") || value.includes("veo") || value.includes("kling") || value.includes("wan") || value.includes("hailuo");
}

function isImageModelName(model: string) {
    const value = model.toLowerCase();
    return (
        !isVideoModelName(model) &&
        !isAudioModelName(model) &&
        (value.includes("seedream") ||
            value.includes("gpt-image") ||
            value.includes("image") ||
            value.includes("dall-e") ||
            value.includes("dalle") ||
            value.includes("imagen") ||
            value.includes("flux") ||
            value.includes("sdxl") ||
            value.includes("stable-diffusion") ||
            value.includes("midjourney"))
    );
}

function isAudioModelName(model: string) {
    const value = model.toLowerCase();
    return value.includes("audio") || value.includes("tts") || value.includes("speech") || value.includes("voice") || value.includes("music") || value.includes("sound");
}

function isTextModelName(model: string) {
    return !isImageModelName(model) && !isVideoModelName(model) && !isAudioModelName(model);
}

export function modelMatchesCapability(model: string, capability?: ModelCapability) {
    if (!capability) return true;
    if (capability === "image") return isImageModelName(model);
    if (capability === "video") return isVideoModelName(model);
    if (capability === "audio") return isAudioModelName(model);
    return isTextModelName(model);
}

export function filterModelsByCapability(models: string[], capability?: ModelCapability) {
    return capability ? models.filter((model) => modelMatchesCapability(model, capability)) : models;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config[modelListKey(capability)];
}

export function resolveCapabilityModel(config: AiConfig, capability: ModelCapability, preferred?: string) {
    const selected = (preferred || "").trim();
    const models = selectableModelsByCapability(config, capability);
    if (selected && models.includes(selected)) return selected;
    const fallback = config[defaultModelKey(capability)].trim();
    if (fallback && (!models.length || models.includes(fallback))) return fallback;
    return models[0] || defaultConfig[defaultModelKey(capability)] || defaultConfig.model;
}

function modelListKey(capability: ModelCapability) {
    return `${capability}Models` as "imageModels" | "videoModels" | "textModels" | "audioModels";
}

function defaultModelKey(capability: ModelCapability) {
    return `${capability}Model` as "imageModel" | "videoModel" | "textModel" | "audioModel";
}

function isAiConfigReady(config: AiConfig, model: string) {
    if (!model.trim()) return false;
    if (config.channelMode === "remote") return true;
    if (config.channelMode === "newapi") return Boolean(config.baseUrl.trim() && config.newApiGroup.trim());
    return Boolean(config.baseUrl.trim() && config.apiKey.trim());
}

export function isNewApiConfig(config: AiConfig) {
    return config.channelMode === "newapi";
}

export function resolveNewApiGroup(config: AiConfig, capability?: ModelCapability) {
    if (capability === "text") return config.newApiTextGroup.trim() || config.newApiGroup.trim();
    if (capability === "image") return config.newApiImageGroup.trim() || config.newApiGroup.trim();
    if (capability === "video") return config.newApiVideoGroup.trim() || config.newApiGroup.trim();
    if (capability === "audio") return config.newApiAudioGroup.trim() || config.newApiGroup.trim();
    return config.newApiGroup.trim();
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            publicSettings: null,
            isPublicSettingsLoading: false,
            isConfigOpen: false,
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => {
                    const config = { ...state.config, [key]: value };
                    return { config: key === "imageModel" ? cleanImageParametersForModel(config, String(value)) : config };
                }),
            loadPublicSettings: async () => {
                if (get().isPublicSettingsLoading) return;
                set({ isPublicSettingsLoading: true });
                try {
                    set({ publicSettings: await apiGet<AdminPublicSettings>("/api/settings") });
                } finally {
                    set({ isPublicSettingsLoading: false });
                }
            },
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false) => set({ isConfigOpen: true, shouldPromptContinue }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            partialize: (state) => ({ config: state.config }),
            merge: (persisted, current) => {
                const persistedConfig = ((persisted as Partial<ConfigStore>).config || {}) as Partial<AiConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                return {
                    ...current,
                    config: {
                        ...config,
                        channelMode: config.channelMode || "remote",
                        newApiGroup: config.newApiGroup || "",
                        newApiTextGroup: config.newApiTextGroup || "",
                        newApiImageGroup: config.newApiImageGroup || "",
                        newApiVideoGroup: config.newApiVideoGroup || "",
                        newApiAudioGroup: config.newApiAudioGroup || "",
                        imageModel: config.imageModel || defaultConfig.imageModel,
                        videoModel: config.videoModel || "grok-imagine-video",
                        textModel: config.textModel || config.model,
                        audioModel: config.audioModel || defaultConfig.audioModel,
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: config.audioInstructions || "",
                        videoSeconds: config.videoSeconds || "6",
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        canvasImageCount: config.canvasImageCount || "3",
                        imageResolution: config.imageResolution || defaultConfig.imageResolution,
                        imageAspectRatio: config.imageAspectRatio || defaultConfig.imageAspectRatio,
                        imageModelCapabilities: config.imageModelCapabilities || {},
                        imageModels: Array.isArray(persistedConfig.imageModels) ? normalizeModelList(config.imageModels) : filterModelsByCapability(config.models, "image"),
                        videoModels: Array.isArray(persistedConfig.videoModels) ? normalizeModelList(config.videoModels) : filterModelsByCapability(config.models, "video"),
                        textModels: Array.isArray(persistedConfig.textModels) ? normalizeModelList(config.textModels) : filterModelsByCapability(config.models, "text"),
                        audioModels: Array.isArray(persistedConfig.audioModels) ? normalizeModelList(config.audioModels) : filterModelsByCapability(config.models, "audio"),
                    },
                };
            },
        },
    ),
);

function normalizeModelList(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

function normalizeCapabilityModelList(models: string[] | undefined, allModels: string[], capability: ModelCapability) {
    return Array.isArray(models) ? normalizeModelList(models) : filterModelsByCapability(allModels, capability);
}

function resolveNextCapabilityModels(current: string[], suggested: string[], allModels: string[]) {
    const available = new Set(allModels);
    const kept = normalizeModelList(current).filter((model) => available.has(model));
    return kept.length ? kept : suggested;
}

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    const modelChannel = useConfigStore((state) => state.publicSettings?.modelChannel || null);
    return useMemo(() => resolveEffectiveConfig(config, modelChannel), [config, modelChannel]);
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}
