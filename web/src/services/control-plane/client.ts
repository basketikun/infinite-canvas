import { CONTROL_PLANE_URL } from "@/constant/runtime-config";

type ApiEnvelope<T> = { code: number; data: T; msg: string };
type Fetcher = typeof fetch;

export async function requestControlPlane<T>(path: string, options: RequestInit & { token?: string; baseUrl?: string } = {}, fetcher: Fetcher = fetch): Promise<T> {
    const { baseUrl: configuredBaseUrl, ...requestOptions } = options;
    const baseUrl = (configuredBaseUrl || CONTROL_PLANE_URL).replace(/\/+$/, "");
    if (!baseUrl) throw new Error("未配置控制平面地址");
    const { token, headers, ...init } = requestOptions;
    const response = await fetcher(`${baseUrl}${path}`, {
        ...init,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    });
    const payload = (await response.json()) as ApiEnvelope<T>;
    if (!response.ok || payload.code !== 0) throw new Error(payload.msg || "控制平面请求失败");
    return payload.data;
}
