import { ModelTasks } from "../models/tasks.js";
import type { PluginManager } from "../plugins/manager.js";
import { mountPlugins } from "./plugins.js";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import { StorageError } from "@infinite-canvas/shared/storage-data";
import type { FsStorage } from "../storage/fs-storage.js";
import { mountStorage, watchStorage } from "./storage.js";
import { mountModels } from "./models.js";
import { requestSignal } from "./request-signal.js";
import { mountNetwork } from "./network.js";
import { mountWorkspaceConfig } from "./workspace-config.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { AGENT_PROTOCOL_VERSION, CanvasSession } from "../canvas/session.js";
import { type ServerConfig } from "../config.js";
import { logger } from "../utils/logger.js";
import { createCanvasMcpServer } from "./mcp.js";
import { canvasToolError } from "@infinite-canvas/shared/canvas/tools/errors";

export function createCanvasHttpApp(config: ServerConfig, session: CanvasSession, options?: { storage: FsStorage; tasks?: ModelTasks; web?: RequestHandler; plugins?: PluginManager }) {
    const app = express();
    app.disable("x-powered-by");
    app.use((req, res, next) => {
        if (!["127.0.0.1", "localhost", "[::1]"].includes(req.hostname)) return void res.sendStatus(403);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        const origin = req.headers.origin;
        const sameOrigin = !origin || origin === `http://${req.headers.host}`;
        const storageRequest = /^\/api\/(?:archive|storage|storage-inspection|assets|models|channels|network|workspace-config|plugins)(?:\/|$)/i.test(req.path);
        if (storageRequest && !sameOrigin) return void res.sendStatus(403);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "content-type,x-canvas-client-id,x-canvas-project-id,mcp-protocol-version,mcp-session-id");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
        res.setHeader("Access-Control-Allow-Private-Network", "true");
        if (origin && !storageRequest) res.setHeader("Access-Control-Allow-Origin", origin);
        if (req.method === "OPTIONS" && (req.headers["access-control-request-method"] || !/^\/api\/network\/sync\/?$/i.test(req.path))) return void res.sendStatus(204);
        const protectedRoute = storageRequest || /^\/(?:mcp|api\/tools(?:\/list)?)\/?$/i.test(req.path) || ["/canvas/state", "/canvas/activate", "/canvas/result"].includes(req.path) && req.method === "POST";
        if (protectedRoute && !sameOrigin) return void res.sendStatus(403);
        next();
    });
    if (options) mountStorage(app, options.storage);
    if (options) mountNetwork(app);
    app.use(["/api/models", "/api/channels", "/api/workspace-config"], express.json({ limit: Infinity }));
    app.use(express.json({ limit: "30mb" }));
    if (options?.plugins) mountPlugins(app, options.plugins);
    if (options) mountModels(app, options.storage, options.tasks ?? new ModelTasks(options.storage));
    if (options) mountWorkspaceConfig(app, options.storage);
    app.get("/health", (_req, res) => res.json(session.health()));
    app.get("/config", (_req, res) => res.json({ ok: true, protocolVersion: AGENT_PROTOCOL_VERSION, url: config.url, mcp: config.mcp }));
    app.post("/canvas/state", (req, res) => {
        session.updateState(req.query.clientId as string, req.body.snapshot, req.body.pluginTools === true);
        res.json({ ok: true });
    });
    app.post("/canvas/activate", (req, res) => {
        session.activateClient(req.query.clientId as string);
        res.json({ ok: true });
    });
    app.post("/canvas/result", (req, res) => {
        const ok = session.resolveResult(req.query.clientId as string, req.body);
        res.status(ok ? 200 : 409).json({ ok });
    });
    app.post("/api/tools/list", async (req, res) => {
        res.json({ ok: true, result: await session.listPluginTools(req.body.clientId, req.body.projectId, requestSignal(res)) });
    });
    app.post("/api/tools", async (req, res) => {
        res.json({ ok: true, result: await session.callTool(req.body.name, req.body.input, req.body.clientId, req.body.projectId, requestSignal(res)) });
    });
    app.post("/mcp", async (req, res) => {
        const targetClientId = req.headers["x-canvas-client-id"] as string | undefined;
        const projectId = req.headers["x-canvas-project-id"] as string | undefined;
        const connection = requestSignal(res);
        const server = createCanvasMcpServer(
            (name, input, clientId, requestedProjectId, signal) => session.callTool(name, input, targetClientId ?? clientId, projectId ?? requestedProjectId, signal ? AbortSignal.any([connection, signal]) : connection),
            signal => session.listPluginTools(targetClientId, projectId, AbortSignal.any([connection, signal])),
        );
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on("close", () => { void transport.close(); void server.close(); });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    });
    app.get("/mcp", (_req, res) => res.sendStatus(405));
    app.delete("/mcp", (_req, res) => res.sendStatus(405));
    if (options?.web) {
        const web = options.web;
        app.use((req, res, next) => req.path === "/api" || req.path.startsWith("/api/") ? next() : web(req, res, next));
    }
    app.use((_req, res) => res.status(404).json({ ok: false, error: "该操作不存在。" }));
    app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
        logger.error("Canvas MCP request failed", { path: req.path, name: req.body?.name, clientId: req.body?.clientId, error });
        if (error instanceof StorageError) return void res.status(400).json({ ok: false, error: { code: error.code, message: error.message } });
        res.status(500).json({ ok: false, error: /^\/api\/(?:archive|storage|storage-inspection|assets)(?:\/|$)/i.test(req.path) ? { code: "STORAGE_UNAVAILABLE", message: new StorageError("STORAGE_UNAVAILABLE").message } : canvasToolError(error) });
    });
    return app;
}

// 推送改用 WebSocket：浏览器对同一地址最多 6 个普通连接，长连接会让多开的页面卡住，WebSocket 不占这部分名额。
export function mountEventSockets(http: Server, session: CanvasSession, storage: FsStorage) {
    const sockets = new WebSocketServer({ noServer: true });
    http.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url!, "http://127.0.0.1");
        if (url.pathname !== "/events" && url.pathname !== "/api/storage/events") return;
        // WebSocket 不受浏览器跨域限制，必须只接受本机地址和同源页面。
        if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(`http://${req.headers.host}`).hostname) || req.headers.origin !== `http://${req.headers.host}`) return void socket.destroy();
        sockets.handleUpgrade(req, socket, head, (client) => {
            if (url.pathname === "/api/storage/events") return watchStorage(client, storage);
            const clientId = url.searchParams.get("clientId");
            if (!clientId) return void client.close(1008);
            session.openEvents(clientId, client);
        });
    });
}
