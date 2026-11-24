import express, { Router, type Express } from "express";
import { z } from "zod";
import { PLUGIN_PACKAGE_MAX_BYTES, PluginError, pluginInstallSchema, pluginRegistrySchema } from "@infinite-canvas/shared/plugins";
import type { PluginManager } from "../plugins/manager.js";
import { logger } from "../utils/logger.js";
import { requestSignal } from "./request-signal.js";

export function mountPlugins(app: Express, manager: PluginManager) {
    const router = Router();
    router.get("/", async (_req, res) => { res.json(await manager.list()); });
    router.get("/local-directory", async (_req, res) => { res.json(await manager.localDirectoryPath()); });
    router.get("/config", async (_req, res) => { res.json(await manager.config()); });
    router.get("/index", async (_req, res) => { res.json(await manager.index()); });
    router.put("/config", async (req, res) => { await manager.configure(pluginRegistrySchema.parse(req.body)); res.json(null); });
    router.post("/install", async (req, res) => {
        res.json(await manager.install(pluginInstallSchema.parse(req.body), requestSignal(res)));
    });
    const packageBody = express.raw({ type: ["application/octet-stream", "application/gzip"], limit: PLUGIN_PACKAGE_MAX_BYTES });
    const packageBytes = (body: unknown) => {
        if (!Buffer.isBuffer(body) || !body.byteLength) throw new PluginError("PLUGIN_PACKAGE_INVALID");
        return body;
    };
    router.post("/package/inspect", packageBody, async (req, res) => { res.json(await manager.inspectPackage(packageBytes(req.body))); });
    router.post("/package", packageBody, async (req, res) => { res.json(await manager.installPackage(packageBytes(req.body), requestSignal(res))); });
    router.put("/:id/enabled", async (req, res) => {
        await manager.enable(req.params.id, z.object({ enabled: z.boolean() }).strict().parse(req.body).enabled);
        res.json(null);
    });
    router.delete("/:id", async (req, res) => { await manager.remove(req.params.id); res.json(null); });
    router.get("/:id/source", async (req, res) => { res.json(await manager.source(req.params.id, z.string().parse(req.query.version), z.string().regex(/^[a-f0-9]+$/).optional().parse(req.query.generation))); });
    router.get("/:id/assets/:kind", async (req, res) => { res.json(await manager.asset(req.params.id, z.string().parse(req.query.version), z.enum(["icon", "readme"]).parse(req.params.kind), z.string().regex(/^[a-f0-9]+$/).optional().parse(req.query.generation))); });
    router.get("/:id/files/:version/:generation/:instance/*path", async (req, res) => {
        res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
        z.string().uuid().parse(req.params.instance);
        const file = z.array(z.string()).parse(req.params.path).join("/");
        const target = await manager.readClientFile(req.params.id, req.params.version, z.string().regex(/^[a-f0-9]+$/).parse(req.params.generation), file);
        res.sendFile(target, { cacheControl: false, dotfiles: "allow" });
    });
    router.use((error: unknown, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
        logger.error("插件请求失败", { error });
        const tooLarge = (error as { type?: string } | null)?.type === "entity.too.large";
        const code = error instanceof PluginError ? error.code : tooLarge ? "PLUGIN_PACKAGE_TOO_LARGE" : "PLUGIN_OPERATION_FAILED";
        res.status(tooLarge ? 413 : code === "PLUGIN_NOT_FOUND" ? 404 : 400).json({ code });
    });
    app.use("/api/plugins", router);
}
