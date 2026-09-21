import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { hostedAgentApi } from "@/services/api/hosted-agent";

const deletingHostedProjects = new Set<string>();

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const handledConfigParams = useRef(false);
    const importChannelCredentials = useConfigStore((state) => state.importChannelCredentials);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const initializeUser = useUserStore((state) => state.initialize);
    const user = useUserStore((state) => state.user);
    const accessToken = useUserStore((state) => state.accessToken);
    const deletedProjects = useCanvasStore((state) => state.deletedProjects);
    const markAgentProjectDeleted = useCanvasStore((state) => state.markAgentProjectDeleted);

    useEffect(() => {
        void initializeUser();
    }, [initializeUser]);

    useEffect(() => {
        if (!user || !accessToken) return;
        deletedProjects.filter((item) => item.agentProjectId && item.agentOwnerUserId === user.id).forEach((item) => {
            const agentProjectId = item.agentProjectId!;
            if (deletingHostedProjects.has(agentProjectId)) return;
            deletingHostedProjects.add(agentProjectId);
            void hostedAgentApi.deleteProject(accessToken, agentProjectId).then(() => markAgentProjectDeleted(item.id)).catch((error) => {
                deletingHostedProjects.delete(agentProjectId);
                message.error(error instanceof Error ? error.message : "删除托管项目失败");
            });
        });
    }, [accessToken, deletedProjects, markAgentProjectDeleted, message, user]);

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
