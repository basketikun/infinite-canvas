import type { Express } from "express";
import { z } from "zod";
import { createParser } from "eventsource-parser";
import { fetchChannelModels } from "@infinite-canvas/model-runtime/channels";
import { buildModelApiUrl } from "@infinite-canvas/model-runtime/script";
import { channelsSchema, type ModelChannel } from "@infinite-canvas/shared/channels";
import { taskSubmissionSchema, localModelRequestSchema, modelErrorMessages, ModelExecutionError } from "@infinite-canvas/shared/model-http";
import { StorageError } from "@infinite-canvas/shared/storage-data";
import type { ModelCallUpstream } from "@infinite-canvas/shared/model-calls";
import { findChannelGroup, publicChannels, saveChannels } from "../models/channels.js";
import { executeModel } from "../models/execute.js";
import type { FsStorage } from "../storage/fs-storage.js";
import { ModelTasks, modelErrorInfo } from "../models/tasks.js";

import { appendFile } from "node:fs/promises";
import path from "node:path";
import { requestSignal } from "./request-signal.js";

/** 模型失败的完整诊断只写私有日志；页面只收到错误码与模型服务返回的错误说明。 */
async function logModelFailure(storage: FsStorage, line: string) {
    try { await appendFile(path.join(storage.directory, "private", "model-diagnostics.log"), `${new Date().toISOString()} ${line.slice(0, 1000)}\n`, "utf8"); }
    catch { /* 诊断日志失败不影响请求 */ }
}

