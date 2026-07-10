"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

export type ApiCallFormat = "openai" | "gemini";

export type ModelCatalogItem = { id: string; priceLabel?: string };

export type ModelCatalog = Record<ModelCapability, ModelCatalogItem[]> & {
    defaults: Record<ModelCapability, string>;
};

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    models: string[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
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
    modelPriceLabels: Record<string, string>;
    modelCatalogVersion: number;
    quality: string;
    size: string;
    count: string;
    canvasImageCount: string;
};

export type WebdavSyncConfig = {
    proxyMode: "direct" | "nextjs";
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
export type ModelCapability = "image" | "video" | "text" | "audio";
const CHANNEL_MODEL_SEPARATOR = "::";
export const FIXED_AI_BASE_URL = "/api/ai";
export const SESSION_API_KEY = "canvas-session";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: FIXED_AI_BASE_URL,
    apiKey: SESSION_API_KEY,
    apiFormat: "openai",
    channels: [
        {
            id: "default",
            name: "Token 模型服务",
            baseUrl: FIXED_AI_BASE_URL,
            apiKey: SESSION_API_KEY,
            apiFormat: "openai",
            models: ["gpt-image-2", "gemini-3.1-flash-image", "grok-image-video", "gpt-5.6-sol", "gpt-4o-audio-preview"],
        },
    ],
    model: "default::gpt-image-2",
    imageModel: "default::gpt-image-2",
    videoModel: "default::grok-image-video",
    textModel: "default::gpt-5.6-sol",
    audioModel: "default::gpt-4o-audio-preview",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    models: ["default::gpt-image-2", "default::gemini-3.1-flash-image", "default::grok-image-video", "default::gpt-5.6-sol", "default::gpt-4o-audio-preview"],
    imageModels: ["default::gpt-image-2", "default::gemini-3.1-flash-image"],
    videoModels: ["default::grok-image-video"],
    textModels: ["default::gpt-5.6-sol"],
    audioModels: ["default::gpt-4o-audio-preview"],
    modelPriceLabels: {
        "gpt-image-2": "1K $0.10 · 2K $0.14 · 4K $0.20",
        "gemini-3.1-flash-image": "1K $0.10 · 2K $0.14 · 4K $0.20",
    },
    modelCatalogVersion: 0,
    quality: "auto",
    size: "1:1",
    count: "1",
    canvasImageCount: "3",
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    proxyMode: "direct",
    url: "",
    username: "",
    password: "",
    directory: "infinite-canvas",
    lastSyncedAt: "",
};

type ConfigStore = {
    config: AiConfig;
    webdav: WebdavSyncConfig;
    isConfigOpen: boolean;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    setConfig: (config: AiConfig) => void;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

function isVideoModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return value.includes("seedance") || value.includes("video") || value.includes("sora") || value.includes("veo") || value.includes("kling") || value.includes("wan") || value.includes("hailuo");
}

function isImageModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
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
    const value = modelOptionName(model).toLowerCase();
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

function modelListKey(capability: ModelCapability) {
    return `${capability}Models` as "imageModels" | "videoModels" | "textModels" | "audioModels";
}

function isAiConfigReady(_config: AiConfig, model: string) {
    return Boolean(model.trim());
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            webdav: defaultWebdavSyncConfig,
            isConfigOpen: false,
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            setConfig: (config) => set({ config }),
            updateWebdavConfig: (key, value) =>
                set((state) => ({
                    webdav: {
                        ...state.webdav,
                        [key]: value,
                    },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false) => set({ isConfigOpen: true, shouldPromptContinue }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            partialize: (state) => ({ config: state.config, webdav: state.webdav }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const persistedWebdav = (persistedState.webdav || {}) as Partial<WebdavSyncConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                if (!Array.isArray(persistedConfig.channels)) config.channels = [];
                const channels = normalizeChannels(config);
                const models = modelOptionsFromChannels(channels);
                return {
                    ...current,
                    webdav: { ...defaultWebdavSyncConfig, ...persistedWebdav },
                    config: {
                        ...config,
                        channelMode: "local",
                        baseUrl: FIXED_AI_BASE_URL,
                        apiKey: SESSION_API_KEY,
                        apiFormat: "openai",
                        channels,
                        models,
                        imageModel: normalizeModelOptionValue(config.imageModel || config.model, channels),
                        videoModel: normalizeModelOptionValue(config.videoModel || "grok-image-video", channels),
                        textModel: normalizeModelOptionValue(config.textModel || config.model, channels),
                        audioModel: normalizeModelOptionValue(config.audioModel || defaultConfig.audioModel, channels),
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: config.audioInstructions || "",
                        videoSeconds: config.videoSeconds || "6",
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        canvasImageCount: config.canvasImageCount || "3",
                        modelPriceLabels: config.modelPriceLabels && typeof config.modelPriceLabels === "object" ? config.modelPriceLabels : {},
                        modelCatalogVersion: Number.isFinite(config.modelCatalogVersion) ? config.modelCatalogVersion : 0,
                        imageModels: Array.isArray(persistedConfig.imageModels) ? normalizeModelList(config.imageModels, channels) : filterModelsByCapability(models, "image"),
                        videoModels: Array.isArray(persistedConfig.videoModels) ? normalizeModelList(config.videoModels, channels) : filterModelsByCapability(models, "video"),
                        textModels: Array.isArray(persistedConfig.textModels) ? normalizeModelList(config.textModels, channels) : filterModelsByCapability(models, "text"),
                        audioModels: Array.isArray(persistedConfig.audioModels) ? normalizeModelList(config.audioModels, channels) : filterModelsByCapability(models, "audio"),
                    },
                };
            },
        },
    ),
);

function normalizeModelList(models: string[], channels: ModelChannel[]) {
    const allModelOptions = channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model)));
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)))
        .map((model) => normalizeModelOptionValue(model, channels))
        .filter((model) => !allModelOptions.length || allModelOptions.includes(model) || !isChannelModelValue(model));
}

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || "新渠道",
        baseUrl: FIXED_AI_BASE_URL,
        apiKey: SESSION_API_KEY,
        apiFormat: "openai",
        models: uniqueRawModels(channel?.models || []),
    };
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const model = modelOptionName(value);
    const priceLabel = config.modelPriceLabels[model];
    return priceLabel ? model + " · " + priceLabel : model;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId) || channels.find((item) => item.models.includes(decoded.model));
        return channel && channel.models.includes(decoded.model) ? encodeChannelModel(channel.id, decoded.model) : "";
    }
    const channel = channels.find((item) => item.models.includes(model)) || channels[0];
    return channel && channel.models.includes(model) ? encodeChannelModel(channel.id, model) : model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.includes(model));
    return matched || config.channels[0] || createModelChannel({ id: "default", name: "默认渠道", baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName) });
}

