import { expect, test } from "bun:test";

import { defaultConfig, useConfigStore } from "./use-config-store";
import { useUserStore } from "./use-user-store";

test("服务端模式使用登录会话而非供应商 API Key 判断就绪", () => {
    const previousToken = useUserStore.getState().token;
    const config = {
        ...defaultConfig,
        channelMode: "remote" as const,
        channels: [{ ...defaultConfig.channels[0], id: "server", baseUrl: "https://control-plane.example.test", apiKey: "", models: [{ name: "gpt-5.5", capability: "text" as const }] }],
    };

    try {
        useUserStore.setState({ token: "" });
        expect(useConfigStore.getState().isAiConfigReady(config, "server::gpt-5.5")).toBeFalse();

        useUserStore.setState({ token: "session-token" });
        expect(useConfigStore.getState().isAiConfigReady(config, "server::gpt-5.5")).toBeTrue();
    } finally {
        useUserStore.setState({ token: previousToken });
    }
});

test("云同步为每个画布保存已知服务端修订号", () => {
    const previous = useConfigStore.getState().cloudRevisions;
    try {
        useConfigStore.getState().setCloudRevision("project-1", 6);
        expect(useConfigStore.getState().cloudRevisions["project-1"]).toBe(6);
    } finally {
        useConfigStore.setState({ cloudRevisions: previous });
    }
});

test("未手动选择时按有效服务端会话决定默认模式", () => {
    const previousConfig = useConfigStore.getState().config;
    const previousPreference = useConfigStore.getState().channelModePreferenceSet;
    try {
        useConfigStore.setState({ channelModePreferenceSet: false, config: { ...defaultConfig, channelMode: "local" } });
        useConfigStore.getState().applyDefaultChannelMode(true);
        expect(useConfigStore.getState().config.channelMode).toBe("remote");

        useConfigStore.setState({ channelModePreferenceSet: false });
        useConfigStore.getState().applyDefaultChannelMode(false);
        expect(useConfigStore.getState().config.channelMode).toBe("local");
    } finally {
        useConfigStore.setState({ config: previousConfig, channelModePreferenceSet: previousPreference });
    }
});

test("手动选择模式后自动默认逻辑不得覆盖选择", () => {
    const previousConfig = useConfigStore.getState().config;
    const previousPreference = useConfigStore.getState().channelModePreferenceSet;
    try {
        useConfigStore.setState({ channelModePreferenceSet: false, config: { ...defaultConfig, channelMode: "remote" } });
        useConfigStore.getState().setChannelMode("local");
        useConfigStore.getState().applyDefaultChannelMode(true);
        expect(useConfigStore.getState().config.channelMode).toBe("local");
        expect(useConfigStore.getState().channelModePreferenceSet).toBeTrue();
    } finally {
        useConfigStore.setState({ config: previousConfig, channelModePreferenceSet: previousPreference });
    }
});
