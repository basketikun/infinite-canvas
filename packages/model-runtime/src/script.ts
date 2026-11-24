import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { createParser } from "eventsource-parser";
import type { ModelCapability } from "@infinite-canvas/shared/models";
import type { ModelExecutionConfig } from "@infinite-canvas/shared/model-execution";
import type { ModelCallUpstream } from "@infinite-canvas/shared/model-calls";
import { ModelExecutionError } from "@infinite-canvas/shared/model-http";

type RequestOptions = { signal?: AbortSignal; onUpstream?: (entry: ModelCallUpstream) => void };

export type PluginHttpOptions = {
    headers?: Record<string, string>;
    params?: Record<string, unknown>;
    responseType?: "json" | "blob" | "text" | "arraybuffer";
};

export type PluginHttp = {
    url: (path: string) => string;
    post: (path: string, body?: unknown, options?: PluginHttpOptions) => Promise<unknown>;
    get: (path: string, options?: PluginHttpOptions) => Promise<unknown>;
};

export type PluginPollOptions = { intervalMs?: number; timeoutMs?: number };

export type ScriptArgs = {
    capability: ModelCapability;
    script: string;
    config: ModelExecutionConfig;
    prompt?: string;
    images?: string[];
    videos?: string[];
    audios?: string[];
    messages?: unknown[];
    tools?: unknown;
    options?: Record<string, unknown>;
    signal?: AbortSignal;
    onDelta?: (text: string) => void;
    /** 记录脚本实际发给模型服务的请求与返回。 */
    onUpstream?: (entry: ModelCallUpstream) => void;
    taskId?: string;
};

export type ScriptHost = {
    mapUrl: (url: string) => string;
    toBlob: (source: string | Blob) => Promise<Blob>;
    toDataUrl: (source: string | Blob) => Promise<string>;
    toPublicUrl: (source: string | Blob) => Promise<string>;
    runTextAgent?: (protocol: string, settings?: Record<string, unknown>) => Promise<unknown>;
    /** 请求地址是否经过本地代理，用于提示代理无法连接。 */
    proxied?: (url: string) => boolean;
};

export function buildModelApiUrl(baseUrl: string, path: string) {
    const base = baseUrl.replace(/\/+$/, "");
    return `${base.toLowerCase().endsWith("/v1") ? base : `${base}/v1`}${path}`;
}

function pluginHeaders(extra?: Record<string, string>, hasJsonBody = false): Record<string, string> {
    const headers: Record<string, string> = {};
    if (hasJsonBody) headers["Content-Type"] = "application/json";
    return { ...headers, ...extra };
}

const secretName = /authorization|api-key|apikey|token|secret|^key$/i;

function kilobytes(bytes: number) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 编码数据只保留类型和大小，避免把图片、音视频内容写进调用记录。 */
function traceValue(value: unknown): unknown {
    if (typeof value === "string") {
        const dataUrl = value.match(/^data:([^;,]*)[;,]/);
        if (dataUrl) return `[${dataUrl[1] || "数据"}，${kilobytes(value.length * 0.75)}]`;
        return value.length > 1000 && /^[A-Za-z0-9+/=_-]+$/.test(value) ? `[base64 数据，${kilobytes(value.length * 0.75)}]` : value;
    }
    if (typeof Blob !== "undefined" && value instanceof Blob) return `[文件 ${value.type || "未知类型"}，${kilobytes(value.size)}]`;
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return `[二进制数据，${kilobytes(value.byteLength)}]`;
    if (typeof FormData !== "undefined" && value instanceof FormData) {
        // 表单按字段名展开成普通对象，同名字段（如多张参考图）合并为数组。
        const fields: Record<string, unknown> = {};
        for (const [name, item] of value.entries()) {
            const traced = traceValue(item);
            fields[name] = name in fields ? [fields[name], traced].flat() : traced;
        }
        return fields;
    }
    if (Array.isArray(value)) return value.map(traceValue);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, traceValue(item)]));
    return value;
}

function traceUrl(url: string) {
    const parsed = new URL(url);
    for (const name of [...parsed.searchParams.keys()]) if (secretName.test(name)) parsed.searchParams.set(name, "***");
    return parsed.toString();
}

function traceHeaders(headers: unknown) {
    return Object.fromEntries(Object.entries({ ...(headers as Record<string, unknown>) }).map(([name, value]) => [name, secretName.test(name) ? "***" : String(value)]));
}

