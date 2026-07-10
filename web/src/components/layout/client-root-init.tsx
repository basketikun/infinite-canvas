"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

import { fetchChannelModels } from "@/services/api/image";
import { applyModelChannels, createModelChannel, useConfigStore, type AiConfig } from "@/stores/use-config-store";

function saveConfig(config: AiConfig) {
    const { updateConfig } = useConfigStore.getState();
    (Object.keys(config) as Array<keyof AiConfig>).forEach((key) => updateConfig(key, config[key]));
}

export function ClientRootInit({ children }: { children: ReactNode }) {
    const initialized = useRef(false);

    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;

        const searchParams = new URLSearchParams(window.location.search);
        for (const key of ["baseUrl", "baseurl", "apiKey", "apikey"]) searchParams.delete(key);
        const nextSearch = searchParams.toString();
        if (nextSearch !== window.location.search.slice(1)) {
            window.history.replaceState(null, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`);
        }

        const current = useConfigStore.getState().config;
        const channel = createModelChannel({ ...current.channels[0], id: "default", name: "Token 模型服务" });
        saveConfig(applyModelChannels(current, [channel]));

        void fetchChannelModels(channel)
            .then((models) => {
                if (!models.length) return;
                const latest = useConfigStore.getState().config;
                saveConfig(applyModelChannels(latest, [{ ...channel, models }]));
            })
            .catch(() => {
                // 登录会话或模型权限异常会在实际请求时返回明确提示；初始化不阻断页面。
            });
    }, []);

    return <>{children}</>;
}
