import { StorageError } from "@infinite-canvas/shared/storage-data";
import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import { toast } from "sonner";

import { createSettingsWriter } from "@workbench/utils/settings-writer";
import { channels } from "@workbench/services/channels/runtime";
import { defaultCallScriptId } from "@workbench/lib/model-utils";
import { defaultGenerationOptions, normalizeGenerationOptions, type GenerationOptions } from "@workbench/lib/generation-options";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { listCallScripts } from "./use-call-script-store";
import type { ModelChannel, ModelGroup, ChannelModel } from "@infinite-canvas/shared/channels";
import type { CallScript, ModelCapability } from "@infinite-canvas/shared/models";
import type { AgentModelSettings, ModelCall, ReasoningEffort } from "@infinite-canvas/shared/model-execution";

export type AiConfig = {
    agentSettings?: AgentModelSettings;
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
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
    videoSize: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    videoMode: string;
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    models: string[];
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
    proxyEnabled: boolean;
    proxyUrl: string;
    autoFocusOnSelect: boolean;
    generationOptions: GenerationOptions;
};

export const CONFIG_STORE_KEY = "infinite-canvas-v1:ai_config_store";
const GROUP_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://api.openai.com";
export const LOCAL_PROXY_PACKAGE = "@basketikun/canvas-proxy";
export const DEFAULT_LOCAL_PROXY_URL = "http://127.0.0.1:23210";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: OPENAI_BASE_URL,
    apiKey: "",
    channels: [{ id: "default", name: "默认渠道", baseUrl: "", groups: [] }],
    model: "",
    imageModel: "",
    videoModel: "",
    textModel: "",
    audioModel: "",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSize: "1280x720",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    videoMode: "frames",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: [],
    quality: "auto",
    size: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "3",
    proxyEnabled: false,
    proxyUrl: DEFAULT_LOCAL_PROXY_URL,
    autoFocusOnSelect: false,
    generationOptions: defaultGenerationOptions,
};

type ConfigStore = {
    config: AiConfig;
    isConfigOpen: boolean;
    configSelection: { tab: string; channelId?: string; groupId?: string };
    configModel: string | null;
    autoFetchGroupId: string | null;
    shouldPromptContinue: boolean;
    updateConfig: <K extends Exclude<keyof AiConfig, "channels">>(key: K, value: AiConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: string, model?: string) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

export function boolConfig(value: string, fallback: boolean) {
    return value ? value === "true" : fallback;
}

export function findModelGroup(channels: ModelChannel[], groupId: string) {
    for (const channel of channels) {
        const group = channel.groups.find((item) => item.id === groupId);
        if (group) return { channel, group };
    }
}

export function findGroupModel(config: AiConfig, value: string) {
    const decoded = decodeGroupModel(value);
    if (decoded) {
        const target = findModelGroup(config.channels, decoded.groupId);
        return target && { ...target, model: target.group.models.find((item) => item.name === decoded.model) };
    }
    const matches = config.channels.flatMap((channel) => channel.groups.flatMap((group) => group.models.filter((model) => model.name === value).map((model) => ({ channel, group, model }))));
    return matches.length === 1 ? matches[0] : undefined;
}

export function modelCapabilityOf(config: AiConfig, value: string): ModelCapability | undefined {
    return findGroupModel(config, value)?.model?.capability;
}

export function resolveModelForCapability(config: AiConfig, currentModel: string | undefined, capability: ModelCapability) {
    const defaultModel = capability === "image" ? config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel;
    for (const model of [currentModel, defaultModel]) {
        if (!model) continue;
        const configuredCapability = modelCapabilityOf(config, model);
        // Keep unavailable selections visible so the readiness check blocks the
        // request. Only a known capability switch may choose another model.
        if (!configuredCapability || configuredCapability === capability) return model;
    }
    return "";
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config.channels.flatMap((channel) => channel.groups.flatMap((group) => group.models.filter((model) => model.capability === capability).map((model) => encodeGroupModel(group.id, model.name))));
}

export function getModelConfigIssue(config: AiConfig, value: string, scripts: CallScript[] = listCallScripts(), requestedScriptId?: string) {
    const decoded = decodeGroupModel(value);
    const name = modelOptionName(value);
    const { channel, group, model } = findGroupModel(config, value) || {};
    const scriptId = requestedScriptId ?? (model && (model.scriptId ?? defaultCallScriptId(model.name, model.capability)));
    const script = scripts.find((item) => item.id === scriptId);
    let reason: string;
    if (!value) reason = "modelRequired";
    else if (decoded && !group) reason = "groupUnavailable";
    else if (!channel || !group || !model) reason = "modelUnavailable";
    else if (!channel.baseUrl) reason = "baseUrlRequired";
    else if (!group.apiKey && !group.hasApiKey) reason = "apiKeyRequired";
    else if (!scriptId) reason = "scriptRequired";
    else if (!script) reason = "scriptUnavailable";
    else if (script.capability !== model.capability) reason = "scriptCapabilityMismatch";
    else if (!script.source) reason = "scriptEmpty";
    else return null;
    return { message: ({ "modelRequired": "尚未选择模型，请关闭设置，在生成面板选择模型后重新发送。", "groupUnavailable": `模型「${name}」原来使用的渠道或分组已不存在，请在生成面板重新选择。`, "modelUnavailable": `当前分组无法确定模型「${name}」，请添加该模型，或在生成面板重新选择对应分组的模型。`, "baseUrlRequired": `渠道「${channel?.name}」未填写服务地址，请编辑该渠道并填写服务地址。`, "apiKeyRequired": `分组「${group?.name}」未填写密钥，请编辑该分组并填写 API Key。`, "scriptRequired": `模型「${name}」尚未选择调用方式，请在渠道设置中选择。`, "scriptUnavailable": `模型「${name}」所选调用方式已被删除或不可用，请在渠道设置中重新选择。`, "scriptCapabilityMismatch": `模型「${name}」所选调用方式与模型用途不匹配，请在渠道设置中重新选择。`, "scriptEmpty": `模型「${name}」所选调用方式没有内容，请重新选择或补全调用脚本。` } as Record<string, string>)[reason], channelId: channel?.id, groupId: group?.id };
}

export const useConfigStore = create<ConfigStore>()(persist(
    (set) => ({
        config: defaultConfig,
        isConfigOpen: false,
        configSelection: { tab: "builtin:channels" },
        configModel: null,
        autoFetchGroupId: null,
        shouldPromptContinue: false,
        updateConfig: (key, value) => set((state) => ({ config: { ...state.config, [key]: value } })),
        isAiConfigReady: (config, model) => !getModelConfigIssue(config, model),
        openConfigDialog: (shouldPromptContinue = false, tab = "builtin:channels", configModel: string | null = null) => set({ isConfigOpen: true, shouldPromptContinue, configSelection: { tab }, configModel }),
        setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen, configModel: null }),
        clearPromptContinue: () => set({ shouldPromptContinue: false }),
    }),
    {
        name: CONFIG_STORE_KEY,
        storage: createJSONStorage(() => localStorage),
        version: 3,
        partialize: (state) => ({ config: { ...state.config, channels: [], models: [], apiKey: "", baseUrl: "" } }),
        merge: (persisted, current) => ({ ...current, config: { ...defaultConfig, ...(persisted as Pick<ConfigStore, "config"> | undefined)?.config, channels: [], models: [] } }),
    },
));

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

