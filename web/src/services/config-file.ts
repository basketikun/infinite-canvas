import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { healPresetScripts } from "@/lib/provider-presets";
import { normalizePersistedConfig, useConfigStore, type AiConfig, type WebdavSyncConfig } from "@/stores/use-config-store";
import { usePromptSourceStore, type PromptSourceSchedule } from "@/stores/use-prompt-source-store";
import type { PromptSource } from "@/services/api/prompt-source-presets";

type AppConfigFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    config: AiConfig;
    webdav: WebdavSyncConfig;
    promptSources: {
        sources: PromptSource[];
        schedule: PromptSourceSchedule;
    };
};

export function exportAppConfig() {
    const { config, webdav } = useConfigStore.getState();
    const { sources, schedule } = usePromptSourceStore.getState();
    const data: AppConfigFile = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), config, webdav, promptSources: { sources, schedule } };
    saveAs(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), "infinite-canvas-config.json");
}

export async function importAppConfig(file: File) {
    let data: AppConfigFile;
    try {
        data = JSON.parse(await file.text()) as AppConfigFile;
    } catch {
        throw new Error(i18n.t("config.invalidFile"));
    }
    if (data.app !== "infinite-canvas" || data.version !== 1 || !data.config || !data.webdav || !data.promptSources) throw new Error(i18n.t("config.invalidFile"));
    // Same normalization a reload applies, so an imported file cannot enter in a state the app
    // would have repaired on startup. Migration flags start empty because the file was written by
    // whatever build the user exported from, so every migration has to be re-evaluated against it.
    const { config, webdav } = normalizePersistedConfig({ config: data.config, webdav: data.webdav });
    useConfigStore.setState({ config, webdav, migrations: {} });
    usePromptSourceStore.setState(data.promptSources);
    healPresetScripts();
}
