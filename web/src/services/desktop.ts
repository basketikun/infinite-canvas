import type { AiConfig, WebdavSyncConfig } from "@/stores/use-config-store";

export type DesktopAgentReady = {
    url: string;
    token: string;
    logPath: string;
};

export type DesktopCredentials = {
    channels: Record<string, string>;
    webdavPassword: string;
};

let pendingUpdate: import("@tauri-apps/plugin-updater").Update | null = null;
let credentialSyncQueue: Promise<void> = Promise.resolve();
let agentCommandQueue: Promise<unknown> = Promise.resolve();

async function desktopInvoke<T>(command: string, request?: unknown) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(command, request === undefined ? undefined : { request });
}

function enqueueAgentCommand<T>(command: () => Promise<T>) {
    const result = agentCommandQueue.catch(() => undefined).then(command);
    agentCommandQueue = result;
    return result;
}

export function bootstrapDesktopAgent() {
    return enqueueAgentCommand(() => desktopInvoke<DesktopAgentReady>("desktop_bootstrap"));
}

export function restartDesktopAgent() {
    return enqueueAgentCommand(() => desktopInvoke<DesktopAgentReady>("restart_desktop_agent"));
}

export function configureDesktopAgent(config: { baseUrl: string; apiKey: string; model: string }) {
    return enqueueAgentCommand(() => desktopInvoke<DesktopAgentReady>("configure_desktop_agent", config));
}

export function clearDesktopAgentConfiguration() {
    return enqueueAgentCommand(() => desktopInvoke<DesktopAgentReady>("clear_desktop_agent_configuration"));
}

export function hydrateDesktopCredentials(config: AiConfig, webdav: WebdavSyncConfig) {
    return desktopInvoke<DesktopCredentials>("hydrate_desktop_credentials", {
        channels: config.channels.map((channel) => ({ id: channel.id, apiKey: channel.apiKey })),
        webdavPassword: webdav.password,
    });
}

export function syncDesktopCredentials(config: AiConfig, webdav: WebdavSyncConfig) {
    const request = {
        channels: config.channels.map((channel) => ({ id: channel.id, apiKey: channel.apiKey })),
        webdavPassword: webdav.password,
    };

    const sync = credentialSyncQueue
        .catch(() => undefined)
        .then(() => desktopInvoke<void>("sync_desktop_credentials", request));
    credentialSyncQueue = sync;
    return sync;
}

export async function checkForDesktopUpdate() {
    const { check } = await import("@tauri-apps/plugin-updater");
    pendingUpdate = await check();
    return pendingUpdate ? { version: pendingUpdate.version, notes: pendingUpdate.body || "" } : null;
}

export async function installDesktopUpdate() {
    if (!pendingUpdate) return;
    await pendingUpdate.downloadAndInstall();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
}
