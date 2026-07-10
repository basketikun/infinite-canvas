"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { createModelChannel, FIXED_AI_BASE_URL, useConfigStore } from "@/stores/use-config-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const hasBaseUrl = searchParams.has("baseUrl") || searchParams.has("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!hasBaseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        if (!apiKey) return;
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                baseUrl: FIXED_AI_BASE_URL,
                                apiKey,
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: "默认渠道", apiKey })],
        );
        updateConfig("apiKey", apiKey);
        openConfigDialog(false);
        message.success("API Key 已导入");
    }, [config.channels, message, openConfigDialog, updateConfig]);

    return <>{children}</>;
}
