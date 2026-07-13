import axios from "axios";

import { createDuomiVideoLifecycleTask, pollDuomiVideoLifecycleTask } from "@/services/api/duomi-video-lifecycle.mjs";
import { buildDuomiVideoHttpRequest, duomiVideoRequestFromInputs, translateDuomiVideoRequestError, withDuomiVideoTaskModel } from "@/services/api/duomi-video-http.mjs";
import { AI_PROXY_TARGET_HEADER, buildAiProxyHeaders, buildApiUrl, modelOptionName, type AiConfig } from "@/stores/use-config-store";
import type { DuomiVideoGenerationTask, DuomiVideoGenerationTaskState } from "@/services/api/duomi-video-lifecycle.mjs";

export type { DuomiVideoGenerationTask, DuomiVideoGenerationTaskState } from "@/services/api/duomi-video-lifecycle.mjs";

type DuomiVideoConfig = Pick<AiConfig, "baseUrl" | "apiKey" | "useProxy">;
type DuomiVideoReference = { url?: string; dataUrl: string };
type RequestOptions = { signal?: AbortSignal };

export async function createDuomiVideoGenerationTask(config: DuomiVideoConfig, model: string, prompt: string, references: DuomiVideoReference[], size: string, seconds: string | number, options?: RequestOptions): Promise<DuomiVideoGenerationTask> {
    const signal = options?.signal;
    const modelName = modelOptionName(model);

    try {
        const task = await createDuomiVideoLifecycleTask({
            model: modelName,
            request: duomiVideoRequestFromInputs({ modelName, prompt, references, size, seconds }),
            signal,
            create: async ({ path, body, signal: requestSignal, deadlineAt }) => {
                const requestConfig = duomiHttpRequest(config, path, deadlineAt);
                return (await axios.post<unknown>(requestConfig.url, body, { headers: requestConfig.headers, signal: requestSignal, timeout: requestConfig.timeout })).data;
            },
        });
        return withDuomiVideoTaskModel(task, model);
    } catch (error) {
        throw translateDuomiVideoRequestError(error, { signal, isCancellation: axios.isCancel(error), isHttpError: axios.isAxiosError(error) });
    }
}

export async function pollDuomiVideoGenerationTask(config: DuomiVideoConfig, task: DuomiVideoGenerationTask, options?: RequestOptions): Promise<DuomiVideoGenerationTaskState> {
    const signal = options?.signal;

    try {
        return await pollDuomiVideoLifecycleTask({
            task,
            signal,
            poll: async ({ path, signal: requestSignal, deadlineAt }) => {
                const requestConfig = duomiHttpRequest(config, path, deadlineAt);
                return (await axios.get<unknown>(requestConfig.url, { headers: requestConfig.headers, signal: requestSignal, timeout: requestConfig.timeout })).data;
            },
        });
    } catch (error) {
        throw translateDuomiVideoRequestError(error, { signal, isCancellation: axios.isCancel(error), isHttpError: axios.isAxiosError(error) });
    }
}

function duomiHttpRequest(config: DuomiVideoConfig, path: string, deadlineAt: number) {
    const proxyUrl = config.useProxy ? buildApiUrl(config.baseUrl, path, true) : "";
    const proxyHeaders = buildAiProxyHeaders({ baseUrl: config.baseUrl, apiFormat: "openai", useProxy: config.useProxy });
    return buildDuomiVideoHttpRequest({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        useProxy: config.useProxy,
        path,
        deadlineAt,
        proxyUrl,
        proxyHeaders,
        proxyTargetHeader: AI_PROXY_TARGET_HEADER,
    });
}
