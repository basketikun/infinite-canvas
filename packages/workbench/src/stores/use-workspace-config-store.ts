import { create } from "zustand";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { StorageError } from "@infinite-canvas/shared/storage-data";
import { defaultWorkspaceConfig, syncTransportIdSchema, workspaceConfigMutationSchema, workspaceConfigSchema, workspaceConnection, type SyncConnectionConfig, type WorkspaceConfig } from "@infinite-canvas/shared/workspace-config";
import type { ObjectStorageConfig } from "@infinite-canvas/shared/object-storage";
import { workspaceConfig } from "@workbench/services/workspace-config/runtime";
import { reportStorageError } from "@workbench/services/storage/status";
import { createSettingsWriter } from "@workbench/utils/settings-writer";

let settled = Promise.resolve();
let inFlight = 0;
const failures = new Map<string, StorageError>();

function write(key: string, action: () => Promise<void>) {
    inFlight++;
    const receipt = settled.then(async () => {
        try {
            await action();
            if (key === "workspace") failures.clear();
            else failures.delete(key);
        } catch (error) {
            if (error instanceof PluginError) throw error;
            const reason = error instanceof StorageError ? error : new StorageError("STORAGE_UNAVAILABLE");
            failures.set(key, reason);
            reportStorageError(reason);
            throw reason;
        }
    }).finally(() => { inFlight--; });
    settled = receipt.catch(() => {});
    return receipt;
}

const objects = createSettingsWriter<ObjectStorageConfig>((config) => write("object-storage", async () => {
    await workspaceConfig.update({ kind: "objectStorage", config });
}));

export const workspaceConfigWrites = {
    get saving() { return objects.saving || inFlight > 0; },
    async flush() {
        let tail;
        do {
            await objects.flush().catch(() => {});
            tail = settled;
            await tail;
        } while (objects.saving || tail !== settled);
        if (failures.size) throw failures.values().next().value;
    },
};

type WorkspaceConfigStore = {
    objectStorage: ObjectStorageConfig;
    updateObjectStorage: <K extends keyof ObjectStorageConfig>(key: K, value: ObjectStorageConfig[K]) => Promise<void>;
};
export const useWorkspaceConfigStore = create<WorkspaceConfigStore>((set, get) => ({
    objectStorage: defaultWorkspaceConfig.objectStorage,
    updateObjectStorage(key, value) {
        const objectStorage = { ...get().objectStorage, [key]: value };
        set({ objectStorage });
        return objects.save(objectStorage);
    },
}));

export async function loadWorkspaceConfig() {
    const saved = await workspaceConfig.load();
    useWorkspaceConfigStore.setState({ objectStorage: saved?.objectStorage ?? structuredClone(defaultWorkspaceConfig.objectStorage) });
}

/** 只有显式导入完整配置才替换所有连接。 */
export async function saveWorkspaceConfig(value: WorkspaceConfig) {
    const config = workspaceConfigSchema.parse(value);
    await objects.flush().catch(() => {});
    useWorkspaceConfigStore.setState({ objectStorage: config.objectStorage });
    return write("workspace", () => workspaceConfig.save(config));
}

export async function readSyncConnection(id: string, packageName: string): Promise<SyncConnectionConfig | null> {
    syncTransportIdSchema.parse(id);
    await settled;
    const saved = await workspaceConfig.load();
    return saved ? structuredClone(workspaceConnection(saved, id, packageName)) : null;
}

export async function saveSyncConnection(id: string, packageName: string, config: SyncConnectionConfig) {
    const change = workspaceConfigMutationSchema.parse({ kind: "connection", id, packageName, config });
    return write(JSON.stringify([id, packageName]), async () => { await workspaceConfig.update(change); });
}

export async function confirmSyncConnection(id: string, packageName: string, expected: SyncConnectionConfig, syncedAt: string) {
    const change = workspaceConfigMutationSchema.parse({ kind: "confirm", id, packageName, expected, syncedAt });
    return write(JSON.stringify([id, packageName]), async () => {
        if (!await workspaceConfig.update(change)) throw new PluginError("PLUGIN_CONFLICT");
    });
}
