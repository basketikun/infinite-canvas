import type { Express } from "express";
import { storedWorkspaceConfigSchema, workspaceConfigMutationSchema, workspaceConfigSchema } from "@infinite-canvas/shared/workspace-config";
import { storageWriteSchema, StorageError } from "@infinite-canvas/shared/storage-data";
import type { FsStorage } from "../storage/fs-storage.js";

export function mountWorkspaceConfig(app: Express, storage: FsStorage) {
    app.get("/api/workspace-config", async (req, res) => {
        const record = await storage.read("privateConfig", "workspace");
        if (!record || record.value === null) return void res.json(record);
        const config = storedWorkspaceConfigSchema.safeParse(record.value);
        if (!config.success) throw new StorageError("STORAGE_INVALID");
        res.json({ ...record, value: config.data });
    });
    app.put("/api/workspace-config", async (req, res) => {
        const input = storageWriteSchema.extend({ value: workspaceConfigSchema }).safeParse(req.body);
        if (!input.success) throw new StorageError("STORAGE_INVALID");
        const { value, clientId } = input.data;
        res.json(await storage.save("privateConfig", "workspace", value, clientId));
    });
    app.patch("/api/workspace-config", async (req, res) => {
        const input = storageWriteSchema.extend({ value: workspaceConfigMutationSchema }).safeParse(req.body);
        if (!input.success) throw new StorageError("STORAGE_INVALID");
        res.json(await storage.updateWorkspaceConfig(input.data.value, input.data.clientId));
    });
}
