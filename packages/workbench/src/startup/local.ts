import { initializePlugins } from "../services/plugins/runtime";
import { createHttpStorage } from "../services/storage/http";
import { initializeStorage } from "../services/storage/runtime";
import { initializeChannels } from "../services/channels/runtime";
import { createHttpChannels } from "../services/channels/http";
import { initializeModels } from "../services/api/models/runtime";
import { initializeNetwork } from "../services/network/runtime";
import { createLocalNetwork } from "../services/network/local";
import { initializeWorkspaceConfig } from "../services/workspace-config/runtime";
import { createHttpWorkspaceConfig } from "../services/workspace-config/http";
import { loadWorkspaceConfig } from "../stores/use-workspace-config-store";
import { initializeStorageInspection } from "../services/storage-inspection/runtime";
import { createHttpStorageInspection } from "../services/storage-inspection/http";

export async function startLocal() {
    const response = await fetch("/api/storage/projects");
    if (!response.ok) throw new Error("WORKSPACE_UNAVAILABLE");
    const storage = createHttpStorage();
    initializeStorage(storage);
    initializeStorageInspection(createHttpStorageInspection());
    initializeWorkspaceConfig(createHttpWorkspaceConfig());
    await loadWorkspaceConfig();
    initializeNetwork(createLocalNetwork(location.origin));
    initializeChannels(createHttpChannels());
    const { loadChannelConfig } = await import("../stores/use-config-store");
    await loadChannelConfig();
    const { createHttpModels } = await import("../services/api/models/http");
    initializeModels(createHttpModels());
    const { createHttpPlugins } = await import("../services/plugins/http");
    initializePlugins(createHttpPlugins());
}
