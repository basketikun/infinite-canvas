import express, { type NextFunction, type Request, type Response, type Express } from "express";
import path from "node:path";

import { type ResolvedConfig, ensureDataDirs } from "./config.js";
import type {
    Asset, AssetFolder, CanvasProject,
    GenerationLog, GenerationLogStatus, RuntimeTask, RuntimeTaskStatus,
} from "./db.js";
import type { ComfyUiBackend } from "./comfyui/bridge.js";
import { createLogger } from "./logger.js";
import { createStores } from "./stores/index.js";
import type { GenerationLogInput, LogDeleteScope, Stores } from "./stores/types.js";

const logger = createLogger("backend");

/** startServer 的可选依赖（comfy 路由由 index.ts 单独挂载）。 */
export type ServerDeps = {
    comfy?: ComfyUiBackend;
};

/** 启动总后台 HTTP 服务，返回 Express app（listen 由 index.ts 负责）。 */
export function startServer(db: Parameters<typeof createStores>[0], config: ResolvedConfig, deps: ServerDeps = {}) {
    const stores: Stores = createStores(db);
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "50mb" }));

    // ── CORS ─────────────────────────────────────────────────────────────
    app.use((req: Request, res: Response, next: NextFunction) => {
        const origins = config.origins ?? ["*"];
        const origin = req.headers.origin;
        if (origin && (origins.includes("*") || origins.includes(origin))) {
            res.setHeader("Access-Control-Allow-Origin", origin);
            res.setHeader("Access-Control-Allow-Credentials", "true");
            res.setHeader("Vary", "Origin");
        }
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        if (req.method === "OPTIONS") return void res.json({});
        next();
    });

    // ── Token 鉴权（/health 和 /config 免鉴权） ────────────────────────
    app.use((req: Request, res: Response, next: NextFunction) => {
        const url = req.url!.split("?")[0];
        if (url === "/health" || url === "/config") return next();
        const token = req.query.token as string | undefined
            || req.headers.authorization?.replace(/^Bearer\s+/i, "");
        if (token !== config.token) {
            return void res.status(401).json({ ok: false, error: "invalid token" });
        }
        next();
    });

    // ── 请求日志 ─────────────────────────────────────────────────────────
    app.use((req: Request, res: Response, next: NextFunction) => {
        const startedAt = Date.now();
        res.on("finish", () => {
            if (req.method === "OPTIONS" || res.statusCode < 400) return;
            logger.warn(`${req.method} ${req.url}`, { status: res.statusCode, durationMs: Date.now() - startedAt });
        });
        next();
    });

    // ── 错误处理 ─────────────────────────────────────────────────────────
    type HttpError = Error & { status?: number };
    app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
        const status = (error as HttpError).status || 500;
        logger.error(error.message, { stack: error.stack });
        res.status(status).json({ ok: false, error: error.message });
    });

    // ── 公共路由 ─────────────────────────────────────────────────────────
    app.get("/health", (_req, res) => {
        res.json({ ok: true, protocolVersion: 1, node: process.version, pid: process.pid });
    });
    app.get("/config", (_req, res) => {
        res.json({ ok: true, protocolVersion: 1, url: config.url, token: config.token, hasToken: true });
    });
    app.get("/runtime/status", async (_req, res) => {
        const extra: Record<string, unknown> = { sqlite: true, node: process.version };
        if (deps.comfy) extra.comfyui = await deps.comfy.status();
        res.json({ ok: true, ...extra });
    });

    // ── Canvas projects ──────────────────────────────────────────────────
    app.get("/canvas/projects", (_req, res) => {
        res.json({ ok: true, projects: stores.projects.list() });
    });
    app.put("/canvas/projects", (req, res) => {
        const body = req.body as { projects?: CanvasProject[] };
        const projects = Array.isArray(body.projects)
            ? body.projects.filter((p): p is CanvasProject => p && typeof p === "object" && !Array.isArray(p) && !!p.id)
            : [];
        res.json({ ok: true, projects: stores.projects.replaceAll(projects) });
    });
    app.post("/canvas/projects", (req, res) => {
        const project = req.body as CanvasProject;
        if (!project?.id) return void res.status(400).json({ ok: false, error: "project.id 必填" });
        res.status(201).json({ ok: true, project: stores.projects.upsert(project) });
    });
    app.delete("/canvas/projects/:id", (req, res) => {
        res.json({ ok: true, deleted: stores.projects.delete(req.params.id) });
    });

    // ── Assets ───────────────────────────────────────────────────────────
    app.get("/canvas/assets", (req, res) => {
        const kind = req.query.kind as string | undefined;
        const folderId = req.query.folderId as string | undefined;
        res.json({ ok: true, assets: stores.assets.list({ kind, folderId }), folders: stores.assets.folders() });
    });
    app.put("/canvas/assets", (req, res) => {
        const body = req.body as { assets?: Asset[]; folders?: AssetFolder[] };
        const assets = Array.isArray(body.assets)
            ? body.assets.filter((a): a is Asset => a && typeof a === "object" && !Array.isArray(a) && !!a.id)
            : [];
        const folders = Array.isArray(body.folders)
            ? body.folders.filter((f): f is AssetFolder => f && typeof f === "object" && !Array.isArray(f) && !!f.id)
            : [];
        stores.assets.replaceAll(assets, folders);
        res.json({ ok: true, assets: stores.assets.list(), folders: stores.assets.folders() });
    });
    app.post("/canvas/assets", (req, res) => {
        const asset = req.body as Asset;
        if (!asset?.id) return void res.status(400).json({ ok: false, error: "asset.id 必填" });
        res.status(201).json({ ok: true, asset: stores.assets.upsert(asset) });
    });
    app.patch("/canvas/assets/:id", (req, res) => {
        const current = stores.assets.get(req.params.id);
        if (!current) return void res.status(404).json({ ok: false, error: "asset not found" });
        const next = { ...current, ...(req.body as Partial<Asset>), id: current.id, updatedAt: new Date().toISOString() };
        res.json({ ok: true, asset: stores.assets.upsert(next) });
    });
    app.delete("/canvas/assets/:id", (req, res) => {
        res.json({ ok: true, deleted: stores.assets.delete(req.params.id) });
    });

    // ── Asset folders ────────────────────────────────────────────────────
    app.post("/canvas/assets/folders", (req, res) => {
        const folder = req.body as AssetFolder;
        if (!folder?.id) return void res.status(400).json({ ok: false, error: "folder.id 必填" });
        res.status(201).json({ ok: true, folder: stores.assets.upsertFolder(folder) });
    });
    app.delete("/canvas/assets/folders/:id", (req, res) => {
        res.json({ ok: true, deleted: stores.assets.deleteFolder(req.params.id) });
    });

    // ── Media ────────────────────────────────────────────────────────────
    /** 上传媒体（base64 dataUrl，Backend media_files 为唯一业务媒体存储） */
    app.post("/media/upload", (req, res) => {
        const body = req.body as { name?: string; dataUrl?: string; storageKey?: string; width?: number; height?: number; durationMs?: number };
        if (!body.dataUrl) return void res.status(400).json({ ok: false, error: "需要提供 dataUrl（base64 data URL）" });
        try {
            const media = stores.media.storeDataUrl(String(body.dataUrl), body.name || "media.bin", {
                storageKey: body.storageKey,
                width: body.width ?? null, height: body.height ?? null, durationMs: body.durationMs ?? null,
            });
            res.status(201).json({
                ok: true,
                media: {
                    storageKey: media.storageKey,
                    url: stores.media.url(media),
                    mimeType: media.mimeType,
                    bytes: media.bytes,
                    width: media.width,
                    height: media.height,
                    durationMs: media.durationMs,
                },
            });
        } catch (error) {
            res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    });

    /** 代理读取媒体文件 */
    app.get("/media/:storageKey", async (req, res) => {
        const storageKey = decodeURIComponent(req.params.storageKey);
        const media = stores.media.meta(storageKey);
        if (!media) return void res.status(404).json({ ok: false, error: "media not found" });
        try {
            const data = await stores.media.read(storageKey);
            res.setHeader("Cache-Control", "private, max-age=3600");
            res.setHeader("Content-Type", media.mimeType);
            res.setHeader("Content-Length", String(data.length));
            res.send(data);
        } catch {
            res.status(404).json({ ok: false, error: "媒体文件丢失" });
        }
    });

    /** 删除媒体文件 */
    app.delete("/media/:storageKey", (req, res) => {
        const storageKey = decodeURIComponent(req.params.storageKey);
        if (!stores.media.meta(storageKey)) return void res.status(404).json({ ok: false, error: "media not found" });
        res.json({ ok: true, deleted: stores.media.delete(storageKey) });
    });

    // ── runtime media（H3 ref 落地 / 兼容旧 Agent /runtime/media*） ──────
    app.post("/runtime/media", (req, res) => {
        const name = String(req.body?.name || "media.bin");
        const dataUrl = String(req.body?.dataUrl || "");
        try {
            const media = stores.media.storeDataUrl(dataUrl, name);
            res.status(201).json({ ok: true, media: { id: media.storageKey, path: media.path, name: path.basename(name), mimeType: media.mimeType, bytes: media.bytes, url: stores.media.url(media) } });
        } catch (error) {
            res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    });
    app.get("/runtime/media-file", (req, res) => {
        try {
            const name = String(req.query.name || req.query.file || "");
            const data = stores.media.readNamed(name);
            res.setHeader("Cache-Control", "private, max-age=3600");
            res.type("application/octet-stream").send(data);
        } catch (error) {
            res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    });

    // ── Generation logs ──────────────────────────────────────────────────
    app.get("/generation-logs", (req, res) => {
        const projectId = req.query.projectId as string | undefined;
        const nodeId = req.query.nodeId as string | undefined;
        const status = ["queued", "running", "success", "failed", "cancelled"].includes(req.query.status as string)
            ? req.query.status as GenerationLogStatus : undefined;
        const limit = Number(req.query.limit || 500);
        res.json({ ok: true, logs: stores.logs.list({ projectId, nodeId, status, limit }) });
    });
    app.post("/generation-logs", (req, res) => {
        const body = req.body as GenerationLogInput;
        if (!body.projectId || !body.platform || !body.startedAt) {
            return void res.status(400).json({ ok: false, error: "projectId、platform、startedAt 为必填项" });
        }
        res.status(201).json({ ok: true, log: stores.logs.create(body) });
    });
    app.patch("/generation-logs/:id", (req, res) => {
        try {
            res.json({ ok: true, log: stores.logs.update(req.params.id, req.body) });
        } catch (error) {
            res.status(404).json({ ok: false, error: (error as Error).message });
        }
    });
    app.delete("/generation-logs", (req, res) => {
        const options: LogDeleteScope = {};
        if (req.query.id) options.id = String(req.query.id);
        if (req.query.projectId) options.projectId = String(req.query.projectId);
        if (req.query.nodeId) options.nodeId = String(req.query.nodeId);
        if (!options.id && !options.projectId && !options.nodeId) {
            return void res.status(400).json({ ok: false, error: "删除日志必须指定范围" });
        }
        res.json({ ok: true, deleted: stores.logs.delete(options) });
    });
    app.delete("/generation-logs/:id", (req, res) => {
        res.json({ ok: true, deleted: stores.logs.delete({ id: req.params.id }) });
    });

    // ── Tasks ────────────────────────────────────────────────────────────
    app.get("/tasks/:id", (req, res) => {
        const task = stores.tasks.get(req.params.id);
        if (!task) return void res.status(404).json({ ok: false, error: "task not found" });
        res.json({ ok: true, task, events: stores.tasks.events(req.params.id, Number(req.query.after || 0)) });
    });
    app.post("/tasks", (req, res) => {
        const body = req.body as { kind?: string; input?: Record<string, unknown>; params?: Record<string, unknown> };
        if (!body.kind) return void res.status(400).json({ ok: false, error: "kind 必填" });
        res.status(201).json({ ok: true, task: stores.tasks.create(body.kind, body.input || {}, body.params || {}) });
    });
    app.patch("/tasks/:id", (req, res) => {
        const patch = req.body as { status?: RuntimeTaskStatus; progress?: number; result?: Record<string, unknown> | null; error?: string | null };
        try {
            res.json({ ok: true, task: stores.tasks.update(req.params.id, patch) });
        } catch (error) {
            res.status(404).json({ ok: false, error: (error as Error).message });
        }
    });
    app.post("/tasks/:id/cancel", (req, res) => {
        try {
            res.json({ ok: true, task: stores.tasks.cancel(req.params.id) });
        } catch (error) {
            res.status(409).json({ ok: false, error: (error as Error).message });
        }
    });

    return { app: app as Express, stores };
}
