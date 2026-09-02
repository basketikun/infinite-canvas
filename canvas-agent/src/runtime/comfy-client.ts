import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BackendClient } from "./backend-client.js";
import { ComfyUiBridge, type ComfyModelCatalog, type ComfyPreset } from "./comfyui.js";
import type { RuntimeDatabase } from "./database.js";
import type { RuntimeTask, RuntimeTaskEvent } from "./types.js";

/** 构造 BackendClient（读 backend.json 或环境变量）。 */
export function createBackendClient(backendUrl: string, env: Record<string, string | undefined> = process.env): BackendClient {
    const token = env.INFINITE_CANVAS_BACKEND_TOKEN
        || (() => {
            try {
                const file = path.join(os.homedir(), ".infinite-canvas", "backend.json");
                return String(JSON.parse(fs.readFileSync(file, "utf8")).token || "");
            } catch { return ""; }
        })();
    return new BackendClient(backendUrl, token);
}

/** ComfyUI 能力客户端：backend 权威，Agent 本地 ComfyUiBridge 做离线兜底。 */
export type ComfyUiClient = {
    status(): Promise<Record<string, unknown>>;
    models(signal?: AbortSignal): Promise<ComfyModelCatalog>;
    presets(): ComfyPreset[];
    run(preset: string, input: Record<string, unknown>, params: Record<string, unknown>, baseUrl?: string): Promise<RuntimeTask>;
    cancel(id: string): Promise<RuntimeTask>;
    getUrl(): Promise<string>;
    setUrl(url: string): Promise<string>;
};

/** 把 ComfyUiBridge 包成统一接口（本地模式）。 */
export function localComfyUi(bridge: ComfyUiBridge): ComfyUiClient {
    return {
        status: () => bridge.status(),
        models: (signal) => bridge.models(signal),
        presets: () => bridge.presets(),
        run: (preset, input, params, baseUrl) => bridge.run(preset, input, params, baseUrl),
        cancel: (id) => Promise.resolve(bridge.cancel(id)),
        getUrl: async () => bridge.getUrl(),
        setUrl: async (url) => bridge.setUrl(url),
    };
}

/** backend 侧 ComfyUI 客户端（HTTP 到总后台 /comfy/*）。 */
export function backendComfyUi(client: BackendClient, presets: () => ComfyPreset[]): ComfyUiClient {
    return {
        status: () => client.comfyStatus(),
        models: (signal) => client.comfyModels(signal),
        presets,
        run: (preset, input, params, baseUrl) => client.comfyRun(preset, input, params, baseUrl),
        cancel: (id) => client.comfyCancel(id),
        getUrl: async () => (await client.comfyConfig()).url,
        setUrl: async (url) => (await client.comfySetConfig(url)).url,
    };
}

/** backend 优先、本地兜底的 ComfyUI 客户端（Agent 代理模式）。 */
export function proxyComfyUi(backend: BackendClient, local: ComfyUiBridge): ComfyUiClient {
    const back = backendComfyUi(backend, () => local.presets());
    return {
        status: () => back.status().catch(() => local.status()),
        models: (signal) => back.models(signal).catch(() => local.models(signal)),
        presets: () => local.presets(),
        run: (preset, input, params, baseUrl) => back.run(preset, input, params, baseUrl).catch(() => local.run(preset, input, params, baseUrl)),
        cancel: (id) => back.cancel(id).catch(() => local.cancel(id)),
        getUrl: () => back.getUrl().catch(() => local.getUrl()),
        setUrl: (url) => back.setUrl(url).catch(() => local.setUrl(url)),
    };
}

/** 查 comfyui 任务：backend 优先，404/异常时回退 Agent 本地 runtimeDb。 */
export async function resolveComfyTask(backend: BackendClient, runtimeDb: RuntimeDatabase, id: string, after = 0): Promise<{ task: RuntimeTask; events: RuntimeTaskEvent[] }> {
    try {
        const { task, events } = await backend.comfyGetTask(id, after);
        if (task && task.kind.startsWith("comfyui:")) return { task, events };
    } catch { /* backend unreachable or 404 */ }
    const localTask = runtimeDb.getTask(id);
    if (!localTask || !localTask.kind.startsWith("comfyui:")) throw new Error(`task not found: ${id}`);
    return { task: localTask, events: runtimeDb.listEvents(localTask.id, after) };
}
