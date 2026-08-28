import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";
import { fetchChannelModels } from "@/services/api/image";
import {
    applyDirectLaunch,
    cleanDirectLaunchUrl,
    hasIntegratedModels,
    NEW_API_BOOTSTRAP_MARKER,
    parseDirectLaunch,
} from "@/services/integrations/new-api-bootstrap";
import { createModelChannel, useConfigStore } from "@/stores/use-config-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const handledConfigParams = useRef(false);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    usePromptSourceScheduler();

    useEffect(() => {
        if (handledConfigParams.current) return;
        const parsed = parseDirectLaunch(window.location);
        if (!parsed) return;
        handledConfigParams.current = true;
        if ("error" in parsed) {
            window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
            message.error(t(`config.newApi.${parsed.error}`));
            return;
        }

        const { launch } = parsed;
        window.history.replaceState(null, "", cleanDirectLaunchUrl(window.location, launch.source));

        const initialize = async () => {
            const current = useConfigStore.getState().config;
            let fetchedModels: string[] | undefined;
            let modelSyncFailed = false;
            const shouldFetchModels =
                launch.source === "newapi" &&
                Boolean(launch.baseUrl && launch.apiKey) &&
                (!window.localStorage.getItem(NEW_API_BOOTSTRAP_MARKER) || !hasIntegratedModels(current, launch.baseUrl || ""));

            if (shouldFetchModels && launch.baseUrl && launch.apiKey) {
                try {
                    fetchedModels = await fetchChannelModels(
                        createModelChannel({
                            id: "new-api",
                            name: "New API",
                            baseUrl: launch.baseUrl,
                            apiKey: launch.apiKey,
                            apiFormat: "openai",
                        }),
                    );
                } catch {
                    modelSyncFailed = true;
                }
            }

            const nextConfig = applyDirectLaunch(current, launch, fetchedModels);
            useConfigStore.setState({ config: nextConfig });

            if (launch.source === "newapi" && fetchedModels?.length) {
                window.localStorage.setItem(NEW_API_BOOTSTRAP_MARKER, "1");
            }

            if (modelSyncFailed || (launch.source === "newapi" && !hasIntegratedModels(nextConfig, launch.baseUrl || ""))) {
                openConfigDialog(false);
                message.error(t("config.newApi.modelSyncFailed"));
                return;
            }
            message.success(t(launch.source === "newapi" ? "config.newApi.connected" : "config.importedDirectConfig"));
        };

        void initialize();
    }, [message, openConfigDialog, t]);

    return <>{children}</>;
}