async function traceRequest(request: AxiosRequestConfig, onUpstream: RequestOptions["onUpstream"]) {
    if (!onUpstream) return axios.request(request);
    const entry: ModelCallUpstream = { method: (request.method || "get").toUpperCase(), url: traceUrl(axios.getUri(request)), headers: traceHeaders(request.headers), body: traceValue(request.data) };
    let response: AxiosResponse;
    try {
        response = await axios.request(request);
    } catch (error) {
        const failed = axios.isAxiosError(error) ? error.response : undefined;
        onUpstream({ ...entry, status: failed?.status, response: traceValue(failed?.data), error: error instanceof Error ? error.message : String(error) });
        throw error;
    }
    onUpstream({ ...entry, status: response.status, response: traceValue(response.data) });
    return response;
}

function pluginUrl(config: ModelExecutionConfig, path: string, host: ScriptHost) {
    if (/^https?:/i.test(path)) return host.mapUrl(path);
    return host.mapUrl(buildModelApiUrl(config.baseUrl, path.startsWith("/") ? path : `/${path}`));
}

function createPluginHttp(config: ModelExecutionConfig, host: ScriptHost, options?: RequestOptions): PluginHttp {
    const run = async (method: "get" | "post", path: string, body: unknown, opts?: PluginHttpOptions) => {
        const isForm = typeof FormData !== "undefined" && body instanceof FormData;
        const response = await traceRequest({
            method,
            url: pluginUrl(config, path, host),
            data: method === "post" ? body : undefined,
            params: opts?.params,
            headers: pluginHeaders({ Authorization: `Bearer ${config.apiKey}`, ...opts?.headers }, method === "post" && !isForm && body !== undefined),
            responseType: opts?.responseType === "blob" ? "arraybuffer" : opts?.responseType || "json",
            signal: options?.signal,
        }, options?.onUpstream);
        if (response.data?.error) throw new axios.AxiosError("Model request failed", undefined, response.config, response.request, response);
        return opts?.responseType === "blob" && !(response.data instanceof Blob) ? new Blob([response.data], { type: response.headers["content-type"] as string }) : response.data;
    };
    return {
        url: (path) => pluginUrl(config, path, host),
        post: (path, body, opts) => run("post", path, body, opts),
        get: (path, opts) => run("get", path, undefined, opts),
    };
}

/** Raw request with no automatic auth header — the script controls method, url, headers, body entirely. */
function createPluginRequest(config: ModelExecutionConfig, host: ScriptHost, options?: RequestOptions) {
    return async (requestConfig: AxiosRequestConfig & { url: string }) => {
        const url = /^https?:/i.test(requestConfig.url) ? requestConfig.url : config.baseUrl.replace(/\/+$/, "") + "/" + requestConfig.url.replace(/^\//, "");
        const response = await traceRequest({ ...requestConfig, responseType: requestConfig.responseType === "blob" ? "arraybuffer" : requestConfig.responseType, url: host.mapUrl(url), signal: options?.signal }, options?.onUpstream);
        if (response.data?.error) throw new axios.AxiosError("Model request failed", undefined, response.config, response.request, response);
        return requestConfig.responseType === "blob" && !(response.data instanceof Blob) ? new Blob([response.data], { type: response.headers["content-type"] as string }) : response.data;
    };
}

type ScriptStreamOptions = { url: string; headers?: Record<string, string>; data: unknown };

async function streamModelEvents(config: ModelExecutionConfig, host: ScriptHost, options: ScriptStreamOptions, onEvent: (event: Record<string, unknown>) => void, { signal, onUpstream }: RequestOptions) {
    const url = /^https?:/i.test(options.url) ? options.url : config.baseUrl.replace(/\/+$/, "") + "/" + options.url.replace(/^\//, "");
    const headers = { "Content-Type": "application/json", Accept: "text/event-stream", ...options.headers };
    const entry: ModelCallUpstream = { method: "POST", url: traceUrl(host.mapUrl(url)), headers: traceHeaders(headers), body: traceValue(options.data) };
    let response: Response;
    try {
        response = await fetch(host.mapUrl(url), { method: "POST", headers, body: JSON.stringify(options.data), signal });
    } catch (error) {
        onUpstream?.({ ...entry, error: error instanceof Error ? error.message : String(error) });
        throw error;
    }
    if (!response.ok) {
        const data = response.headers.get("content-type")?.includes("json") ? await response.json() : undefined;
        onUpstream?.({ ...entry, status: response.status, response: traceValue(data) });
        throw new Error("Stream request failed", { cause: { status: response.status, data } });
    }
    onUpstream?.({ ...entry, status: response.status });
    const emitEvent = (event: Record<string, unknown>) => {
        const nested = event.response as { error?: unknown } | undefined;
        if (event.error || nested?.error || event.type === "error") {
            throw new Error("Stream request failed", { cause: { data: nested?.error ? nested : event } });
        }
        onEvent(event);
    };
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
        emitEvent(await response.json());
        return;
    }
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const parser = createParser({ onEvent: ({ data }) => { if (data && data !== "[DONE]") emitEvent(JSON.parse(data)); } });
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parser.feed(decoder.decode(value, { stream: true }));
        }
        parser.feed(decoder.decode());
        parser.reset({ consume: true });
    } finally {
        await reader.cancel();
        reader.releaseLock();
    }
}

function sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
        signal?.addEventListener("abort", abort, { once: true });
    });
}

function createPoll(signal?: AbortSignal) {
    return async function poll<T, R>(request: () => Promise<T>, extract: (value: T) => R | null | undefined | false, options?: PluginPollOptions): Promise<R> {
        const intervalMs = options?.intervalMs ?? 2500;
        const timeoutMs = options?.timeoutMs ?? 300000;
        const deadline = performance.now() + timeoutMs;
        for (;;) {
            if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
            const result = extract(await request());
            if (result !== null && result !== undefined && result !== false) return result;
            if (performance.now() >= deadline) throw new Error("插件轮询超时，请检查调用脚本或稍后重试");
            await sleep(intervalMs, signal);
        }
    };
}

export async function runScript<T = unknown>(args: ScriptArgs, host: ScriptHost): Promise<T> {
    const { config, signal } = args;
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const main = new Function(`"use strict";\n${args.script}\nreturn typeof main === "function" ? main : undefined;`)();
    if (typeof main !== "function") throw new Error("SCRIPT_ENTRY_REQUIRED");
    return await main({
        capability: args.capability,
        model: config.model,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        systemPrompt: config.systemPrompt,
        reasoningEffort: config.reasoningEffort,
        prompt: args.prompt ?? "",
        images: args.images ?? [],
        videos: args.videos ?? [],
        audios: args.audios ?? [],
        messages: args.messages ?? [],
        tools: args.tools,
        options: args.options ?? {},
        taskId: args.taskId,
        signal,
        utils: {
            http: createPluginHttp(config, host, { signal, onUpstream: args.onUpstream }),
            request: createPluginRequest(config, host, { signal, onUpstream: args.onUpstream }),
            stream: (options: ScriptStreamOptions, onEvent: (event: Record<string, unknown>) => void) => streamModelEvents(config, host, options, onEvent, { signal, onUpstream: args.onUpstream }),
            onDelta: args.onDelta,
            runTextAgent: host.runTextAgent,
            poll: createPoll(signal),
            sleep: (ms: number) => sleep(ms, signal),
            toBlob: host.toBlob,
            toDataUrl: host.toDataUrl,
            toPublicUrl: host.toPublicUrl,
            markdownImages: async (source: string) => {
                const { lexer, walkTokens } = await import("marked");
                const urls: string[] = [];
                walkTokens(lexer(source), (token) => { if (token.type === "image") urls.push(token.href); });
                return urls;
            },
            markdownLinks: async (source: string) => {
                const { lexer, walkTokens } = await import("marked");
                const urls: string[] = [];
                walkTokens(lexer(source), (token) => { if (token.type === "link") urls.push(token.href); });
                return urls;
            },
        },
    });
}

/** Normalize whatever an image script returns into the app's generated-image shape. */
export function normalizePluginImages(result: unknown): string[] {
    const items = Array.isArray(result) ? result : [result];
    const urls = items
        .map((item) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object") {
                const record = item as Record<string, unknown>;
                if (typeof record.dataUrl === "string") return record.dataUrl;
                if (typeof record.url === "string") return record.url;
                if (typeof record.b64_json === "string") return `data:image/png;base64,${record.b64_json}`;
            }
            return "";
        })
        .filter(Boolean);
    if (!urls.length) throw new ModelExecutionError("MODEL_RESULT_MISSING");
    return urls;
}