export function resolveModelRequestConfig(config: AiConfig, value: string): AiConfig {
    return {
        ...config,
        model: modelOptionName(value || config.model),
        baseUrl: FIXED_AI_BASE_URL,
        apiKey: SESSION_API_KEY,
        apiFormat: "openai" as const,
    };
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const models = uniqueRawModels([...persistedChannels.flatMap((channel) => channel.models || []), ...(config.models || []), config.model, config.imageModel, config.videoModel, config.textModel, config.audioModel]);
    return [
        createModelChannel({
            id: "default",
            name: "Token 模型服务",
            models: models.length ? models : defaultConfig.channels[0].models,
        }),
    ];
}

export function applyModelCatalog(config: AiConfig, catalog: ModelCatalog): AiConfig {
    const items = [...catalog.image, ...catalog.video, ...catalog.text, ...catalog.audio];
    const channel = createModelChannel({ id: "default", name: "Token 模型服务", models: items.map((item) => item.id) });
    const toOptions = (items: ModelCatalogItem[]) => items.map((item) => encodeChannelModel(channel.id, item.id));
    const imageModels = toOptions(catalog.image);
    const videoModels = toOptions(catalog.video);
    const textModels = toOptions(catalog.text);
    const audioModels = toOptions(catalog.audio);
    const useCatalogDefaults = config.modelCatalogVersion < 1;
    const select = (current: string, options: string[], defaultModel: string) => {
        if (!options.length) return "";
        const preferred = encodeChannelModel(channel.id, defaultModel);
        return useCatalogDefaults && options.includes(preferred) ? preferred : normalizeDefaultModel(normalizeModelOptionValue(current, [channel]), options);
    };
    const imageModel = select(config.imageModel, imageModels, catalog.defaults.image);
    const videoModel = select(config.videoModel, videoModels, catalog.defaults.video);
    const textModel = select(config.textModel, textModels, catalog.defaults.text);
    const audioModel = select(config.audioModel, audioModels, catalog.defaults.audio);
    const modelPriceLabels = Object.fromEntries(items.filter((item) => item.priceLabel).map((item) => [item.id, item.priceLabel || ""]));
    const models = modelOptionsFromChannels([channel]);
    return {
        ...config,
        channels: [channel],
        models,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        imageModel,
        videoModel,
        textModel,
        audioModel,
        model: models.includes(normalizeModelOptionValue(config.model, [channel])) ? normalizeModelOptionValue(config.model, [channel]) : imageModel,
        modelPriceLabels,
        modelCatalogVersion: 1,
    };
}

export function applyModelChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const safeChannels = channels.map((channel) => createModelChannel(channel));
    const models = modelOptionsFromChannels(safeChannels);
    const imageModels = keepOrSuggestModels(config.imageModels, filterModelsByCapability(models, "image"), models);
    const videoModels = keepOrSuggestModels(config.videoModels, filterModelsByCapability(models, "video"), models);
    const textModels = keepOrSuggestModels(config.textModels, filterModelsByCapability(models, "text"), models);
    const audioModels = keepOrSuggestModels(config.audioModels, filterModelsByCapability(models, "audio"), models);
    return {
        ...config,
        channelMode: "local",
        baseUrl: FIXED_AI_BASE_URL,
        apiKey: SESSION_API_KEY,
        apiFormat: "openai",
        channels: safeChannels,
        models,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        imageModel: normalizeDefaultModel(config.imageModel, imageModels),
        videoModel: normalizeDefaultModel(config.videoModel, videoModels),
        textModel: normalizeDefaultModel(config.textModel, textModels),
        audioModel: normalizeDefaultModel(config.audioModel, audioModels),
    };
}

function keepOrSuggestModels(current: string[], suggested: string[], allModels: string[]) {
    const available = new Set(allModels);
    const kept = uniqueModelOptions(current).filter((model) => available.has(model));
    return kept.length ? kept : suggested;
}

function normalizeDefaultModel(value: string, options: string[]) {
    return options.includes(value) ? value : options[0] || value;
}

export function defaultBaseUrlForApiFormat(_apiFormat: ApiCallFormat) {
    return FIXED_AI_BASE_URL;
}

function uniqueRawModels(models: string[]) {
    return Array.from(new Set((models || []).map((model) => modelOptionName(model).trim()).filter(Boolean)));
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
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
