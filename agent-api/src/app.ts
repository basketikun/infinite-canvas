import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";

import { SupabaseAuth, type AuthenticatedRequest } from "./auth.js";
import { CanvasBridge } from "./canvas-bridge.js";
import type { AppConfig } from "./config.js";
import { CodexRuntimeAdapter } from "./codex/runtime.js";
import { AppError } from "./errors.js";
import { EventHub } from "./event-hub.js";
import { PiRuntimeAdapter } from "./pi-runtime.js";
import { ConversationModule, ProjectModule, requiredText } from "./project-module.js";
import type { RuntimeAdapter } from "./runtime.js";
import { RuntimeManager } from "./runtime-manager.js";
import { RuntimeTokenService } from "./runtime-token.js";
import { SupabaseResearchStore } from "./supabase-store.js";
import { AGENT_PROTOCOL_VERSION, type JsonObject, type RuntimeEvent } from "./types.js";

export function createApp(config: AppConfig, deps: { canvas?: CanvasBridge; adapter?: RuntimeAdapter } = {}) {
    const app = express();
    const auth = new SupabaseAuth(config.supabaseUrl, config.supabasePublishableKey);
    const hub = new EventHub();
    const canvas = deps.canvas || new CanvasBridge();
    const adapter = deps.adapter || createRuntimeAdapter(config, canvas);
    const runtime = new RuntimeManager(adapter, hub);
    const codex = adapter instanceof CodexRuntimeAdapter ? adapter : null;

    app.use(cors({ origin: (origin, callback) => callback(null, !origin || config.origins.includes(origin)) }));
    app.use(express.json());
    app.get("/health", (_request, response) => response.json({ ok: true, runtime: config.runtime }));

    app.post("/internal/runtime/canvas/read", asyncRoute(async (request, response) => {
        if (!codex) throw new AppError("当前运行时不是 Codex", 409, "runtime_not_codex");
        const snapshot = await codex.readCanvas(runtimeToken(request));
        response.json(snapshot);
    }));
    app.post("/internal/runtime/canvas/apply", asyncRoute(async (request, response) => {
        if (!codex) throw new AppError("当前运行时不是 Codex", 409, "runtime_not_codex");
        const operations = Array.isArray(request.body?.operations) ? request.body.operations : [];
        const summary = requiredText(request.body?.summary, "缺少画布修改说明");
        const result = await codex.applyCanvas(runtimeToken(request), operations, summary);
        response.json({ result });
    }));

    app.use(asyncRoute(async (request, response, next) => {
        response.locals.auth = await auth.authenticate(request.header("authorization"));
        next();
    }));

    app.post("/v1/projects", asyncRoute(async (request, response) => {
        const scope = requestScope(response);
        response.status(201).json(await scope.projects.create(scope.auth.userId, request.body || {}));
    }));
    app.get("/v1/projects", asyncRoute(async (_request, response) => {
        const scope = requestScope(response);
        response.json(await scope.projects.listMine(scope.auth.userId));
    }));
    app.get("/v1/projects/:projectId", asyncRoute(async (request, response) => {
        const scope = requestScope(response);
        response.json(await scope.projects.readOwned(scope.auth.userId, request.params.projectId));
    }));
    app.delete("/v1/projects/:projectId", asyncRoute(async (request, response) => {
        const scope = requestScope(response);
        try {
            await scope.projects.deleteOwned(scope.auth.userId, request.params.projectId);
        } catch (error) {
            if (!(error instanceof AppError) || error.code !== "project_not_found") throw error;
        }
        response.status(204).end();
    }));

    app.get("/v1/projects/:projectId/canvas", asyncRoute(async (request, response) => {
        const scope = requestScope(response);
        const ctx = await scope.projects.context(scope.auth.userId, request.params.projectId);
        response.json(await scope.store.readCanvas(ctx));
    }));
    app.put("/v1/projects/:projectId/canvas/state", publishCanvas(canvas));
    app.post("/v1/projects/:projectId/canvas/snapshot", publishCanvas(canvas));
    app.post("/v1/projects/:projectId/canvas/tool-results/:requestId", completeCanvasTool(canvas));
    app.post("/v1/projects/:projectId/canvas/tool-results", completeCanvasTool(canvas));

    app.post("/v1/projects/:projectId/conversations", asyncRoute(async (request, response) => {
        const scope = requestScope(response);
        const ctx = await scope.projects.context(scope.auth.userId, request.params.projectId);
        response.status(201).json(await scope.conversations.create(ctx, request.body || {}));
    }));
    app.get("/v1/projects/:projectId/conversations", asyncRoute(async (request, response) => {
        const scope = requestScope(response);
        const ctx = await scope.projects.context(scope.auth.userId, request.params.projectId);
        response.json(await scope.conversations.list(ctx));
    }));
    app.get("/v1/projects/:projectId/conversations/:conversationId", asyncRoute(async (request, response) => {
        const scope = requestScope(response);
        const ctx = await scope.projects.context(scope.auth.userId, request.params.projectId);
        const conversation = await scope.conversations.read(ctx, request.params.conversationId);
        response.json({ conversation, events: await scope.store.listEvents(ctx, request.params.conversationId, 0) });
    }));
    app.post("/v1/projects/:projectId/conversations/:conversationId/archive", asyncRoute(async (request, response) => {
        const scope = requestScope(response);
        const ctx = await scope.projects.context(scope.auth.userId, request.params.projectId);
        await scope.conversations.archive(ctx, request.params.conversationId);
        response.status(204).end();
    }));
    app.post("/v1/projects/:projectId/conversations/:conversationId/turns", asyncRoute(async (request, response) => {
        const scope = requestScope(response);
        const ctx = await scope.projects.context(scope.auth.userId, request.params.projectId);
        const result = await runtime.runTurn(scope.store, ctx, { conversationId: request.params.conversationId, prompt: requiredText(request.body?.prompt, "消息不能为空") });
        response.status(202).json(result);
    }));
    app.post("/v1/projects/:projectId/conversations/:conversationId/runs/:runId/abort", asyncRoute(async (request, response) => {
        const scope = requestScope(response);
        const ctx = await scope.projects.context(scope.auth.userId, request.params.projectId);
        await runtime.abort(scope.store, ctx, request.params.conversationId, request.params.runId);
        response.status(202).json({ runId: request.params.runId, abortRequested: true });
    }));
    app.get("/v1/projects/:projectId/conversations/:conversationId/events", asyncRoute(async (request, response) => {
        const scope = requestScope(response);
        const ctx = await scope.projects.context(scope.auth.userId, request.params.projectId);
        await scope.conversations.read(ctx, request.params.conversationId);
        const after = optionalNonNegativeInteger(request.query.after);
        response.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Agent-Protocol-Version": String(AGENT_PROTOCOL_VERSION) });
        response.flushHeaders();
        let cursor = after;
        let loading = true;
        const buffered: RuntimeEvent[] = [];
        const unsubscribe = hub.subscribe(request.params.conversationId, (event) => {
            if (event.projectId !== ctx.projectId || event.sequence <= cursor) return;
            if (loading) buffered.push(event);
            else {
                writeSse(response, event);
                cursor = event.sequence;
            }
        });
        request.on("close", unsubscribe);
        for (const event of await scope.store.listEvents(ctx, request.params.conversationId, cursor)) {
            writeSse(response, event);
            cursor = event.sequence;
        }
        loading = false;
        for (const event of buffered.sort((left, right) => left.sequence - right.sequence)) {
            if (event.sequence <= cursor) continue;
            writeSse(response, event);
            cursor = event.sequence;
        }
    }));

    app.get("/v1/projects/:projectId/skills", asyncRoute(async (request, response) => {
        const scope = requestScope(response);
        const ctx = await scope.projects.context(scope.auth.userId, request.params.projectId);
        response.json(await scope.store.listSkills(ctx));
    }));
    app.put("/v1/projects/:projectId/skills/:name", asyncRoute(async (request, response) => {
        const scope = requestScope(response);
        const ctx = await scope.projects.context(scope.auth.userId, request.params.projectId);
        response.json(await scope.store.saveSkill(ctx, {
            name: requiredText(request.params.name, "Skill 名称不能为空"),
            definition: requiredText(request.body?.definition, "Skill 内容不能为空"),
            enabled: request.body?.enabled !== false,
        }));
    }));
    app.delete("/v1/projects/:projectId/skills/:name", asyncRoute(async (request, response) => {
        const scope = requestScope(response);
        const ctx = await scope.projects.context(scope.auth.userId, request.params.projectId);
        await scope.store.deleteSkill(ctx, request.params.name);
        response.status(204).end();
    }));

    app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
        const status = error instanceof AppError ? error.statusCode : 500;
        response.status(status).json({ error: { code: error instanceof AppError ? error.code : "internal_error", message: error instanceof AppError ? error.message : "Agent API 内部错误" } });
    });
    return app;
}

