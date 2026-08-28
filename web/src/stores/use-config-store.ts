import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { acceptsImageInput as acceptsImageInputOf, capabilityFromModalities, type CatalogModel, type ModelPricing } from "@/lib/model-catalog";

export type ApiCallFormat = "openai" | "gemini";
export type ModelCapability = "image" | "video" | "text" | "audio";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";
/**
 * Where a model's capability came from, in precedence order: "user" (channel editor) beats
 * "preset" (our curated per-id fix list) beats "provider" (the catalog's declared modalities)
 * beats "guess" (name matching). Only "guess" entries may be silently re-classified.
 */
export type CapabilitySource = "user" | "preset" | "provider" | "guess";

export type ChannelModel = {
    name: string;
    capability: ModelCapability;
    script?: string;
    /** Where `capability` came from; see CapabilitySource for the precedence order. */
    capabilitySource?: CapabilitySource;
    /** Provider says the model accepts image input (image-to-image); undefined when unknown. */
    acceptsImageInput?: boolean;
    /** Live pricing from the provider catalog, USD per unit. */
    pricing?: ModelPricing;
    /** Human-readable name from the provider catalog. */
    label?: string;
};

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    models: ChannelModel[];
    /**
     * This provider needs no API key - a local gateway (Ollama, LM Studio, LiteLLM) or one that
     * authenticates by IP. Without it a keyless provider would be treated as unconfigured and its
     * models would silently vanish from every picker.
     */
    noAuth?: boolean;
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
    reasoningEffort: ReasoningEffort;
    models: string[];
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
};

export type WebdavSyncConfig = {
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};
export type ConfigTabKey = "channels" | "preferences" | "prompt-sources" | "webdav" | "local-storage";

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: OPENAI_BASE_URL,
    apiKey: "",
    apiFormat: "openai",
    channels: [
        {
            id: "default",
            name: i18n.t("config.channels.defaultName"),
            baseUrl: OPENAI_BASE_URL,
            apiKey: "",
            apiFormat: "openai",
            models: [
                { name: "gpt-image-2", capability: "image" },
                { name: "grok-imagine-video", capability: "video" },
                { name: "gpt-5.5", capability: "text" },
                { name: "gpt-4o-mini-tts", capability: "audio" },
            ],
        },
    ],
    model: "default::gpt-image-2",
    imageModel: "default::gpt-image-2",
    videoModel: "default::grok-imagine-video",
    textModel: "default::gpt-5.5",
    audioModel: "default::gpt-4o-mini-tts",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: ["default::gpt-image-2", "default::grok-imagine-video", "default::gpt-5.5", "default::gpt-4o-mini-tts"],
    quality: "auto",
    size: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "3",
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    url: "",
    username: "",
    password: "",
    directory: "infinite-canvas",
    lastSyncedAt: "",
};

/** Ids of one-shot data migrations already applied, so they never run twice. */
export type MigrationFlags = Record<string, boolean>;

type ConfigStore = {
    config: AiConfig;
    webdav: WebdavSyncConfig;
    migrations: MigrationFlags;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

const VIDEO_KEYWORDS = ["video", "sora", "veo", "veo3", "kling", "wan", "hailuo", "seedance", "runway", "luma"];

export function boolConfig(value: string, fallback: boolean) {
    return value ? value === "true" : fallback;
}
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound"];
const IMAGE_KEYWORDS = ["seedream", "image", "dalle", "imagen", "flux", "sdxl", "midjourney", "gpt image", "dall e", "stable diffusion"];

/**
 * Keyword match on separator-delimited tokens, so e.g. "inkling" no longer matches "kling".
 * Multi-word keywords are written space-separated and matched against the rejoined token
 * stream, because a keyword containing a separator can never equal a single token.
 */
function matchesCapabilityKeyword(value: string, keywords: string[]) {
    const tokens = value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
    const joined = tokens.join(" ");
    return keywords.some((keyword) => (keyword.includes(" ") ? joined.includes(keyword) : tokens.includes(keyword)));
}

/** Best-effort default capability for a model name, used only when the provider declares no modalities. */
export function guessCapability(name: string): ModelCapability {
    if (matchesCapabilityKeyword(name, VIDEO_KEYWORDS)) return "video";
    if (matchesCapabilityKeyword(name, AUDIO_KEYWORDS)) return "audio";
    if (matchesCapabilityKeyword(name, IMAGE_KEYWORDS)) return "image";
    return "text";
}

function findChannelModel(config: AiConfig, value: string): { channel: ModelChannel; model: ChannelModel } | null {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === name));
    const model = channel?.models.find((item) => item.name === name);
    return channel && model ? { channel, model } : null;
}

