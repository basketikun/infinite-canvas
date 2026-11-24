import express, { type Express, type Response } from "express";
import type { FileHandle } from "node:fs/promises";
import { z } from "zod";
import type { WebSocket } from "ws";
import { pluginSyncSnapshotSchema } from "@infinite-canvas/shared/sync-data";
import type { ArchiveThread } from "@infinite-canvas/shared/chat";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { buffer } from "node:stream/consumers";
import { archiveResourceSchema, decodeArchiveInstall } from "@infinite-canvas/shared/work-archive";
import { chatSyncRecordSchema, projectDeletionSchema, StorageError, storageWriteSchema, workSyncRecordSchema } from "@infinite-canvas/shared/storage-data";
import { publicStorageCollections, type FsStorage } from "../storage/fs-storage.js";

const syncWriteSchema = z.object({ expected: z.string().regex(/^[a-f0-9]{64}$/).nullable(), next: pluginSyncSnapshotSchema, clientId: z.string() }).strict();
const workSyncWriteSchema = syncWriteSchema.extend({ next: workSyncRecordSchema });
const chatSyncWriteSchema = syncWriteSchema.extend({ next: chatSyncRecordSchema });
const chatDeletionSchema = z.object({ next: chatSyncRecordSchema, clientId: z.string() }).strict();

async function sendAsset(res: Response, asset: { handle: FileHandle; mime: string }) {
    try {
        if (res.destroyed) return;
        res.setHeader("Content-Type", asset.mime);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("Content-Disposition", "attachment");
        await pipeline(asset.handle.createReadStream({ start: 0 }), res);
    } catch (error) {
        if (!res.destroyed) throw error;
    } finally { await asset.handle.close(); }
}

function assetCollection(collection: string) {
    if (!["images", "previews", "media"].includes(collection) && !collection.startsWith("plugin-files:")) throw new StorageError("STORAGE_INVALID");
    return collection;
}

