import axios from "axios";

import { networkFailureMessage } from "@/services/api/network-error";
import { buildApiUrl, isNewApiConfig, resolveNewApiGroup, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

/**
 * 构建 AI API 请求 URL。
 * - remote 模式: /api/v1{path}（后端代理）
 * - local/newapi 模式: 直连外部 API
 */
export function aiApiUrl(config: AiConfig, path: string) {
    return config.channelMode === "remote" ? `/api/v1${path}` : buildApiUrl(config.baseUrl, path);
}

/**
 * 构建 AI API 请求头。
 */
export function aiHeaders(config: AiConfig, contentType?: string) {
    const token = useUserStore.getState().token;
    if (config.channelMode === "remote") {
        return {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(contentType ? { "Content-Type": contentType } : {}),
        };
    }
    if (isNewApiConfig(config)) {
        return {
            ...(contentType ? { "Content-Type": contentType } : {}),
        };
    }
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

/**
 * 构建完整的 AI API 请求配置（headers + params + credentials）。
 */
export function aiRequestConfig(config: AiConfig, contentType?: string, params?: Record<string, string>, capability?: ModelCapability) {
    const nextParams = { ...(params || {}) };
    if (isNewApiConfig(config)) nextParams.group = resolveNewApiGroup(config, capability);
    return {
        headers: aiHeaders(config, contentType),
        ...(Object.keys(nextParams).length ? { params: nextParams } : {}),
        ...(isNewApiConfig(config) ? { withCredentials: true } : {}),
    };
}

/**
 * 将系统 prompt 注入到消息列表头部。
 */
export function withSystemMessage<T extends { role: string; content: unknown }>(config: AiConfig, messages: T[]): T[] {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? [{ role: "system", content: systemPrompt } as T, ...messages] : messages;
}

/**
 * 将系统 prompt 拼接到用户 prompt 前。
 */
export function withSystemPrompt(config: AiConfig, prompt: string) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

/**
 * remote 模式下刷新用户余额（扣费后）。
 */
export function refreshRemoteUser(config: AiConfig) {
    if (config.channelMode === "remote") void useUserStore.getState().hydrateUser();
}

/**
 * 从 axios 错误中提取可读信息。
 */
export function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; code?: number }>(error)) {
        const responseData = error.response?.data;
        const message = responseData?.error?.message || responseData?.msg;
        if (message) return message;
        if (error.response) return readStatusError(error.response.status, fallback);
        return networkFailureMessage({
            fallback,
            code: error.code,
            requestUrl: error.config?.url,
            pageProtocol: typeof window === "undefined" ? undefined : window.location.protocol,
        });
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return error instanceof Error ? error.message : fallback;
}

function readStatusError(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查登录状态、分组、API Key 或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}：${status}` : fallback;
}
