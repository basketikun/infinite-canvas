import axios from "axios";

type ApiErrorBody = {
    error?: { message?: string };
    msg?: string;
    message?: string;
    code?: number | string;
    response?: { error?: { message?: string } };
};

export function readAxiosApiError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<ApiErrorBody>(error)) {
        const detail = readApiErrorMessage(error.response?.data);
        if (detail) return `${fallback}：${detail}`;
        if (error.response) return fallbackWithStatus(fallback, error.response.status);
        return error.message ? `${fallback}：${error.message}` : fallback;
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return error instanceof Error ? error.message : fallback;
}

export async function readFetchApiError(response: Response, fallback: string) {
    const detail = await response.text().catch(() => "");
    if (!detail) return fallbackWithStatus(fallback, response.status);
    try {
        const data = JSON.parse(detail) as ApiErrorBody;
        return readApiErrorMessage(data) || fallbackWithStatus(fallback, response.status);
    } catch {
        return `${fallbackWithStatus(fallback, response.status)} ${detail.slice(0, 200)}`;
    }
}

function readApiErrorMessage(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    const data = value as ApiErrorBody;
    return data.error?.message || data.msg || data.message || data.response?.error?.message || "";
}

function fallbackWithStatus(fallback: string, status?: number) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}：${status}` : fallback;
}