export function mountStorage(app: Express, storage: FsStorage) {
    app.post("/api/archive/install", async (req, res) => {
        const clientId = req.headers["x-canvas-client-id"];
        if (typeof clientId !== "string") throw new StorageError("STORAGE_INVALID");
        const bytes = await buffer(req);
        const install = decodeArchiveInstall(bytes);
        await storage.installArchive(install, clientId);
        res.json({ ok: true });
    });
    app.get("/api/storage-inspection", async (req, res) => {
        res.json(await storage.inspectUsage());
    });
    app.get("/api/storage-inspection/references", async (req, res) => {
        const parsed = archiveResourceSchema.safeParse(req.query);
        if (!parsed.success) throw new StorageError("STORAGE_INVALID");
        const controller = new AbortController();
        const close = () => controller.abort();
        res.once("close", close);
        try {
            const references = await storage.inspectReferences(parsed.data, controller.signal);
            if (!controller.signal.aborted) res.json(references);
        } catch (error) {
            if (!controller.signal.aborted) throw error;
        } finally { res.off("close", close); }
    });
    app.get("/api/storage-inspection/images/:key/preview", async (req, res) => {
        const preview = await storage.inspectImagePreview(req.params.key);
        res.setHeader("Cache-Control", "private, no-store");
        if (!preview) return void res.status(204).end();
        await sendAsset(res, preview);
    });
    app.post("/api/storage-inspection/cleanup", async (_req, res) => {
        res.json(await storage.cleanup());
    });
    app.post("/api/storage-inspection/open-folder", (_req, res) => {
        const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
        spawn(command, [storage.directory], { detached: true, stdio: "ignore" }).unref();
        res.status(204).end();
    });
    app.get("/api/storage-inspection/:collection", async (req, res) => {
        res.json(await storage.inspectEntries(req.params.collection));
    });
    app.use("/api/storage/:collection", (req, res, next) => {
        if (!publicStorageCollections.some((name) => name === req.params.collection) && !req.params.collection.startsWith("plugin:") && !req.params.collection.startsWith("plugin-files:")) throw new StorageError("STORAGE_INVALID");
        next();
    });
    app.get("/api/storage/:collection", async (req, res) => {
        res.json(await storage.list(req.params.collection));
    });
    app.get("/api/storage/:collection/:key", async (req, res) => {
        res.json(await storage.read(req.params.collection, req.params.key));
    });
    app.patch("/api/storage/library/state", express.json({ limit: "30mb" }), async (req, res) => {
        const clientId = req.get("x-canvas-client-id");
        if (typeof clientId !== "string") throw new StorageError("STORAGE_INVALID");
        await storage.editAssetLibrary(req.body, clientId);
        res.status(204).end();
    });
    app.post("/api/storage/works/:key", express.json({ limit: "30mb" }), async (req, res) => {
        const parsed = storageWriteSchema.safeParse(req.body);
        if (!parsed.success) throw new StorageError("STORAGE_INVALID");
        res.json(await storage.createWork(req.params.key, parsed.data.value, parsed.data.clientId));
    });
    app.post("/api/storage/works/:key/sync", express.json({ limit: "30mb" }), async (req, res) => {
        const parsed = workSyncWriteSchema.safeParse(req.body);
        if (!parsed.success) throw new StorageError("STORAGE_INVALID");
        const { expected, next, clientId } = parsed.data;
        res.json(await storage.compareWorkSync(req.params.key, expected, next, clientId));
    });
    app.post("/api/storage/chats/:key/sync", express.json({ limit: "30mb" }), async (req, res) => {
        const parsed = chatSyncWriteSchema.safeParse(req.body);
        if (!parsed.success) throw new StorageError("STORAGE_INVALID");
        const { expected, next, clientId } = parsed.data;
        res.json(Boolean(await storage.writeChat(req.params.key, next, clientId, expected)));
    });
    app.post("/api/storage/chats/:key/delete", express.json({ limit: "30mb" }), async (req, res) => {
        const parsed = chatDeletionSchema.safeParse(req.body);
        if (!parsed.success || parsed.data.next.thread !== null) throw new StorageError("STORAGE_INVALID");
        res.json(await storage.writeChat(req.params.key, parsed.data.next, parsed.data.clientId));
    });
    app.post("/api/storage/:collection/:domainId/sync", express.json({ limit: "30mb" }), async (req, res) => {
        const parsed = syncWriteSchema.safeParse(req.body);
        if (!req.params.collection.startsWith("plugin:") || !parsed.success) throw new StorageError("STORAGE_INVALID");
        const { expected, next, clientId } = parsed.data;
        res.json(await storage.comparePluginSyncData(req.params.collection.slice("plugin:".length), req.params.domainId, expected, next, clientId));
    });
    app.put("/api/storage/:collection/:key", express.json({ limit: "30mb" }), async (req, res) => {
        const parsed = storageWriteSchema.extend({ deletion: projectDeletionSchema.optional() }).safeParse(req.body);
        if (!parsed.success) throw new StorageError("STORAGE_INVALID");
        const { value, clientId, deletion } = parsed.data;
        if (deletion && (req.params.collection !== "projects" || value !== null)) throw new StorageError("STORAGE_INVALID");
        const record = deletion ? await storage.deleteProject(req.params.key, deletion, clientId)
            : await storage.save(req.params.collection, req.params.key, value, clientId);
        if (req.params.collection === "chats" && value !== null && req.get("prefer") === "return=minimal") {
            res.set("x-canvas-updated-at", (record.value as ArchiveThread).updatedAt).status(204).end();
        } else res.json(record);
    });
    app.delete("/api/storage/:collection/:key", async (req, res) => {
        const clientId = req.get("x-canvas-client-id");
        if (typeof clientId !== "string") throw new StorageError("STORAGE_INVALID");
        res.json(await storage.save(req.params.collection, req.params.key, null, clientId));
    });
    app.get("/api/assets/:collection/:key", async (req, res) => {
        const asset = await storage.openAsset(assetCollection(req.params.collection), req.params.key);
        if (!asset) return void res.sendStatus(404);
        await sendAsset(res, asset);
    });
    app.put("/api/assets/:collection/:key", async (req, res) => {
        const clientId = req.headers["x-canvas-client-id"];
        if (typeof clientId !== "string") throw new StorageError("STORAGE_INVALID");
        const mime = req.headers["content-type"] ?? "application/octet-stream";
        await storage.saveAsset(assetCollection(req.params.collection), req.params.key, req, mime, clientId);
        res.json({ key: req.params.key, value: { mime } });
    });
    app.delete("/api/assets/:collection/:key", async (req, res) => {
        const clientId = req.headers["x-canvas-client-id"];
        if (typeof clientId !== "string") throw new StorageError("STORAGE_INVALID");
        await storage.removeAsset(assetCollection(req.params.collection), req.params.key, clientId);
        res.status(204).end();
    });
}

export function watchStorage(socket: WebSocket, storage: FsStorage) {
    socket.send(JSON.stringify({ type: "ready", data: {} }));
    const unsubscribe = storage.subscribe((event) => {
        if (publicStorageCollections.some((name) => name === event.collection) || event.collection.startsWith("plugin:") || event.collection.startsWith("plugin-files:")) socket.send(JSON.stringify({ type: "change", data: event }));
    });
    socket.on("close", unsubscribe);
}
