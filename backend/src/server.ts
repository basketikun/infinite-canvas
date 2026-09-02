import crypto from "node:crypto";
import fs from "node:fs";
import { readFile, mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";

import { type ResolvedConfig, MEDIA_DIR, ensureDataDirs } from "./config.js";
import {
    BackendDatabase,
    type Asset, type AssetFolder, type CanvasProject,
    type GenerationLog, type GenerationLogStatus, type MediaFile,
    type RuntimeTask, type RuntimeTaskStatus,
} from "./db.js";
import { createLogger } from "./logger.js";

const logger = createLogger("backend");
const MAX_MEDIA_BYTES = 200 * 1024 * 1024; // 200 MB

/** 启动总后台 HTTP 服务。 */
export function startServer(config: ResolvedConfig, db: BackendDatabase) {
    ensureDataDirs();
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
    function httpError(status: number, message: string): HttpError {
        return Object.assign(new Error(message), { status });
    }
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
        res.json({ ok: true, protocolVersion: 1, url: config.url, hasToken: true });
    });

    // ── Runtime status ───────────────────────────────────────────────────

    app.get("/runtime/status", (_req, res) => {
        res.json({ ok: true, sqlite: true, node: process.version });
    });

    // ── Canvas projects ──────────────────────────────────────────────────

    app.get("/canvas/projects", (_req, res) => {
        res.json({ ok: true, projects: db.listCanvasProjects() });
    });

    app.put("/canvas/projects", (req, res) => {
        const body = req.body as { projects?: CanvasProject[] };
        const projects = Array.isArray(body.projects)
            ? body.projects.filter((p): p is CanvasProject => p && typeof p === "object" && !Array.isArray(p) && !!p.id)
            : [];
        res.json({ ok: true, projects: db.replaceCanvasProjects(projects) });
    });

    app.post("/canvas/projects", (req, res) => {
        const project = req.body as CanvasProject;
        if (!project?.id) return void res.status(400).json({ ok: false, error: "project.id 必填" });
        res.status(201).json({ ok: true, project: db.upsertCanvasProject(project) });
    });

    app.delete("/canvas/projects/:id", (req, res) => {
        const deleted = db.deleteCanvasProject(req.params.id);
        res.json({ ok: true, deleted });
    });

    // ── Assets ───────────────────────────────────────────────────────────

    app.get("/canvas/assets", (req, res) => {
        const kind = req.query.kind as string | undefined;
        const folderId = req.query.folderId as string | undefined;
        res.json({ ok: true, assets: db.listAssets({ kind, folderId }), folders: db.listAssetFolders() });
    });

    app.put("/canvas/assets", (req, res) => {
        const body = req.body as { assets?: Asset[]; folders?: AssetFolder[] };
        const assets = Array.isArray(body.assets)
            ? body.assets.filter((a): a is Asset => a && typeof a === "object" && !Array.isArray(a) && !!a.id)
            : [];
        const folders = Array.isArray(body.folders)
            ? body.folders.filter((f): f is AssetFolder => f && typeof f === "object" && !Array.isArray(f) && !!f.id)
            : [];
        db.replaceAssets(assets, folders);
        res.json({ ok: true, assets: db.listAssets(), folders: db.listAssetFolders() });
    });

    app.post("/canvas/assets", (req, res) => {
        const asset = req.body as Asset;
        if (!asset?.id) return void res.status(400).json({ ok: false, error: "asset.id 必填" });
        res.status(201).json({ ok: true, asset: db.upsertAsset(asset) });
    });

    app.patch("/canvas/assets/:id", (req, res) => {
        const current = db.getAsset(req.params.id);
        if (!current) return void res.status(404).json({ ok: false, error: "asset not found" });
        const next = { ...current, ...(req.body as Partial<Asset>), id: current.id, updatedAt: new Date().toISOString() };
        res.json({ ok: true, asset: db.upsertAsset(next) });
    });

    app.delete("/canvas/assets/:id", (req, res) => {
        const deleted = db.deleteAsset(req.params.id);
        res.json({ ok: true, deleted });
    });

    // ── Asset folders ────────────────────────────────────────────────────

    app.post("/canvas/assets/folders", (req, res) => {
        const folder = req.body as AssetFolder;
        if (!folder?.id) return void res.status(400).json({ ok: false, error: "folder.id 必填" });
        db.upsertAssetFolder(folder);
        res.status(201).json({ ok: true, folder });
    });

    app.delete("/canvas/assets/folders/:id", (req, res) => {
        const deleted = db.deleteAssetFolder(req.params.id);
        res.json({ ok: true, deleted });
    });

    // ── Media ────────────────────────────────────────────────────────────

    /** 上传媒体（二进制请求体或 base64） */
    app.post("/media/upload", async (req, res) => {
        const body = req.body as {
            name?: string; dataUrl?: string;
            mimeType?: string; width?: number; height?: number; durationMs?: number;
        };
        const name = body.name || `media-${Date.now()}.bin`;
        let data: Buffer;
        let mimeType: string;

        if (body.dataUrl) {
            // base64 路径（兼容旧 Agent）
            const match = /^data:([^;,]+);base64,(.+)$/s.exec(String(body.dataUrl).trim());
            if (!match) throw httpError(400, "dataUrl 必须是 base64 data URL");
            data = Buffer.from(match[2], "base64");
            mimeType = match[1];
        } else if (Buffer.isBuffer(req.body)) {
            data = req.body;
            mimeType = body.mimeType || req.headers["content-type"] || "application/octet-stream";
        } else {
            // 尝试从 raw body 读取
            throw httpError(400, "需要提供 dataUrl 或二进制 body");
        }

        if (!data.length) throw httpError(400, "媒体为空");
        if (data.length > MAX_MEDIA_BYTES) throw httpError(400, "媒体超过 200 MB 限制");

        const storageKey = `${body.mimeType?.startsWith("image/") ? "image" : body.mimeType?.startsWith("video/") ? "video" : body.mimeType?.startsWith("audio/") ? "audio" : "file"}:${crypto.randomUUID()}`;
        const extension = path.extname(name).replace(/[^a-z0-9.]/gi, "").slice(0, 12)
            || extensionForMime(mimeType);
        const fileName = path.basename(name) || `${storageKey.replace(":", "-")}${extension}`;
        // 用 storageKey 哈希做文件名，避免路径问题
        const id = crypto.randomUUID();
        const filePath = path.join(MEDIA_DIR, `${id}${extension}`);
        await mkdir(MEDIA_DIR, { recursive: true, mode: 0o700 });
        await writeFile(filePath, data, { mode: 0o600 });

        const media: MediaFile = {
            storageKey,
            filePath,
            mimeType,
            bytes: data.length,
            width: body.width ?? null,
            height: body.height ?? null,
            durationMs: body.durationMs ?? null,
            createdAt: new Date().toISOString(),
        };
        db.upsertMediaFile(media);

        res.status(201).json({
            ok: true,
            media: {
                storageKey,
                url: `/media/${encodeURIComponent(storageKey)}`,
                mimeType,
                bytes: data.length,
                width: media.width,
                height: media.height,
                durationMs: media.durationMs,
            },
        });
    });

    /** 代理读取媒体文件 */
    app.get("/media/:storageKey", async (req, res) => {
        const storageKey = decodeURIComponent(req.params.storageKey);
        const media = db.getMediaFile(storageKey);
        if (!media) return void res.status(404).json({ ok: false, error: "media not found" });
        try {
            const data = await readFile(media.filePath);
            res.setHeader("Cache-Control", "private, max-age=3600");
            res.setHeader("Content-Type", media.mimeType);
            res.setHeader("Content-Length", String(data.length));
            res.send(data);
        } catch {
            res.status(404).json({ ok: false, error: "媒体文件丢失" });
        }
    });

    /** 删除媒体文件 */
    app.delete("/media/:storageKey", async (req, res) => {
        const storageKey = decodeURIComponent(req.params.storageKey);
        const media = db.getMediaFile(storageKey);
        if (!media) return void res.status(404).json({ ok: false, error: "media not found" });
        db.deleteMediaFile(storageKey);
        try { await unlink(media.filePath); } catch { /* file may be gone */ }
        res.json({ ok: true, deleted: 1 });
    });

    // ── Generation logs ──────────────────────────────────────────────────

    app.get("/generation-logs", (req, res) => {
        const projectId = req.query.projectId as string | undefined;
        const nodeId = req.query.nodeId as string | undefined;
        const status = ["queued", "running", "success", "failed", "cancelled"].includes(req.query.status as string)
            ? req.query.status as GenerationLogStatus : undefined;
        const limit = Number(req.query.limit || 500);
        res.json({ ok: true, logs: db.listGenerationLogs({ projectId, nodeId, status, limit }) });
    });

    app.post("/generation-logs", (req, res) => {
        const body = req.body as Omit<GenerationLog, "id" | "createdAt" | "updatedAt">;
        if (!body.projectId || !body.platform || !body.startedAt) {
            return void res.status(400).json({ ok: false, error: "projectId、platform、startedAt 为必填项" });
        }
        res.status(201).json({ ok: true, log: db.createGenerationLog(body) });
    });

    app.patch("/generation-logs/:id", (req, res) => {
        try {
            const log = db.updateGenerationLog(req.params.id, req.body);
            res.json({ ok: true, log });
        } catch (error) {
            res.status(404).json({ ok: false, error: (error as Error).message });
        }
    });

    app.delete("/generation-logs/:id", (req, res) => {
        const deleted = db.deleteGenerationLogs({ id: req.params.id });
        res.json({ ok: true, deleted });
    });

    // 批量删除（按范围）
    app.delete("/generation-logs", (req, res) => {
        const options: { id?: string; projectId?: string; nodeId?: string } = {};
        if (req.query.id) options.id = String(req.query.id);
        if (req.query.projectId) options.projectId = String(req.query.projectId);
        if (req.query.nodeId) options.nodeId = String(req.query.nodeId);
        if (!options.id && !options.projectId && !options.nodeId) {
            return void res.status(400).json({ ok: false, error: "删除日志必须指定范围" });
        }
        res.json({ ok: true, deleted: db.deleteGenerationLogs(options) });
    });

    // ── Tasks ────────────────────────────────────────────────────────────

    app.get("/tasks/:id", (req, res) => {
        const task = db.getTask(req.params.id);
        if (!task) return void res.status(404).json({ ok: false, error: "task not found" });
        const events = db.listTaskEvents(req.params.id, Number(req.query.after || 0));
        res.json({ ok: true, task, events });
    });

    app.post("/tasks/:id/cancel", (req, res) => {
        const task = db.getTask(req.params.id);
        if (!task) return void res.status(404).json({ ok: false, error: "task not found" });
        if (task.status !== "queued" && task.status !== "running") {
            return void res.status(409).json({ ok: false, error: `任务状态 ${task.status} 不可取消` });
        }
        const updated = db.updateTask(req.params.id, { status: "cancelled" });
        db.addTaskEvent(req.params.id, "cancelled", { taskId: req.params.id });
        res.json({ ok: true, task: updated });
    });

    /** 创建任务（供 Agent / Worker 调用） */
    app.post("/tasks", (req, res) => {
        const body = req.body as { kind?: string; input?: Record<string, unknown>; params?: Record<string, unknown> };
        if (!body.kind) return void res.status(400).json({ ok: false, error: "kind 必填" });
        const task = db.createTask(body.kind, body.input || {}, body.params || {});
        res.status(201).json({ ok: true, task });
    });

    /** 更新任务状态 */
    app.patch("/tasks/:id", (req, res) => {
        const patch = req.body as { status?: RuntimeTaskStatus; progress?: number; result?: Record<string, unknown> | null; error?: string | null };
        try {
            const task = db.updateTask(req.params.id, patch);
            if (patch.status) db.addTaskEvent(req.params.id, `status:${patch.status}`, { taskId: req.params.id, status: patch.status });
            res.json({ ok: true, task });
        } catch (error) {
            res.status(404).json({ ok: false, error: (error as Error).message });
        }
    });

    // ── 启动 ─────────────────────────────────────────────────────────────

    const server = app.listen(config.port, "127.0.0.1", () => {
        logger.info(`总后台已启动 http://127.0.0.1:${config.port}`, { pid: process.pid });
    });

    // 优雅关闭
    const shutdown = (signal: string) => {
        logger.info(`${signal} received, shutting down…`);
        server.close(() => {
            db.close();
            process.exit(0);
        });
        setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    return server;
}

function extensionForMime(mime: string): string {
    if (mime.includes("png")) return ".png";
    if (mime.includes("jpeg")) return ".jpg";
    if (mime.includes("webp")) return ".webp";
    if (mime.includes("mp4")) return ".mp4";
    if (mime.includes("webm")) return ".webm";
    if (mime.includes("audio")) return ".mp3";
    if (mime.includes("pdf")) return ".pdf";
    return ".bin";
}
