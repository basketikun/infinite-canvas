import axios from "axios";
import { nanoid } from "nanoid";

import { runDuomiImageLifecycle } from "@/services/api/duomi-image-lifecycle.mjs";
import { DUOMI_POLL_INTERVAL_MS, DUOMI_POLL_MAX_ATTEMPTS, duomiCreatePath, duomiImageRequestBody, duomiRequestHeaders, duomiRequestUrl, duomiTaskPath, duomiTaskErrorMessage, isDuomiRequestTimeout } from "@/services/api/duomi-image-provider-utils.mjs";
import { AI_PROXY_TARGET_HEADER, buildAiProxyHeaders, buildApiUrl, type AiConfig } from "@/stores/use-config-store";

type DuomiConfig = Pick<AiConfig, "baseUrl" | "apiKey" | "useProxy">;
type DuomiImageRequest = { model: string; prompt: string; size: string; quality: string; referenceUrls: string[] };
type RequestOptions = { signal?: AbortSignal };
type GeneratedImage = { id: string; dataUrl: string };

const DUOMI_IMAGE_ERROR = "多米图片生成失败";
const DUOMI_TIMEOUT_ERROR = "多米图片生成超时，请稍后重试";

export async function requestDuomiImages(config: DuomiConfig, request: DuomiImageRequest, options?: RequestOptions): Promise<GeneratedImage[]> {
    const signal = options?.signal;
    const createPath = duomiCreatePath(request.model, request.referenceUrls);

    try {
        return await runDuomiImageLifecycle({
            model: request.model,
            signal,
            interval: DUOMI_POLL_INTERVAL_MS,
            maxAttempts: DUOMI_POLL_MAX_ATTEMPTS,
            timeout: DUOMI_POLL_INTERVAL_MS * DUOMI_POLL_MAX_ATTEMPTS,
            now: Date.now,
            makeId: nanoid,
            wait: delay,
            create: async ({ signal: requestSignal, timeout }) => (await axios.post<unknown>(duomiApiUrl(config, createPath), duomiImageRequestBody(request), { headers: duomiHeaders(config), signal: requestSignal, timeout })).data,
            poll: async (taskId, { signal: requestSignal, timeout }) => (await axios.get<unknown>(duomiApiUrl(config, duomiTaskPath(request.model, taskId)), { headers: duomiHeaders(config), signal: requestSignal, timeout })).data,
        });
    } catch (error) {
        if (isAbort(error, signal)) throw abortError(error);
        if (isDuomiRequestTimeout(error)) throw new Error(DUOMI_TIMEOUT_ERROR);
        if (axios.isAxiosError(error)) throw new Error(duomiHttpErrorMessage(error, request.model));
        if (error instanceof Error) throw error;
        throw new Error(DUOMI_IMAGE_ERROR);
    }
}

function duomiApiUrl(config: DuomiConfig, path: string) {
    const proxyUrl = config.useProxy ? buildApiUrl(config.baseUrl, path, true) : "";
    return duomiRequestUrl(config.baseUrl, path, config.useProxy, proxyUrl);
}

function duomiHeaders(config: DuomiConfig) {
    const proxyHeaders = buildAiProxyHeaders({ baseUrl: config.baseUrl, apiFormat: "openai", useProxy: config.useProxy });
    return duomiRequestHeaders(config.baseUrl, config.apiKey, config.useProxy, proxyHeaders, AI_PROXY_TARGET_HEADER);
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }

        const onAbort = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            reject(new DOMException("Aborted", "AbortError"));
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

function isAbort(error: unknown, signal?: AbortSignal) {
    return signal?.aborted || axios.isCancel(error) || (error instanceof DOMException && error.name === "AbortError");
}

function abortError(error: unknown) {
    return error instanceof DOMException && error.name === "AbortError" ? error : new DOMException("Aborted", "AbortError");
}

function duomiHttpErrorMessage(error: { response?: { status?: number; data?: unknown } }, model: string) {
    const status = error.response?.status;
    if (status === 401 || status === 403) return "多米鉴权失败，请检查 API Key、账户余额或模型权限";
    if (status === 429) return "多米请求被限流或额度不足，请稍后重试";
    return duomiTaskErrorMessage(model, error.response?.data) || DUOMI_IMAGE_ERROR;
}