/**
 * 按模型名称去重，未选择调用方式的模型按名称和用途预选脚本。
 */
export function normalizeChannelModels(models: ChannelModel[]): ChannelModel[] {
    const seen = new Set<string>();
    return models.filter((model) => {
        if (seen.has(model.name)) return false;
        seen.add(model.name);
        return true;
    }).map((model) => ({ ...model, scriptId: model.scriptId ?? defaultCallScriptId(model.name, model.capability) }));
}

export function createModelGroup({ id = nanoid(), name = "新分组", apiKey = "", hasApiKey = false, models = [] }: Partial<ModelGroup> = {}): ModelGroup {
    return { id, name, apiKey, hasApiKey, models: normalizeChannelModels(models) };
}

export function createModelChannel({ id = nanoid(), name = "新渠道", baseUrl = "", groups = [] }: Partial<ModelChannel> = {}): ModelChannel {
    return { id, name, baseUrl, groups: groups.map(createModelGroup) };
}

export function encodeGroupModel(groupId: string, model: string) {
    return `${groupId}${GROUP_MODEL_SEPARATOR}${model}`;
}

export function decodeGroupModel(value: string) {
    const index = value.indexOf(GROUP_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { groupId: value.slice(0, index), model: value.slice(index + GROUP_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeGroupModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeGroupModel(value);
    if (!decoded) return value;
    const target = findModelGroup(config.channels, decoded.groupId);
    return target ? `${decoded.model}（${target.channel.name} / ${target.group.name}）` : decoded.model;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return channels.flatMap((channel) => channel.groups.flatMap((group) => group.models.map((model) => encodeGroupModel(group.id, model.name))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    if (!value) return "";
    if (decodeGroupModel(value)) return value;
    const matches = channels.flatMap((channel) => channel.groups.filter((group) => group.models.some((model) => model.name === value)));
    return matches.length === 1 ? encodeGroupModel(matches[0].id, value) : value;
}

export function resolveModelRequestConfig(config: AiConfig, value: string, requestedScriptId?: string): ModelCall {
    const issue = getModelConfigIssue(config, value, undefined, requestedScriptId);
    if (issue) throw new Error(issue.message);
    const { channel, group, model } = findGroupModel(config, value)!;
    const scriptId = requestedScriptId ?? model!.scriptId ?? defaultCallScriptId(model!.name, model!.capability);
    const callScript = listCallScripts().find((item) => item.id === scriptId)!;
    return {
        groupId: group.id,
        model: model!.name,
        baseUrl: channel.baseUrl,
        apiKey: group.apiKey,
        systemPrompt: config.systemPrompt,
        reasoningEffort: config.reasoningEffort,
        scriptId,
        script: callScript.source,
        agentSettings: model!.agentSettings,
    };
}

export function normalizeLocalProxyUrl(value: string) {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (!trimmed) return "";
    return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export const channelWrites = createSettingsWriter(async (value: ModelChannel[]) => {
    try {
        const saved = await channels.save(value);
        if (useConfigStore.getState().config.channels === value) {
            useConfigStore.setState((state) => ({ config: withChannels(state.config, saved) }));
        }
    } catch (error) {
        throw error instanceof StorageError ? error : new StorageError("STORAGE_UNAVAILABLE");
    }
});

export async function loadChannelConfig() {
    const saved = await channels.load();
    const initial = saved === null ? await channels.save(defaultConfig.channels) : saved;
    useConfigStore.setState((state) => ({ config: withChannels(state.config, initial.map(createModelChannel)) }));
    void importChannelFromUrl();
}

/** 地址栏带 baseUrl 与 apiKey 时补齐渠道与分组，读取后立即从地址栏移除；模型由渠道设置面板自动拉取。 */
async function importChannelFromUrl() {
    const params = new URLSearchParams(location.search);
    const baseUrl = (params.get("baseUrl") ?? params.get("baseurl"))?.replace(/\/+$/, "");
    const apiKey = params.get("apiKey") ?? params.get("apikey");
    if (!baseUrl) return;
    ["baseUrl", "baseurl", "apiKey", "apikey"].forEach((key) => params.delete(key));
    history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
    if (apiKey) toast.warning("温馨提示：您的密钥出现在了网页地址中，建议使用完后轮换密钥，避免泄漏。", { ...workbenchMessageOptions.warning, duration: 15000 });
    const current = useConfigStore.getState().config.channels;
    const existing = current.find((item) => item.baseUrl.replace(/\/+$/, "") === baseUrl);
    const sameKey = existing?.groups.find((item) => item.apiKey === apiKey);
    if (existing && (!apiKey || sameKey)) {
        useConfigStore.setState({ isConfigOpen: true, configSelection: { tab: "builtin:channels", channelId: existing.id, groupId: sameKey?.id ?? existing.groups[0]?.id } });
        return;
    }
    let host: string[];
    try {
        host = new URL(baseUrl).hostname.split(".");
    } catch {
        toast.error("链接中的服务地址无效，需要以 http:// 或 https:// 开头。", workbenchMessageOptions.error);
        return;
    }
    const channel = existing ?? createModelChannel({ name: host.at(-2) ?? host[0], baseUrl });
    const group = createModelGroup({ name: `分组 ${channel.groups.length + 1}`, apiKey: apiKey ?? "", hasApiKey: Boolean(apiKey) });
    const next = { ...channel, groups: [...channel.groups, group] };
    void updateChannels(existing ? current.map((item) => item === existing ? next : item) : [...current, next]);
    useConfigStore.setState({ isConfigOpen: true, configSelection: { tab: "builtin:channels", channelId: channel.id, groupId: group.id }, autoFetchGroupId: apiKey ? group.id : null });
}

export function updateChannels(value: ModelChannel[]) {
    value = value.map(createModelChannel);
    useConfigStore.setState((state) => ({ config: withChannels(state.config, value) }));
    return channelWrites.save(value);
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const next: AiConfig = {
        ...config,
        channels,
        models: modelOptionsFromChannels(channels),
    };
    return {
        ...next,
        generationOptions: normalizeGenerationOptions(config.generationOptions),
        imageModel: pickDefaultModel(next, "image", config.imageModel),
        videoModel: pickDefaultModel(next, "video", config.videoModel),
        textModel: pickDefaultModel(next, "text", config.textModel),
        audioModel: pickDefaultModel(next, "audio", config.audioModel),
    };
}

function pickDefaultModel(config: AiConfig, capability: ModelCapability, current: string) {
    const options = selectableModelsByCapability(config, capability);
    const normalized = normalizeModelOptionValue(current, config.channels);
    return current ? normalized : options[0] || "";
}