export function mountModels(app: Express, storage: FsStorage, tasks: ModelTasks) {
    app.post("/api/models/task", async (req, res) => {
        const input = taskSubmissionSchema.safeParse(req.body);
        if (!input.success) return void res.status(400).json({ error: { code: "MODEL_CONFIG_MISSING" } });
        try { res.status(202).json(await tasks.submit(input.data.taskId, input.data.request, input.data.target)); }
        catch (error) {
            const info = modelErrorInfo(error);
            res.status(info.code === "MODEL_TASK_CONFLICT" ? 409 : 400).json({ error: info });
        }
    });
    app.post("/api/models/task/changes", async (req, res) => {
        const input = z.array(z.object({ taskId: z.string(), revision: z.string() })).nonempty().safeParse(req.body);
        if (!input.success) return void res.status(400).json({ error: { code: "MODEL_CONFIG_MISSING" } });
        const controller = new AbortController();
        const signal = AbortSignal.any([requestSignal(res), controller.signal]);
        try {
            res.json(await Promise.race(input.data.map(({ taskId, revision }) => tasks.read(taskId, revision, signal))));
        } catch (error) {
            if (!signal.aborted) res.status(503).json({ error: modelErrorInfo(error) });
        } finally {
            controller.abort();
        }
    });
    app.get("/api/models/task/:taskId", async (req, res) => {
        const signal = requestSignal(res);
        try { res.json(await tasks.read(req.params.taskId, typeof req.query.after === "string" ? req.query.after : undefined, signal)); }
        catch (error) {
            if (signal.aborted) return;
            const info = modelErrorInfo(error);
            res.status(info.code === "MODEL_TASK_MISSING" ? 404 : 503).json({ error: info });
        }
    });
    app.post("/api/models/task/:taskId/resume", async (req, res) => {
        try { await tasks.resume(req.params.taskId); res.sendStatus(204); }
        catch (error) { res.status(400).json({ error: modelErrorInfo(error) }); }
    });
    app.post("/api/models/task/:taskId/cancel", async (req, res) => {
        await tasks.cancel(req.params.taskId);
        res.sendStatus(204);
    });
    app.get("/api/channels", async (req, res) => {
        const saved = await storage.read<ModelChannel[]>("privateChannels", "channels");
        res.json(saved?.value ? { channels: publicChannels(saved.value) } : null);
    });
    app.put("/api/channels", async (req, res) => {
        const input = z.object({ channels: channelsSchema, clientId: z.string() }).safeParse(req.body);
        if (!input.success) throw new StorageError("STORAGE_INVALID");
        res.json(await saveChannels(storage, input.data.channels, input.data.clientId));
    });
    app.post("/api/channels/models", async (req, res) => {
        const input = z.object({ groupId: z.string(), format: z.enum(["openai", "gemini"]) }).safeParse(req.body);
        if (!input.success) return void res.sendStatus(400);
        const signal = requestSignal(res);
        try {
            const { channel, group } = await findChannelGroup(storage, input.data.groupId);
            res.json(await fetchChannelModels(channel.baseUrl, group.apiKey, input.data.format, (url) => url, signal));
        } catch (error) {
            if (signal.aborted) return;
            if (error instanceof ModelExecutionError) return void res.status(502).json({ error: { code: error.code } });
            if (error instanceof Error && error.message === "MODEL_CONFIG_MISSING") return void res.status(400).json({ error: { code: "MODEL_CONFIG_MISSING" } });
            throw error instanceof StorageError ? error : new StorageError("STORAGE_UNAVAILABLE");
        }
    });
    app.post("/api/models/execute", async (req, res) => {
        const input = localModelRequestSchema.safeParse(req.body);
        if (!input.success || input.data.action === "video" || input.data.action === "video-query") return void res.status(400).json({ error: { code: "MODEL_CONFIG_MISSING" } });
        const signal = requestSignal(res);
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
        res.flushHeaders();
        const send = (event: unknown) => { if (!signal.aborted) res.write(`data: ${JSON.stringify(event)}\n\n`); };
        const upstream: ModelCallUpstream[] = [];
        const sendUpstream = () => { if (upstream.length) send({ type: "upstream", upstream }); };
        try {
            const result = await executeModel(storage, input.data, signal, (text) => send({ type: "text", text }), { onUpstream: (entry) => upstream.push(entry) });
            sendUpstream();
            send({ type: "result", result });
        } catch (error) {
            if (!signal.aborted) {
                sendUpstream();
                const detail = error instanceof Error ? error.message : String(error);
                console.error("[models] execute failed", input.data.action, input.data.call.model, detail);
                await logModelFailure(storage, `${input.data.action} ${input.data.call.model} ${detail}`);
                send({ type: "error", ...modelErrorInfo(error) });
            }
        } finally {
            res.end();
        }
    });
    app.post("/api/models/agent", async (req, res) => {
        const input = z.object({ groupId: z.string(), model: z.string(), protocol: z.enum(["responses", "chat-completions", "anthropic", "gemini"]), protocolHeaders: z.object({ "anthropic-version": z.string().optional(), "anthropic-beta": z.string().optional(), "openai-beta": z.string().optional() }), stream: z.boolean(), body: z.record(z.unknown()) }).safeParse(req.body);
        if (!input.success) return void res.sendStatus(400);
        const signal = requestSignal(res);
        const { groupId, model, protocol, stream, body } = input.data;
        const failure = { error: { type: "api_error", code: "MODEL_FAILED", message: modelErrorMessages.MODEL_FAILED } };
        try {
            const { channel, group } = await findChannelGroup(storage, groupId);
            if (!group.apiKey || !group.models.some((item) => item.name === model && item.capability === "text")) throw new ModelExecutionError("MODEL_CONFIG_MISSING");
            const base = channel.baseUrl.replace(/\/+$/, "");
            const googleRoot = /\/v1(?:beta)?$/.test(base) ? base : `${base}/v1beta`;
            const url = protocol === "gemini" ? `${googleRoot}/models/${encodeURIComponent(model)}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}` : buildModelApiUrl(base, protocol === "responses" ? "/responses" : protocol === "anthropic" ? "/messages" : "/chat/completions");
            const headers = protocol === "gemini" ? { "x-goog-api-key": group.apiKey } : protocol === "anthropic" ? { "x-api-key": group.apiKey, "anthropic-version": "2023-06-01" } : { Authorization: `Bearer ${group.apiKey}` };
            const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers, ...input.data.protocolHeaders }, body: JSON.stringify(protocol === "gemini" ? body : { ...body, model }), signal });
            if (!response.ok) return void res.status(response.status).type(response.headers.get("content-type") ?? "application/json").send(await response.text());
            if (!response.headers.get("content-type")?.includes("text/event-stream")) {
                const data = await response.json();
                return void res.json(data);
            }
            res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
            res.flushHeaders();
            const parser = createParser({ onEvent: (event) => {
                if (event.data === "[DONE]") { res.write("data: [DONE]\n\n"); return; }
                const data = JSON.parse(event.data);
                res.write(`${event.event ? `event: ${event.event}\n` : ""}data: ${JSON.stringify(data)}\n\n`);
            } });
            const decoder = new TextDecoder();
            const reader = response.body!.getReader();
            try {
                for (;;) {
                    const chunk = await reader.read();
                    if (chunk.done) break;
                    parser.feed(decoder.decode(chunk.value, { stream: true }));
                }
                parser.feed(decoder.decode());
                parser.reset({ consume: true });
            } finally { await reader.cancel(); reader.releaseLock(); }
            res.end();
        } catch (error) {
            if (signal.aborted) return;
            const detail = error instanceof Error ? `${error.message} ${String((error.cause as { code?: string } | undefined)?.code ?? "")}` : String(error);
            console.error("[models] agent failed", protocol, model, detail);
            await logModelFailure(storage, `agent ${protocol} ${model} ${detail}`);
            modelErrorInfo(error);
            if (res.headersSent) {
                const event = protocol === "anthropic" ? { type: "error", ...failure } : protocol === "gemini" ? { error: { code: 500, status: "INTERNAL", message: modelErrorMessages.MODEL_FAILED } } : { type: "error", ...failure };
                res.end(`event: error\ndata: ${JSON.stringify(event)}\n\n`);
            } else res.status(502).json(failure);
        }
    });
}
