import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { isDesktopApp } from "@/lib/desktop-runtime";
import { checkForDesktopUpdate, clearDesktopAgentConfiguration, configureDesktopAgent, hydrateDesktopCredentials, installDesktopUpdate, syncDesktopCredentials, type DesktopAgentReady } from "@/services/desktop";
import { modelOptionName, resolveModelChannel, useConfigStore } from "@/stores/use-config-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const handledConfigParams = useRef(false);
    const importChannelCredentials = useConfigStore((state) => state.importChannelCredentials);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const config = useConfigStore((state) => state.config);
    const webdav = useConfigStore((state) => state.webdav);
    const [desktopCredentialsReady, setDesktopCredentialsReady] = useState(false);
    const desktopStarted = useRef(false);
    const updateChecked = useRef(false);
    const lastAgentConfig = useRef("");
    const lastCredentialConfig = useRef("");

    usePromptSourceScheduler();

    useEffect(() => {
        if (!isDesktopApp() || desktopStarted.current) return;
        desktopStarted.current = true;
        const initialize = async () => {
            try {
                const current = useConfigStore.getState();
                const credentials = await hydrateDesktopCredentials(current.config, current.webdav);
                const hydratedConfig = { ...current.config, channels: current.config.channels.map((channel) => ({ ...channel, apiKey: credentials.channels[channel.id] || "" })) };
                const hydratedWebdav = { ...current.webdav, password: credentials.webdavPassword || "" };
                useConfigStore.setState({ config: hydratedConfig, webdav: hydratedWebdav });
                await syncDesktopCredentials(hydratedConfig, hydratedWebdav);
                setDesktopCredentialsReady(true);
            } catch (error) {
                setDesktopCredentialsReady(true);
                message.error(error instanceof Error ? error.message : t("desktop.credentialsFailed"));
            }
        };
        void initialize();
    }, [message, t]);

    useEffect(() => {
        if (!isDesktopApp() || !desktopCredentialsReady) return;
        const fingerprint = JSON.stringify({ channels: config.channels.map(({ id, apiKey }) => ({ id, apiKey })), webdavPassword: webdav.password });
        if (lastCredentialConfig.current !== fingerprint) {
            lastCredentialConfig.current = fingerprint;
            void syncDesktopCredentials(config, webdav).catch((error) => {
                message.error(error instanceof Error ? error.message : t("desktop.credentialsFailed"));
            });
        }

        const selected = config.agentModel;
        const channel = selected ? resolveModelChannel(config, selected) : null;
        const agentConfig = channel && selected && channel.baseUrl.trim() && channel.apiKey.trim()
            ? { baseUrl: channel.baseUrl.trim(), apiKey: channel.apiKey.trim(), model: modelOptionName(selected) }
            : null;
        const agentFingerprint = agentConfig ? JSON.stringify(agentConfig) : "unconfigured";
        if (lastAgentConfig.current === agentFingerprint) return;
        lastAgentConfig.current = agentFingerprint;
        const start = agentConfig ? configureDesktopAgent(agentConfig) : clearDesktopAgentConfiguration();
        void start.then(applyDesktopAgentReady).catch((error) => {
            useAgentStore.getState().setAgentState({ enabled: false, connected: false, connectError: error instanceof Error ? error.message : String(error), activeTab: "setup" });
        });
    }, [config, desktopCredentialsReady, message, t, webdav]);

    useEffect(() => {
        if (!isDesktopApp() || updateChecked.current) return;
        updateChecked.current = true;
        void checkForDesktopUpdate().then((update) => {
            if (!update) return;
            modal.confirm({
                title: t("desktop.updateTitle", { version: update.version }),
                content: update.notes || t("desktop.updateDescription"),
                okText: t("desktop.updateNow"),
                cancelText: t("desktop.updateLater"),
                onOk: () => installDesktopUpdate(),
            });
        }).catch(() => undefined);
    }, [modal, t]);

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
        const result = importChannelCredentials({ baseUrl, apiKey });
        openConfigDialog(false, "channels");
        if (result.status === "created") message.success(t("config.importedChannelCreated", { name: result.channelName }));
        else if (result.status === "updated") message.success(t("config.importedChannelUpdated", { name: result.channelName }));
        else if (result.status === "missing-base-url") message.error(t("config.importedChannelBaseUrlRequired"));
        else message.error(t("config.importedChannelBaseUrlInvalid"));
    }, [importChannelCredentials, message, openConfigDialog, t]);

    return <>{children}</>;
}

function applyDesktopAgentReady(ready: DesktopAgentReady) {
    useAgentStore.getState().setAgentState({
        url: ready.url,
        token: ready.token,
        enabled: true,
        connected: false,
        silentConnect: true,
        connectError: "",
        activity: i18n.t("agent.status.connecting"),
    });
}