function createRuntimeAdapter(config: AppConfig, canvas: CanvasBridge): RuntimeAdapter {
    if (config.runtime === "codex") {
        if (!config.codex) throw new AppError("缺少 Codex 运行时配置", 500, "configuration_error");
        return new CodexRuntimeAdapter({
            bin: config.codex.bin,
            apiKey: config.codex.apiKey,
            runtimeRoot: config.codex.runtimeRoot,
            tokens: new RuntimeTokenService(config.codex.tokenSecret),
            canvas,
            mcp: config.codex.mcp,
        });
    }
    if (!config.pi) throw new AppError("缺少 Pi 运行时配置", 500, "configuration_error");
    return new PiRuntimeAdapter(canvas, config.pi);
}

function publishCanvas(canvas: CanvasBridge) {
    return asyncRoute(async (request, response) => {
        const scope = requestScope(response);
        const ctx = await scope.projects.context(scope.auth.userId, request.params.projectId);
        const clientId = requiredText(request.body?.clientId, "缺少画布客户端 ID");
        const revision = nonNegativeInteger(request.body?.revision, "画布 revision 无效");
        const snapshot = jsonObject(request.body?.snapshot, "画布快照无效");
        const workspace = await scope.store.saveCanvasState(ctx, revision, snapshot);
        if (workspace.revision !== revision) throw new AppError("画布快照 revision 已过期", 409, "canvas_revision_conflict");
        canvas.publishSnapshot(ctx, clientId, revision, snapshot);
        response.json(workspace);
    });
}