/** The stored ChannelModel behind a picker value, for reading pricing / image-input support. */
export function channelModelOf(config: AiConfig, value: string): ChannelModel | undefined {
    return findChannelModel(config, value)?.model;
}

export function modelCapabilityOf(config: AiConfig, value: string): ModelCapability | undefined {
    return findChannelModel(config, value)?.model.capability;
}

/**
 * True when `value` is a model we could actually run for `capability`: right capability, and on a
 * provider that has a key. Every caller uses this to decide whether a saved default is still good,
 * and a model on a keyless provider is not - its every request would fail authentication.
 */
export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    const found = findChannelModel(config, value);
    if (!found || !channelIsConnected(found.channel)) return false;
    return !capability || found.model.capability === capability;
}

export function resolveModelForCapability(config: AiConfig, currentModel: string | undefined, capability: ModelCapability) {
    const defaultModel = capability === "image" ? config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel;
    const fallbackModel = capability === "image" ? defaultConfig.imageModel : capability === "video" ? defaultConfig.videoModel : capability === "audio" ? defaultConfig.audioModel : defaultConfig.textModel;
    if (currentModel && modelMatchesCapability(config, currentModel, capability)) return currentModel;
    if (defaultModel && modelMatchesCapability(config, defaultModel, capability)) return defaultModel;
    // Only fall back to the shipped default when it actually exists in the user's channels; otherwise
    // return "" so the caller can show an empty state instead of firing a request that cannot succeed.
    return modelMatchesCapability(config, fallbackModel, capability) ? fallbackModel : "";
}

/**
 * A provider is usable once it has an endpoint and a way to authenticate. Anything else would
 * 401 on its first call, so its models must not be offered.
 */
export function channelIsConnected(channel: ModelChannel) {
    return Boolean(channel.baseUrl.trim() && (channel.apiKey.trim() || channel.noAuth));
}

/**
 * Models a picker may offer. Only connected providers contribute: offering a model from a
 * keyless provider produces a picker entry whose every request fails authentication, which
 * reads to the user as "the app is broken" rather than "this provider has no key".
 */
export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    return config.channels.filter(channelIsConnected).flatMap((channel) => channel.models.filter((model) => !capability || model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name)));
}

/** The user script (if any) attached to a model; empty string means use the system default call. */
export function resolveModelScript(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model.script?.trim() || "";
}

/**
 * Gate in front of every generate path. It must agree with what the pickers offer, so it asks
 * `channelIsConnected` rather than re-testing for a key: a noAuth provider is offerable and must
 * therefore also be runnable.
 */
