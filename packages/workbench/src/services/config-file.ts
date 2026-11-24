import type { ObjectStorageConfig } from "@infinite-canvas/shared/object-storage";
import { defaultWorkspaceConfig, workspaceConfigSchema, type WorkspaceConfig } from "@infinite-canvas/shared/workspace-config";
import { workspaceConfig } from "./workspace-config/runtime";
import saveAs from "file-saver";

import { callScriptsSaved, updateCallScripts, useCallScriptStore } from "@workbench/stores/use-call-script-store";
import type { CallScript } from "@infinite-canvas/shared/models";
import { updateChannels, channelWrites, useConfigStore, type AiConfig } from "@workbench/stores/use-config-store";
import { workspaceConfigWrites, saveWorkspaceConfig } from "@workbench/stores/use-workspace-config-store";
import { usePromptSourceStore, type PromptSourceSchedule } from "@workbench/stores/use-prompt-source-store";
import type { PromptSource } from "@workbench/services/api/prompt-source-presets";

type AppConfigFile = {
    app: "infinite-canvas";
    version: 7;
    exportedAt: string;
    config: AiConfig;
    callScripts: { scripts: CallScript[]; removedBuiltinIds: string[] };
    syncConnections: WorkspaceConfig["syncConnections"];
    objectStorage: ObjectStorageConfig;
    promptSources: {
        sources: PromptSource[];
        schedule: PromptSourceSchedule;
    };
};

export async function exportAppConfig() {
    await Promise.all([callScriptsSaved, channelWrites.flush(), workspaceConfigWrites.flush()]);
    const { config } = useConfigStore.getState();
    const { syncConnections, objectStorage } = await workspaceConfig.load() ?? defaultWorkspaceConfig;
    const { sources, schedule } = usePromptSourceStore.getState();
    const { scripts, removedBuiltinIds } = useCallScriptStore.getState();
    const data: AppConfigFile = { app: "infinite-canvas", version: 7, exportedAt: new Date().toISOString(), config, callScripts: { scripts, removedBuiltinIds }, syncConnections, objectStorage, promptSources: { sources, schedule } };
    saveAs(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), "infinite-canvas-config.json");
}

export async function importAppConfig(file: File) {
    let data: AppConfigFile;
    try {
        data = JSON.parse(await file.text());
    } catch {
        throw new Error("配置文件格式不正确");
    }
    if (data.app !== "infinite-canvas" || data.version !== 7 || !data.config || !data.syncConnections || !data.objectStorage || !data.promptSources || !Array.isArray(data.callScripts?.scripts) || !Array.isArray(data.callScripts.removedBuiltinIds)) throw new Error("配置文件格式不正确");
    const workspace = workspaceConfigSchema.safeParse({ syncConnections: data.syncConnections, objectStorage: data.objectStorage });
    if (!workspace.success) throw new Error("配置文件格式不正确");
    const config = data.config;
    await Promise.all([channelWrites.flush(), workspaceConfigWrites.flush()]);
    const { scripts, removedBuiltinIds } = data.callScripts;
    await updateCallScripts(() => ({ scripts, removedBuiltinIds }));
    const currentGroups = useConfigStore.getState().config.channels.flatMap((channel) => channel.groups);
    void updateChannels(config.channels.map((channel) => ({ ...channel, groups: channel.groups.map((group) => {
        const current = currentGroups.find((item) => item.id === group.id);
        return { ...group, hasApiKey: Boolean(group.apiKey || (group.hasApiKey && (current?.apiKey || current?.hasApiKey))) };
    }) })));
    await channelWrites.flush();
    await saveWorkspaceConfig(workspace.data);
    useConfigStore.setState({ config: { ...config, channels: useConfigStore.getState().config.channels } });
    usePromptSourceStore.getState().saveConfig(data.promptSources);
}