function completeCanvasTool(canvas: CanvasBridge) {
    return asyncRoute(async (request, response) => {
        const scope = requestScope(response);
        const ctx = await scope.projects.context(scope.auth.userId, request.params.projectId);
        const result = jsonObject(request.body?.result, "工具结果无效");
        if (request.body?.snapshot !== undefined || request.body?.revision !== undefined) {
            const clientId = requiredText(request.body?.clientId, "缺少画布客户端 ID");
            const revision = nonNegativeInteger(request.body?.revision, "画布 revision 无效");
            const snapshot = jsonObject(request.body?.snapshot, "画布快照无效");
            const workspace = await scope.store.saveCanvasState(ctx, revision, snapshot);
            if (workspace.revision !== revision) throw new AppError("画布快照 revision 已过期", 409, "canvas_revision_conflict");
            canvas.publishSnapshot(ctx, clientId, revision, snapshot);
        }
        canvas.completeMutation(ctx, requiredText(request.params.requestId || request.body?.callId, "缺少工具调用 ID"), result);
        response.status(204).end();
    });
}

function runtimeToken(request: Request) {
    const match = /^Bearer\s+(.+)$/i.exec(request.header("authorization") || "");
    if (!match?.[1]) throw new AppError("缺少运行时 token", 401, "invalid_runtime_token");
    return match[1];
}

function requestScope(response: Response) {
    const auth = response.locals.auth as AuthenticatedRequest | undefined;
    if (!auth) throw new AppError("登录状态无效", 401, "unauthorized");
    const store = new SupabaseResearchStore(auth.database);
    return { auth, store, projects: new ProjectModule(store), conversations: new ConversationModule(store) };
}

function asyncRoute(handler: (request: Request, response: Response, next: NextFunction) => Promise<void>) {
    return (request: Request, response: Response, next: NextFunction) => void handler(request, response, next).catch(next);
}

function jsonObject(value: unknown, message: string): JsonObject {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(message, 400, "invalid_input");
    return value as JsonObject;
}

function nonNegativeInteger(value: unknown, message: string) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new AppError(message, 400, "invalid_input");
    return value;
}

function optionalNonNegativeInteger(value: unknown) {
    if (value === undefined) return 0;
    const parsed = typeof value === "string" ? Number(value) : NaN;
    return nonNegativeInteger(parsed, "事件序号无效");
}

function writeSse(response: Response, event: RuntimeEvent) {
    response.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}