function isAiConfigReady(config: AiConfig, model: string) {
    const channel = resolveModelChannel(config, model);
    return Boolean(model.trim() && channelIsConnected(channel));
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            webdav: defaultWebdavSyncConfig,
            migrations: {},
            isConfigOpen: false,
            configTab: "channels",
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            updateWebdavConfig: (key, value) =>
                set((state) => ({
                    webdav: {
                        ...state.webdav,
                        [key]: value,
                    },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false, configTab = "channels") => set({ isConfigOpen: true, shouldPromptContinue, configTab }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            partialize: (state) => ({ config: state.config, webdav: state.webdav, migrations: state.migrations }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const persistedWebdav = (persistedState.webdav || {}) as Partial<WebdavSyncConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                if (!Array.isArray(persistedConfig.channels)) config.channels = [];
                const channels = normalizeChannels(config);
                const models = modelOptionsFromChannels(channels);
                // Heal stale capabilities from older builds (e.g. mis-tagged "inkling"→video) without
                // destroying intent: only entries that were themselves guessed are re-guessed. A capability
                // set by the user, by a preset override, or by the provider's catalog is left as stored.
                for (const channel of channels) {
                    channel.models = channel.models.map((model) => {
                        if (model.script || (model.capabilitySource || "guess") !== "guess") return model;
                        const guessed = guessCapability(model.name);
                        return model.capability === guessed ? model : { ...model, capability: guessed, capabilitySource: "guess" };
                    });
                }
                // Default model per capability must actually match that capability; mismatched persisted
                // defaults (e.g. a text model saved as the video default) are cleared instead of kept.
                // A default must also live on a connected provider: a model saved against a channel
                // whose key was since cleared would fail authentication on every single request.
                const usableCapabilityOf = (value: string) => {
                    const found = findChannelModel({ ...config, channels }, value);
                    return found && channelIsConnected(found.channel) ? found.model.capability : undefined;
                };
                const validOrDefault = (value: string, capability: ModelCapability) => {
                    const normalized = normalizeModelOptionValue(value, channels);
                    return normalized && usableCapabilityOf(normalized) === capability ? normalized : "";
                };
                return {
                    ...current,
                    webdav: { ...defaultWebdavSyncConfig, ...persistedWebdav },
                    migrations: { ...(persistedState.migrations || {}) },
                    config: {
                        ...config,
                        channelMode: "local",
                        apiFormat: normalizeApiFormat(config.apiFormat),
                        channels,
                        models,
                        imageModel: validOrDefault(config.imageModel || config.model, "image"),
                        videoModel: validOrDefault(config.videoModel, "video"),
                        textModel: validOrDefault(config.textModel || config.model, "text"),
                        audioModel: validOrDefault(config.audioModel || defaultConfig.audioModel, "audio"),
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: config.audioInstructions || "",
                        reasoningEffort: config.reasoningEffort || "auto",
                        videoSeconds: config.videoSeconds || "6",
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        canvasImageCount: config.canvasImageCount || "3",
                    },
                };
            },
        },
    ),
);

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

function isCatalogModel(item: string | ChannelModel | CatalogModel): item is CatalogModel {
    return typeof item !== "string" && "id" in item;
}

/**
 * Normalize a mixed list of raw model names, stored ChannelModels, or freshly fetched CatalogModels
 * into deduped ChannelModel entries. Provider-declared modalities beat name guessing when present.
 */
export function normalizeChannelModels(models: Array<string | ChannelModel | CatalogModel> | undefined): ChannelModel[] {
    const seen = new Set<string>();
    const result: ChannelModel[] = [];
    for (const item of models || []) {
        if (typeof item === "string") {
            const name = item.trim();
            if (!name || seen.has(name)) continue;
            seen.add(name);
            result.push({ name, capability: guessCapability(name), capabilitySource: "guess" });
            continue;
        }
        if (isCatalogModel(item)) {
            const name = (item.id || "").trim();
            if (!name || seen.has(name)) continue;
            seen.add(name);
            const declared = capabilityFromModalities(item.outputModalities);
            result.push({
                name,
                capability: declared || guessCapability(name),
                capabilitySource: declared ? "provider" : "guess",
                acceptsImageInput: acceptsImageInputOf(item.inputModalities),
                pricing: item.pricing,
                label: item.label,
            });
            continue;
        }
        const name = (item?.name || "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        result.push({
            name,
            capability: item.capability || guessCapability(name),
            // Legacy entries predate capabilitySource; they must count as guesses so stale
            // mis-tags can still heal. Only the channel editor marks a capability as "user".
            capabilitySource: item.capabilitySource || "guess",
            script: item.script?.trim() || undefined,
            acceptsImageInput: item.acceptsImageInput,
            pricing: item.pricing,
            label: item.label,
        });
    }
    return result;
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || i18n.t("config.channels.newName"),
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel?.apiKey || "",
        apiFormat,
        models: normalizeChannelModels(channel?.models),
        noAuth: channel?.noAuth || undefined,
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
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    return channel ? `${decoded.model}（${channel.name}）` : decoded.model;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        return channel && channel.models.some((item) => item.name === decoded.model) ? model : "";
    }
    const channel = channels.find((item) => item.models.some((entry) => entry.name === model)) || channels[0];
    return channel && channel.models.some((item) => item.name === model) ? encodeChannelModel(channel.id, model) : model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.some((item) => item.name === model));
    return (
        matched ||
        config.channels[0] ||
        createModelChannel({
            id: "default",
            name: i18n.t("config.channels.defaultName"),
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            apiFormat: config.apiFormat,
            models: config.models.map(modelOptionName).map((name) => ({ name, capability: guessCapability(name) })),
        })
    );
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    return {
        ...config,
        model: modelOptionName(value || config.model),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
    };
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const channels = persistedChannels.map((channel, index) =>
        createModelChannel({
            ...channel,
            id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
            name: channel.name || (index === 0 ? i18n.t("config.channels.defaultName") : i18n.t("config.channels.indexedName", { index: index + 1 })),
            models: normalizeChannelModels(channel.models),
        }),
    );
    if (!channels.length) {
        channels.push(
            createModelChannel({
                id: "default",
                name: i18n.t("config.channels.defaultName"),
                baseUrl: config.baseUrl || defaultConfig.baseUrl,
                apiKey: config.apiKey || "",
                apiFormat: config.apiFormat || defaultConfig.apiFormat,
                models: normalizeChannelModels([config.model, config.imageModel, config.videoModel, config.textModel, config.audioModel].map(modelOptionName)),
            }),
        );
    }
    return channels;
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return GEMINI_BASE_URL;
    return OPENAI_BASE_URL;
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "gemini" ? apiFormat : "openai";
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}
