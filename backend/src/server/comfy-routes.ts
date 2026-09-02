import path from "node:path";
import type { Request, Response } from "express";

import { type ResolvedConfig } from "../config.js";
import type { ComfyUiBackend } from "../comfyui/bridge.js";
import type { Stores } from "../stores/types.js";

/** ComfyUI Bridge 路由（总后台权威，Agent 变纯代理）。 */
export function registerComfyRoutes(ctx: { app: import("express").Express; stores: Stores; config: ResolvedConfig }, bridge: ComfyUiBackend) {
    const { app, stores, config } = ctx;

    app.get("/comfy/status", async (_req, res) => {
        res.json({ ok: true, ...(await bridge.status()) });
    });

    app.get("/comfy/models", async (_req, res) => {
        res.json({ ok: true, data: await bridge.models() });
    });

    /** 代理 ComfyUI 媒体预览（/view） */
    app.get("/comfy/media", async (req: Request, res: Response) => {
        const filename = String(req.query.filename || "");
        if (!filename || filename.includes("..") || filename.includes("\\")) return void res.status(400).json({ ok: false, error: "媒体文件名无效" });
        const query = new URLSearchParams({ filename, subfolder: String(req.query.subfolder || ""), type: String(req.query.type || "output") });
        const response = await fetch(`${bridge.getUrl()}/view?${query.toString()}`);
        if (!response.ok) return void res.status(response.status).end();
        const body = Buffer.from(await response.arrayBuffer());
        res.type(response.headers.get("content-type") || "application/octet-stream").send(body);
    });

    app.get("/comfy/config", (_req, res) => res.json({ ok: true, url: bridge.getUrl() }));
    app.put("/comfy/config", (req, res) => res.json({ ok: true, url: bridge.setUrl(String(req.body?.url || "")) }));
    app.get("/comfy/presets", (_req, res) => res.json({ ok: true, data: bridge.presets() }));

    app.post("/comfy/tasks", async (req, res) => {
        res.status(202).json({
            ok: true,
            task: await bridge.run(
                String(req.body?.preset || ""),
                objectBody(req.body?.input),
                objectBody(req.body?.params),
                typeof req.body?.comfyUrl === "string" ? req.body.comfyUrl : undefined,
            ),
        });
    });

    app.get("/comfy/tasks/:id", (req, res) => {
        const task = stores.tasks.get(req.params.id);
        if (!task || !task.kind.startsWith("comfyui:")) return void res.status(404).json({ ok: false, error: "task not found" });
        res.json({ ok: true, task, events: stores.tasks.events(req.params.id, Number(req.query.after || 0)) });
    });

    app.post("/comfy/tasks/:id/cancel", (req, res) => {
        res.json({ ok: true, task: bridge.cancel(req.params.id) });
    });

    /** ComfyUI 输出媒体落地到总后台 runtime-media（H3 分段合并结果等）。 */
    app.post("/comfy/materialize", async (req, res) => {
        const url = String(req.body?.url || "");
        const name = path.basename(String(req.body?.name || `materialized-${Date.now()}.mp4`));
        try {
            const source = new URL(url);
            const response = await fetch(`${bridge.getUrl()}/view${source.search || ""}`);
            if (!response.ok) return void res.status(502).json({ ok: false, error: `读取 ComfyUI 媒体失败：HTTP ${response.status}` });
            const data = Buffer.from(await response.arrayBuffer());
            const media = stores.media.storeNamed(name, data, "video/mp4");
            res.status(201).json({ ok: true, media: { name: media.name, path: media.path, bytes: media.bytes, url: media.url } });
        } catch (error) {
            res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    });
}

function objectBody(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
