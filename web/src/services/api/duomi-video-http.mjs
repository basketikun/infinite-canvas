import { duomiRequestHeaders, duomiRequestUrl, isDuomiRequestTimeout } from "./duomi-provider-utils.mjs";
import { DUOMI_VIDEO_POLL_INTERVAL_MS, DUOMI_VIDEO_POLL_MAX_ATTEMPTS, duomiVideoTaskErrorMessage } from "./duomi-video-provider-utils.mjs";

export const DUOMI_VIDEO_TIMEOUT_ERROR = "多米视频生成超时，请稍后重试";

const DUOMI_VIDEO_ERROR = "多米视频生成失败";
const DUOMI_VIDEO_DEADLINE_MS = DUOMI_VIDEO_POLL_INTERVAL_MS * DUOMI_VIDEO_POLL_MAX_ATTEMPTS;

export function duomiVideoDeadlineAt(now = Date.now) {
    return now() + DUOMI_VIDEO_DEADLINE_MS;
}

export function duomiVideoRemainingTimeout(deadlineAt, now = Date.now) {
    const remaining = Number(deadlineAt) - now();
    if (!Number.isFinite(remaining) || remaining <= 0) throw new Error(DUOMI_VIDEO_TIMEOUT_ERROR);
    return Math.max(1, Math.floor(remaining));
}

export function buildDuomiVideoHttpRequest({ baseUrl, apiKey, useProxy, path, deadlineAt, now = Date.now, proxyUrl = "", proxyHeaders = {}, proxyTargetHeader }) {
    return {
        url: duomiRequestUrl(baseUrl, path, useProxy, proxyUrl),
        headers: duomiRequestHeaders(baseUrl, apiKey, useProxy, proxyHeaders, proxyTargetHeader),
        timeout: duomiVideoRemainingTimeout(deadlineAt, now),
    };
}

export function duomiVideoRequestFromInputs({ modelName, prompt, references, size, seconds }) {
    return {
        model: modelName,
        prompt,
        size,
        seconds,
        referenceUrls: references.map((image) => image.url || image.dataUrl),
    };
}

export function withDuomiVideoTaskModel(task, model) {
    return { ...task, model };
}

export function translateDuomiVideoRequestError(error, { signal, isCancellation = false, isHttpError = false } = {}) {
    if (signal?.aborted || isCancellation || (error instanceof DOMException && error.name === "AbortError")) return new DOMException("Aborted", "AbortError");
    if (isDuomiRequestTimeout(error)) return new Error(DUOMI_VIDEO_TIMEOUT_ERROR);
    if (isHttpError) return new Error(duomiVideoHttpErrorMessage(error));
    if (error instanceof Error) return error;
    return new Error(DUOMI_VIDEO_ERROR);
}

function duomiVideoHttpErrorMessage(error) {
    const status = error?.response?.status;
    const providerMessage = duomiVideoTaskErrorMessage(error?.response?.data);
    if (status === 401 || status === 403) return withProviderMessage("多米视频鉴权失败，请检查 API Key、账户余额或模型权限", providerMessage);
    if (status === 429) return withProviderMessage("多米视频请求被限流或额度不足，请稍后重试", providerMessage);
    if (providerMessage) return providerMessage;
    return status ? `${DUOMI_VIDEO_ERROR}（HTTP ${status}）` : DUOMI_VIDEO_ERROR;
}

function withProviderMessage(message, providerMessage) {
    if (!providerMessage || message.includes(providerMessage) || providerMessage.includes(message)) return message;
    return `${message}：${providerMessage}`;
}
