import axios from "axios";

import { createDuomiVideoLifecycleTask, pollDuomiVideoLifecycleTask } from "@/services/api/duomi-video-lifecycle.mjs";
import { DUOMI_VIDEO_POLL_INTERVAL_MS, DUOMI_VIDEO_POLL_MAX_ATTEMPTS, duomiVideoTaskErrorMessage } from "@/services/api/duomi-video-provider-utils.mjs";
import { duomiRequestHeaders, duomiRequestUrl, isDuomiRequestTimeout } from "@/services/api/duomi-provider-utils.mjs";
import { AI_PROXY_TARGET_HEADER, buildAiProxyHeaders, buildApiUrl, modelOptionName, type AiConfig } from "@/stores/use-config-store";

type DuomiVideoConfig = Pick<AiConfig, "baseUrl" | "apiKey" | "useProxy">;
type DuomiVideoReference = { url?: string; dataUrl: string };
type RequestOptions = { signal?: AbortSignal };

export type DuomiVideoGenerationTask = { id: string; provider: "duomi"; model: string };
export type DuomiVideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: { url: string; mimeType: "video/mp4" } } | { status: "failed"; error: string };

const DUOMI_VIDEO_ERROR = "多米视频生成失败";
const DUOMI_VIDEO_TIMEOUT_ERROR = "多米视频生成超时，请稍后重试";
const DUOMI_VIDEO_REQUEST_TIMEOUT = DUOMI_VIDEO_POLL_INTERVAL_MS * DUOMI_VIDEO_POLL_MAX_ATTEMPTS;

export async function createDuomiVideoGenerationTask(config: DuomiVideoConfig, model: string, prompt: string, references: DuomiVideoReference[], size: string, seconds: string | number, options?: RequestOptions): Promise<DuomiVideoGenerationTask> {
    const signal = options?.signal;
    const modelName = modelOptionName(model);

    try {
        const task = await createDuomiVideoLifecycleTask({
            model: modelName,
            request: {
                model: modelName,
                prompt,
                size,
                seconds,
                referenceUrls: references.map((image) => image.url || image.dataUrl),
            },
            signal,
            create: async ({ path, body, signal: requestSignal }) =>
                (
                    await axios.post<unknown>(duomiApiUrl(config, path), body, {
                        headers: duomiHeaders(config),
                        signal: requestSignal,
                        timeout: DUOMI_VIDEO_REQUEST_TIMEOUT,
                    })
                ).data,
        });
        return { ...task, model };
    } catch (error) {
        throw translateDuomiVideoError(error, signal);
    }
}

export async function pollDuomiVideoGenerationTask(config: DuomiVideoConfig, task: DuomiVideoGenerationTask, options?: RequestOptions): Promise<DuomiVideoGenerationTaskState> {
    const signal = options?.signal;

    try {
        return await pollDuomiVideoLifecycleTask({
            task,
            signal,
            poll: async ({ path, signal: requestSignal }) =>
                (
                    await axios.get<unknown>(duomiApiUrl(config, path), {
                        headers: duomiHeaders(config),
                        signal: requestSignal,
                        timeout: DUOMI_VIDEO_REQUEST_TIMEOUT,
                    })
                ).data,
        });
    } catch (error) {
        throw translateDuomiVideoError(error, signal);
    }
}

function duomiApiUrl(config: DuomiVideoConfig, path: string) {
    const proxyUrl = config.useProxy ? buildApiUrl(config.baseUrl, path, true) : "";
    return duomiRequestUrl(config.baseUrl, path, config.useProxy, proxyUrl);
}

function duomiHeaders(config: DuomiVideoConfig) {
    const proxyHeaders = buildAiProxyHeaders({ baseUrl: config.baseUrl, apiFormat: "openai", useProxy: config.useProxy });
    return duomiRequestHeaders(config.baseUrl, config.apiKey, config.useProxy, proxyHeaders, AI_PROXY_TARGET_HEADER);
}

function translateDuomiVideoError(error: unknown, signal?: AbortSignal): Error {
    if (isAbort(error, signal)) return new DOMException("Aborted", "AbortError");
    if (isDuomiRequestTimeout(error)) return new Error(DUOMI_VIDEO_TIMEOUT_ERROR);
    if (axios.isAxiosError(error)) return new Error(duomiHttpErrorMessage(error));
    if (error instanceof Error) return error;
    return new Error(DUOMI_VIDEO_ERROR);
}

function isAbort(error: unknown, signal?: AbortSignal) {
    return signal?.aborted || axios.isCancel(error) || (error instanceof DOMException && error.name === "AbortError");
}

function duomiHttpErrorMessage(error: { response?: { status?: number; data?: unknown } }) {
    const status = error.response?.status;
    const providerMessage = duomiVideoTaskErrorMessage(error.response?.data);
    if (status === 401 || status === 403) return withProviderMessage("多米视频鉴权失败，请检查 API Key、账户余额或模型权限", providerMessage);
    if (status === 429) return withProviderMessage("多米视频请求被限流或额度不足，请稍后重试", providerMessage);
    return providerMessage || DUOMI_VIDEO_ERROR;
}

function withProviderMessage(message: string, providerMessage: string) {
    if (!providerMessage || message.includes(providerMessage) || providerMessage.includes(message)) return message;
    return `${message}：${providerMessage}`;
}
