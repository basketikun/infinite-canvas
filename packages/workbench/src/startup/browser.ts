import { initializePlugins } from "../services/plugins/runtime";
import { createBrowserStorage } from "../services/storage/browser";
import { prepareBrowserStorage } from "../services/storage/browser-stores";
import { initializeStorage } from "../services/storage/runtime";
import { initializeChannels } from "../services/channels/runtime";
import { initializeModels } from "../services/api/models/runtime";
import { initializeNetwork } from "../services/network/runtime";
import { initializeWorkspaceConfig } from "../services/workspace-config/runtime";
import { createBrowserWorkspaceConfig } from "../services/workspace-config/browser";
import { loadWorkspaceConfig } from "../stores/use-workspace-config-store";
import { initializeStorageInspection } from "../services/storage-inspection/runtime";
import { createBrowserStorageInspection } from "../services/storage-inspection/browser";

export async function startBrowser() {
    await prepareBrowserStorage();
    const storage = createBrowserStorage();
    initializeStorage(storage);
    initializeStorageInspection(createBrowserStorageInspection());
    initializeWorkspaceConfig(createBrowserWorkspaceConfig());
    await loadWorkspaceConfig();
    const { createBrowserNetwork } = await import("../services/network/browser");
    initializeNetwork(createBrowserNetwork());
    // 模型脚本库在导入时读取存储，必须等存储初始化后再加载。
    const { createBrowserModels } = await import("../services/api/models/browser");
    const { createBrowserChannels } = await import("../services/channels/browser");
    initializeChannels(createBrowserChannels());
    const { loadChannelConfig } = await import("../stores/use-config-store");
    await loadChannelConfig();
    initializeModels(createBrowserModels());
    const { createBrowserPlugins } = await import("../services/plugins/browser");
    initializePlugins(createBrowserPlugins());
}
