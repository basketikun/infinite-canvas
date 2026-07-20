import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { createModelChannel, useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";
import { useUserStore } from "@/stores/use-user-store";
import { fetchPublicSettings, toServerChannel } from "@/services/control-plane/settings";
import { CONTROL_PLANE_URL } from "@/constant/runtime-config";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const hydrateUser = useUserStore((state) => state.hydrateUser);
    const token = useUserStore((state) => state.token);

    usePromptSourceScheduler();

    useEffect(() => {
        void hydrateUser();
    }, [hydrateUser]);

    useEffect(() => {
        if (config.channelMode !== "remote" || !token || !CONTROL_PLANE_URL) return;
        void fetchPublicSettings()
            .then((settings) => {
                const channel = toServerChannel(settings, CONTROL_PLANE_URL);
                const modelChannel = settings.modelChannel;
                updateConfig("channels", [channel]);
                updateConfig("models", channel.models.map((model) => `server::${model.name}`));
                updateConfig("model", `server::${modelChannel.defaultModel || channel.models[0]?.name || ""}`);
                updateConfig("imageModel", `server::${modelChannel.defaultImageModel || modelChannel.defaultModel || ""}`);
                updateConfig("videoModel", `server::${modelChannel.defaultVideoModel || modelChannel.defaultModel || ""}`);
                updateConfig("textModel", `server::${modelChannel.defaultTextModel || modelChannel.defaultModel || ""}`);
                updateConfig("systemPrompt", modelChannel.systemPrompt || "");
            })
            .catch(() => undefined);
    }, [config.channelMode, token, updateConfig]);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                ...(baseUrl ? { baseUrl } : {}),
                                ...(apiKey ? { apiKey } : {}),
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: "默认渠道", baseUrl: baseUrl || undefined, apiKey: apiKey || "" })],
        );
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
        message.success("已导入本地直连配置");
    }, [config.channels, message, openConfigDialog, updateConfig]);

    return <>{children}</>;
}
