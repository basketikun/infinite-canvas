import type { WorkspaceConfig } from "@infinite-canvas/shared/workspace-config";
import type { StorageRecord, StorageWrite } from "@infinite-canvas/shared/storage-data";
import { requestStorage } from "@workbench/lib/storage-request";
import type { WorkspaceConfigAdapter } from "./runtime";

export function createHttpWorkspaceConfig(): WorkspaceConfigAdapter {
    const clientId = crypto.randomUUID();
    return {
        async load() {
            const record = await (await requestStorage("/api/workspace-config")).json() as StorageRecord<WorkspaceConfig> | null;
            return record?.value ?? null;
        },
        async save(config) {
            await requestStorage("/api/workspace-config", {
                method: "PUT", headers: { "content-type": "application/json" },
                body: JSON.stringify({ value: config, clientId } satisfies StorageWrite),
            });
        },
        async update(change) {
            const response = await requestStorage("/api/workspace-config", {
                method: "PATCH", headers: { "content-type": "application/json" },
                body: JSON.stringify({ value: change, clientId }),
            });
            return await response.json() as boolean;
        },
    };
}
