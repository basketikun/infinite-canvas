import { readFile } from "node:fs/promises";
import path from "node:path";

import { RuntimeDatabase } from "./database.js";
import type { RuntimeTask } from "./types.js";

type RunningHubField = {
    id?: string; nodeId?: string; fieldName?: string; fieldValue?: unknown; fieldType?: string;
    label?: string; enabled?: boolean; sourceFromUpstream?: boolean; imageOrder?: number;
    required?: boolean; random_enabled?: boolean; min?: unknown; max?: unknown; step?: unknown;
};
type RunningHubConfig = {
    baseUrl: string; apiKey: string; walletApiKey?: string; mode: "workflow" | "app";
    workflowId?: string; appId?: string; fields?: RunningHubField[]; workflowJson?: unknown;
    useWallet?: boolean; instanceType?: string;
};

const DEFAULT_URL = "https://www.runninghub.ai";

export class RunningHubBridge {
    private readonly db: RuntimeDatabase;
    private readonly controllers = new Map<string, AbortController>();

    constructor(db: RuntimeDatabase) { this.db = db; }

    getConfig(): RunningHubConfig {
        const value = this.db.getSetting("runninghub.config");
        const stored = value && typeof value === "object" ? value as Partial<RunningHubConfig> : {};
        return {
            baseUrl: normalizeUrl(String(stored.baseUrl || DEFAULT_URL)), apiKey: String(stored.apiKey || ""),
            walletApiKey: String(stored.walletApiKey || ""), mode: stored.mode === "app" ? "app" : "workflow",
            workflowId: String(stored.workflowId || ""), appId: String(stored.appId || ""),
            fields: Array.isArray(stored.fields) ? stored.fields : [], workflowJson: stored.workflowJson,
            useWallet: stored.useWallet === true, instanceType: String(stored.instanceType || ""),
        };
    }

    setConfig(patch: Partial<RunningHubConfig>) {
        const current = this.getConfig();
        const next = { ...current, ...patch, baseUrl: normalizeUrl(String(patch.baseUrl ?? current.baseUrl)) };
        this.db.setSetting("runninghub.config", next);
        return next;
    }

    status() {
        const config = this.getConfig();
        return { configured: Boolean((config.apiKey || config.walletApiKey) && (config.workflowId || config.appId)), url: config.baseUrl, mode: config.mode, hasApiKey: Boolean(config.apiKey || config.walletApiKey), workflowId: config.workflowId || "", appId: config.appId || "" };
    }

    async run(input: Record<string, unknown>, params: Record<string, unknown>) {
        const task = this.db.createTask("runninghub:minimax-h3", input, params);
        const controller = new AbortController();
        this.controllers.set(task.id, controller);
        void this.execute(task, controller).catch((error) => this.fail(task.id, error));
        return task;
    }

    cancel(id: string) { this.controllers.get(id)?.abort(); return this.db.updateTask(id, { status: "cancelled", error: "任务已取消" }); }

    private async execute(task: RuntimeTask, controller: AbortController) {
        const config = this.getConfig();
        const useWallet = task.params.useWallet === true || config.useWallet === true;
        const apiKey = useWallet ? config.walletApiKey : config.apiKey;
        if (!apiKey) throw new Error(useWallet ? "RunningHub 未配置账户余额 API Key" : "RunningHub 未配置 API Key");
        const mode = String(task.params.runninghubMode || config.mode) === "app" ? "app" : "workflow";
        const id = String((mode === "app" ? task.params.runninghubAppId || config.appId : task.params.runninghubWorkflowId || config.workflowId) || "").trim();
        if (!id) throw new Error(mode === "app" ? "未配置 RunningHub AI 应用 ID" : "未配置 RunningHub 工作流 ID");
        this.db.updateTask(task.id, { status: "running", progress: 0.05 });
        const refs = [ ...(Array.isArray(task.input.references) ? task.input.references : []), ...(Array.isArray(task.input.audios) ? task.input.audios : []), ...(typeof task.input.video === "string" ? [task.input.video] : []) ].map(String);
        const fields = Array.isArray(task.params.runninghubFields) && task.params.runninghubFields.length ? task.params.runninghubFields as RunningHubField[] : config.fields || [];
        if (!fields.length) throw new Error("RunningHub 未配置参数字段，请先同步工作流参数");
        const configuredParams = task.params.runninghubParams && typeof task.params.runninghubParams === "object" ? task.params.runninghubParams as Record<string, unknown> : {};
        const nodeInfoList = [] as Array<{ nodeId: string; fieldName: string; fieldValue: unknown }>;
        const cursors = { image: 0, video: 0, audio: 0 };
        for (const field of fields.filter((item) => item.enabled !== false)) {
            if (!field.nodeId || !field.fieldName) continue;
            const kind = fieldKind(field);
            let value: unknown = configuredParams[field.id || `${field.nodeId}::${field.fieldName}`] ?? task.params[field.id || `${field.nodeId}::${field.fieldName}`] ?? field.fieldValue ?? "";
            if (kind === "prompt") value = String(task.input.prompt || value);
            if (kind === "image" || kind === "video" || kind === "audio") {
                const candidates = refs.filter((ref) => kindForPath(ref) === kind);
                const file = candidates[cursors[kind]++];
                if (!file) { if (field.required) throw new Error(`RunningHub 参数「${field.label || field.fieldName}」需要输入素材`); continue; }
                value = await this.upload(file, apiKey, useWallet, controller.signal);
            } else if (kind === "number" && String(value).trim() !== "" && Number.isFinite(Number(value))) value = Number(value);
            else if (kind === "boolean") value = value === true || String(value).toLowerCase() === "true";
            nodeInfoList.push({ nodeId: String(field.nodeId), fieldName: String(field.fieldName), fieldValue: value });
        }
        const body: Record<string, unknown> = mode === "app" ? { apiKey, webappId: id, nodeInfoList } : { apiKey, workflowId: id, nodeInfoList, addMetadata: true };
        const workflowJson = task.params.runninghubWorkflowJson ?? config.workflowJson;
        if (mode === "workflow" && workflowJson) body.workflow = JSON.stringify(workflowJson);
        if (mode === "app" && config.instanceType) body.instanceType = config.instanceType;
        const submitPath = mode === "app" ? "/task/openapi/ai-app/run" : "/task/openapi/create";
        const submitted = await this.request(submitPath, "POST", body, controller.signal);
        const taskId = String((submitted.data as Record<string, unknown> | undefined)?.taskId || "");
        if (!taskId) throw new Error(`RunningHub 未返回 taskId：${JSON.stringify(submitted).slice(0, 1000)}`);
        this.db.addEvent(task.id, "submitted", { taskId, backend: "runninghub", mode });
        for (;;) {
            if (controller.signal.aborted) throw new Error("任务已取消");
            await delay(2500, controller.signal);
            const result = await this.request("/task/openapi/outputs", "POST", { apiKey, taskId }, controller.signal);
            const data = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : {};
            const status = String(data.status || "PENDING").toLowerCase();
            this.db.addEvent(task.id, "poll", { taskId, status });
            if (["success", "succeeded", "completed"].includes(status)) {
                const media = extractMedia(data);
                if (!media.length) throw new Error("RunningHub 任务完成但没有返回媒体");
                this.db.updateTask(task.id, { status: "succeeded", progress: 1, result: { media, taskId, backend: "runninghub" } });
                return;
            }
            if (["failed", "error"].includes(status)) throw new Error(String(data.failReason || data.message || "RunningHub 任务失败"));
            this.db.updateTask(task.id, { progress: Math.min(0.95, Number(task.progress || 0.05) + 0.02) });
        }
    }

