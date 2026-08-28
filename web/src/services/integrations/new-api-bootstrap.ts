import { createModelChannel, encodeChannelModel, guessCapability, modelMatchesCapability, modelOptionsFromChannels, type AiConfig, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

export const NEW_API_CHANNEL_ID = "new-api";
export const NEW_API_BOOTSTRAP_MARKER = "infinite-canvas:new-api-bootstrap-v1";

export type DirectLaunchConfig = {
    source: "newapi" | "legacy";
    baseUrl?: string;
    apiKey?: string;
};

export type LaunchLocation = {
    hash: string;
    hostname: string;
    pathname: string;
    search: string;
};

export type ParseLaunchResult = { launch: DirectLaunchConfig; error?: never } | { launch?: never; error: "invalidBaseUrl" | "invalidApiKey" } | null;

const MODEL_PRIORITIES: Record<ModelCapability, string[]> = {
    image: ["doubao-seedream-5-0-pro-260628", "doubao-seedream-5-0-260128", "doubao-seedream-4-5-251128"],
    video: ["doubao-seedance-2-5-260628", "doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128"],
    text: ["gpt-5.5", "glm-5.3", "deepseek-v4-pro", "deepseek-v4-flash"],
    audio: ["volcengine-tts-1", "gpt-4o-mini-tts", "tts-1"],
};

export function parseDirectLaunch(location: LaunchLocation): ParseLaunchResult {
    const fragmentParams = parseFragmentParams(location.hash);
    if (fragmentParams.get("source") === "newapi") {
        const baseUrl = readParam(fragmentParams, "baseUrl", "baseurl");
        const apiKey = readParam(fragmentParams, "apiKey", "apikey");
        if (!baseUrl || !isAllowedNewApiUrl(baseUrl, location.hostname)) return { error: "invalidBaseUrl" };
        if (!apiKey || !isApiKey(apiKey)) return { error: "invalidApiKey" };
        return { launch: { source: "newapi", baseUrl: normalizeBaseUrl(baseUrl), apiKey } };
    }

    const searchParams = new URLSearchParams(location.search);
    const baseUrl = readParam(searchParams, "baseUrl", "baseurl");
    const apiKey = readParam(searchParams, "apiKey", "apikey");
    if (!baseUrl && !apiKey) return null;
    return { launch: { source: "legacy", baseUrl: baseUrl ? normalizeBaseUrl(baseUrl) : undefined, apiKey: apiKey || undefined } };
}

export function cleanDirectLaunchUrl(location: LaunchLocation, source: DirectLaunchConfig["source"]) {
    const searchParams = new URLSearchParams(location.search);
    searchParams.delete("baseUrl");
    searchParams.delete("baseurl");
    searchParams.delete("apiKey");
    searchParams.delete("apikey");
    const query = searchParams.size ? `?${searchParams.toString()}` : "";
    return `${location.pathname}${query}${source === "legacy" ? location.hash : ""}`;
}

export function applyDirectLaunch(config: AiConfig, launch: DirectLaunchConfig, fetchedModels?: string[]): AiConfig {
    const baseUrl = launch.baseUrl || config.baseUrl;
    const apiKey = launch.apiKey || config.apiKey;
    const existingIndex = findIntegratedChannel(config.channels, baseUrl);
    const existing = existingIndex >= 0 ? config.channels[existingIndex] : undefined;
    const models = fetchedModels
        ? fetchedModels.map((name) => {
              const previous = existing?.models.find((model) => model.name === name);
              return previous || { name, capability: guessCapability(name) };
          })
        : existing?.models || [];
    const channel = createModelChannel({
        ...existing,
        id: existing?.id || NEW_API_CHANNEL_ID,
        name: existing?.name && existing.id !== "default" ? existing.name : "New API",
        baseUrl,
        apiKey,
        apiFormat: "openai",
        models,
    });
    const channels = replaceIntegratedChannel(config.channels, channel, existingIndex);
    const next: AiConfig = {
        ...config,
        channelMode: "local",
        baseUrl,
        apiKey,
        apiFormat: "openai",
        channels,
        models: modelOptionsFromChannels(channels),
    };

    if (fetchedModels) {
        next.imageModel = selectDefaultModel(next, config.imageModel, "image");
        next.videoModel = selectDefaultModel(next, config.videoModel, "video");
        next.textModel = selectDefaultModel(next, config.textModel, "text");
        next.audioModel = selectDefaultModel(next, config.audioModel, "audio");
        next.model = next.imageModel || next.textModel || next.videoModel || next.audioModel || "";
    }

    return next;
}

export function hasIntegratedModels(config: AiConfig, baseUrl: string) {
    const index = findIntegratedChannel(config.channels, baseUrl);
    return index >= 0 && config.channels[index].models.length > 0;
}

function parseFragmentParams(hash: string) {
    return new URLSearchParams(hash.replace(/^#\/?\??/, ""));
}

function readParam(params: URLSearchParams, camelCase: string, lowerCase: string) {
    return params.get(camelCase)?.trim() || params.get(lowerCase)?.trim() || "";
}

function normalizeBaseUrl(value: string) {
    return value.trim().replace(/\/+$/, "");
}

function isAllowedNewApiUrl(value: string, canvasHostname: string) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname === canvasHostname && url.port === "10443" && (!url.pathname || url.pathname === "/");
    } catch {
        return false;
    }
}

function isApiKey(value: string) {
    return /^sk-[A-Za-z0-9._-]{6,}$/.test(value);
}

function findIntegratedChannel(channels: ModelChannel[], baseUrl: string) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const explicit = channels.findIndex((channel) => channel.id === NEW_API_CHANNEL_ID);
    if (explicit >= 0) return explicit;
    const matching = channels.findIndex((channel) => normalizeBaseUrl(channel.baseUrl) === normalizedBaseUrl);
    if (matching >= 0) return matching;
    const defaultChannel = channels[0];
    return defaultChannel?.id === "default" && defaultChannel.baseUrl === "https://api.openai.com" ? 0 : -1;
}

function replaceIntegratedChannel(channels: ModelChannel[], channel: ModelChannel, existingIndex: number) {
    if (existingIndex < 0) return [channel, ...channels];
    return channels.map((current, index) => (index === existingIndex ? channel : current));
}

function selectDefaultModel(config: AiConfig, current: string, capability: ModelCapability) {
    if (current && modelMatchesCapability(config, current, capability)) return current;
    const channel = config.channels.find((item) => item.id === NEW_API_CHANNEL_ID || normalizeBaseUrl(item.baseUrl) === normalizeBaseUrl(config.baseUrl));
    if (!channel) return "";
    const preferred = MODEL_PRIORITIES[capability].find((name) => channel.models.some((model) => model.name === name && model.capability === capability));
    const fallback = channel.models.find((model) => model.capability === capability)?.name;
    return preferred || fallback ? encodeChannelModel(channel.id, preferred || fallback || "") : "";
}
