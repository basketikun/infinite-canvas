import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@/lib/audio-generation";
import { createModelChannel, encodeChannelModel, modelOptionsFromChannels, useConfigStore, type ApiCallFormat, type ModelCapability } from "@/stores/use-config-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";

const MODEL_PARAMS = [
    ["imageModel", "image"],
    ["textModel", "text"],
    ["videoModel", "video"],
    ["audioModel", "audio"],
] as const satisfies ReadonlyArray<readonly ["imageModel" | "textModel" | "videoModel" | "audioModel", ModelCapability]>;

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const handledConfigParams = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    usePromptSourceScheduler();

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        const apiFormatParam = searchParams.get("apiFormat");
        const apiFormat: ApiCallFormat | null = apiFormatParam === "openai" || apiFormatParam === "gemini" ? apiFormatParam : null;
        const canvasImageCount = searchParams.get("canvasImageCount");
        const audioVoice = searchParams.get("audioVoice");
        const audioFormat = searchParams.get("audioFormat");
        const audioSpeed = searchParams.get("audioSpeed");
        const modelParams = MODEL_PARAMS.map(([key, capability]) => ({ key, capability, value: searchParams.get(key)?.trim() || "" }));
        const configParamNames = ["baseUrl", "baseurl", "apiKey", "apikey", "apiFormat", "canvasImageCount", "audioVoice", "audioFormat", "audioSpeed", ...MODEL_PARAMS.map(([key]) => key)];
        if (!configParamNames.some((key) => searchParams.has(key))) return;

        handledConfigParams.current = true;
        configParamNames.forEach((key) => searchParams.delete(key));
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);

        const hasModelConfig = modelParams.some((item) => item.value);
        const hasApiConfig = Boolean(baseUrl || apiKey || apiFormat);
        if (baseUrl || apiKey || apiFormat || hasModelConfig) {
            const firstChannel = config.channels[0] ||
                createModelChannel({
                    id: "default",
                    name: t("config.channels.defaultName"),
                    baseUrl: baseUrl || config.baseUrl,
                    apiKey: apiKey || config.apiKey,
                    apiFormat: apiFormat || config.apiFormat,
                });
            const models = [...firstChannel.models];
            modelParams.forEach(({ capability, value }) => {
                if (!value) return;
                const index = models.findIndex((model) => model.name === value);
                if (index >= 0) models[index] = { ...models[index], capability };
                else models.push({ name: value, capability });
            });
            const nextFirstChannel = {
                ...firstChannel,
                ...(baseUrl ? { baseUrl } : {}),
                ...(apiKey ? { apiKey } : {}),
                ...(apiFormat ? { apiFormat } : {}),
                models,
            };
            const channels = [nextFirstChannel, ...config.channels.slice(1)];
            updateConfig("channels", channels);
            if (hasModelConfig) updateConfig("models", modelOptionsFromChannels(channels));
            modelParams.forEach(({ key, value }) => {
                if (value) updateConfig(key, encodeChannelModel(nextFirstChannel.id, value));
            });
        }

        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        if (apiFormat) updateConfig("apiFormat", apiFormat);
        if (canvasImageCount !== null) updateConfig("canvasImageCount", String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(canvasImageCount)) || 3)))));
        if (audioVoice !== null) updateConfig("audioVoice", normalizeAudioVoiceValue(audioVoice));
        if (audioFormat !== null) updateConfig("audioFormat", normalizeAudioFormatValue(audioFormat));
        if (audioSpeed !== null) updateConfig("audioSpeed", normalizeAudioSpeedValue(audioSpeed));
        if (hasApiConfig) {
            openConfigDialog(false);
            message.success(t("config.importedDirectConfig"));
        }
    }, [config, message, openConfigDialog, t, updateConfig]);

    return <>{children}</>;
}