    private async upload(file: string, apiKey: string, useWallet: boolean, signal: AbortSignal) {
        const data = await readFile(file);
        const form = new FormData(); form.set("file", new Blob([data]), path.basename(file)); form.set("apiKey", apiKey); form.set("fileType", "input");
        const response = await fetch(`${this.getConfig().baseUrl}/task/openapi/upload`, { method: "POST", body: form, signal, headers: { Authorization: `Bearer ${apiKey}`, ...(useWallet ? { "x-use-wallet": "true" } : {}) } });
        const body = await response.json().catch(() => ({})) as Record<string, unknown>;
        if (!response.ok || body.code !== 0 && body.code !== "0") throw new Error(`RunningHub 上传素材失败（HTTP ${response.status}）：${String(body.msg || body.message || "未知错误")}`);
        return String((body.data as Record<string, unknown> | undefined)?.fileName || "");
    }

    private async request(endpoint: string, method: "POST", body: Record<string, unknown>, signal: AbortSignal) {
        const config = this.getConfig();
        const response = await fetch(`${config.baseUrl}${endpoint}`, { method, headers: { "content-type": "application/json", Accept: "application/json", Authorization: `Bearer ${String(body.apiKey || "")}` }, body: JSON.stringify(body), signal });
        const raw = await response.json().catch(() => ({})) as Record<string, unknown>;
        if (!response.ok || raw.code !== 0 && raw.code !== "0") throw new Error(`RunningHub 请求失败（HTTP ${response.status}）：${String(raw.msg || raw.message || JSON.stringify(raw).slice(0, 800))}`);
        return raw;
    }

    private fail(id: string, error: unknown) { if (this.db.getTask(id)?.status === "cancelled") return; const message = error instanceof Error ? error.message : String(error); this.db.updateTask(id, { status: "failed", error: message }); this.db.addEvent(id, "error", { error: message }); this.controllers.delete(id); }
}

function normalizeUrl(value: string) { const url = new URL(value.trim() || DEFAULT_URL); if (!['http:', 'https:'].includes(url.protocol)) throw new Error("RunningHub 地址必须使用 HTTP 或 HTTPS"); return url.toString().replace(/\/$/, ""); }
function fieldKind(field: RunningHubField) { const text = `${field.fieldType || ""} ${field.fieldName || ""} ${field.label || ""}`.toLowerCase(); if (/image|图片/.test(text)) return "image" as const; if (/video|视频/.test(text)) return "video" as const; if (/audio|音频|sound/.test(text)) return "audio" as const; if (/prompt|text|提示词|正向|负向/.test(text)) return "prompt" as const; if (/bool/.test(text)) return "boolean" as const; if (/int|float|number|slider|seed/.test(text)) return "number" as const; return "text" as const; }
function kindForPath(value: string) { return /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/i.test(value) ? "video" : /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/i.test(value) ? "audio" : "image"; }
function extractMedia(data: Record<string, unknown>) { const values = [...(Array.isArray(data.image_items) ? data.image_items : []), ...(Array.isArray(data.urls) ? data.urls : [])]; return values.map((item) => typeof item === "string" ? { url: item } : item && typeof item === "object" ? { ...(item as Record<string, unknown>), url: String((item as Record<string, unknown>).url || "") } : null).filter((item): item is { url: string } => Boolean(item?.url)); }
function delay(ms: number, signal: AbortSignal) { return new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("任务已取消")); }, { once: true }); }); }
