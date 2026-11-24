import axios from "axios";
import { ModelExecutionError, modelErrorMessages, type ModelErrorCode } from "@infinite-canvas/shared/model-http";
import type { CallScript, ModelCapability } from "@infinite-canvas/shared/models";
import type { ModelExecutionConfig } from "@infinite-canvas/shared/model-execution";
import { builtinCallScripts } from "./call-scripts/builtin.js";
import { normalizePluginImages, runScript, type ScriptArgs, type ScriptHost } from "./script.js";
import { audioPluginBlob, videoPluginResult, type VideoScriptResult } from "./media.js";

export type ModelAction = "image" | "audio" | "text" | "video" | "video-query";
export type SavedCallScripts = { scripts: CallScript[]; removedBuiltinIds: string[]; pluginScripts: CallScript[] };
export type ModelInputs = Pick<ScriptArgs, "images" | "videos" | "audios" | "messages">;
export type ModelRun = Pick<ScriptArgs, "prompt" | "options" | "signal" | "onDelta" | "onUpstream"> & {
    action: ModelAction;
    call: { scriptId: string; script: string };
    config: ModelExecutionConfig;
    /** 提交生成时校验调用方式仍可用；查询原任务继续使用提交时的源码。 */
    scripts: SavedCallScripts;
    /** 远端视频任务标识，仅查询时使用。 */
    taskId?: string;
    /** 校验通过后再读取参考素材。 */
    inputs?: (signal?: AbortSignal) => Promise<ModelInputs>;
};
export type ModelResults = {
    image: string[];
    audio: Blob;
    text: string;
    video: { id: string } | { result: VideoScriptResult };
    "video-query": { status: "pending" } | { status: "completed"; result: VideoScriptResult } | { status: "failed"; message?: string };
};

/** 读取服务提供的错误说明；纯文本响应直接作为说明，HTML 错误页不展示。 */
export function getModelErrorMessage(data: unknown): string | undefined {
    if (typeof data === "string") return data && !data.startsWith("<") ? data : undefined;
    if (!data || typeof data !== "object") return undefined;
    const payload = data as { error?: { message?: unknown } | string; message?: unknown };
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message ?? payload.message;
    return typeof message === "string" && message ? message : undefined;
}

function isAbort(error: unknown) {
    return axios.isCancel(error) || (error instanceof DOMException && error.name === "AbortError");
}

/** 尽量展示上游原始报错：服务错误说明 > 纯文本响应 > 请求失败原因；都拿不到时才用错误码的固定文案。 */
export function toModelError(error: unknown, proxied?: ScriptHost["proxied"]) {
    if (error instanceof ModelExecutionError || isAbort(error)) return error;
    if (axios.isAxiosError(error) && !error.response && error.code === "ERR_NETWORK" && error.config?.url && proxied?.(error.config.url)) return new ModelExecutionError("MODEL_PROXY");
    const response = axios.isAxiosError(error) ? error.response : error instanceof Error ? error.cause as { status?: number; data?: unknown } | undefined : undefined;
    const status = response?.status;
    const networkCode = axios.isAxiosError(error) ? error.code : undefined;
    console.warn("Model call failed", { status, code: networkCode, name: error instanceof Error ? error.name : "Error" });
    const message = error instanceof Error ? error.message : "";
    let code: ModelErrorCode = "MODEL_FAILED";
    if (Object.hasOwn(modelErrorMessages, message)) code = message as ModelErrorCode;
    else if (axios.isAxiosError(error) && error.response?.data?.error?.code === "invalid_api_key") code = "MODEL_INVALID_KEY";
    else if (status === 401 || status === 403) code = "MODEL_AUTH";
    else if (status === 429) code = "MODEL_LIMITED";
    else if (status === 404) code = "MODEL_NOT_FOUND";
    else if (status === 502) code = "MODEL_BAD_GATEWAY";
    else if (status === 503) code = "MODEL_BUSY";
    else if (networkCode === "ECONNABORTED" || networkCode === "ETIMEDOUT") code = "MODEL_TIMEOUT";
    else if (axios.isAxiosError(error) && !error.response) code = "MODEL_NETWORK";
    return new ModelExecutionError(code, getModelErrorMessage(response?.data) ?? (axios.isAxiosError(error) ? error.message : undefined));
}

export function assertCallScript(saved: SavedCallScripts, call: ModelRun["call"], capability: ModelCapability) {
    const custom = saved.scripts.find((item) => item.id === call.scriptId) ?? saved.pluginScripts.find((item) => item.id === call.scriptId);
    const script = custom ?? (saved.removedBuiltinIds.includes(call.scriptId) ? undefined : builtinCallScripts.find((item) => item.id === call.scriptId));
    if (!script || script.capability !== capability || script.source !== call.script) throw new ModelExecutionError("MODEL_CONFIG_MISSING");
}

/** 浏览器与本地服务共用的执行入口：校验调用方式、运行脚本、整理返回结果并映射错误码。 */
export async function executeModel<A extends ModelAction>(run: ModelRun & { action: A }, host: ScriptHost): Promise<ModelResults[A]> {
    const { action, signal } = run;
    const capability = (action === "video-query" ? "video" : action) as ModelCapability;
    signal?.throwIfAborted();
    if (action !== "video-query") assertCallScript(run.scripts, run.call, capability);
    const inputs = await run.inputs?.(signal);
    signal?.throwIfAborted();
    const onDelta = run.onDelta && ((text: string) => { signal?.throwIfAborted(); run.onDelta!(text); });
    let result: unknown;
    try {
        result = await runScript({
            ...inputs,
            capability,
            script: run.call.script,
            config: run.config,
            prompt: run.prompt,
            options: run.options,
            signal,
            onDelta,
            onUpstream: run.onUpstream,
            taskId: action === "video-query" ? run.taskId : undefined,
        }, host);
    } catch (error) {
        if (action === "video-query" && axios.isAxiosError(error) && error.response?.status === 200 && error.response.data?.error) {
            return { status: "failed", message: getModelErrorMessage(error.response.data) } as ModelResults[A];
        }
        throw toModelError(error, host.proxied);
    }
    signal?.throwIfAborted();
    return await normalizeResult(action, result, run, host) as ModelResults[A];
}

async function normalizeResult(action: ModelAction, result: unknown, run: ModelRun, host: ScriptHost): Promise<ModelResults[ModelAction]> {
    if (action === "image") return normalizePluginImages(result);
    if (action === "text") {
        if (typeof result !== "string" || !result) throw new ModelExecutionError("MODEL_RESULT_MISSING");
        run.onDelta?.(result);
        return result;
    }
    if (action === "audio") {
        try {
            return await audioPluginBlob(result, run.options!.format as string, host.toBlob);
        } catch (error) {
            run.signal?.throwIfAborted();
            throw error instanceof ModelExecutionError || isAbort(error) ? error : new ModelExecutionError("MODEL_RESULT_MISSING");
        }
    }
    if (action === "video") {
        if (result && typeof result === "object" && "id" in result) {
            if (typeof result.id !== "string" || !result.id) throw new ModelExecutionError("MODEL_RESULT_MISSING");
            return { id: result.id };
        }
        return { result: videoPluginResult(result) };
    }
    const state = result as { status?: string; result?: unknown };
    if (state?.status === "pending") return { status: "pending" };
    if (state?.status === "failed") return { status: "failed", message: getModelErrorMessage(state) };
    if (state?.status === "completed") return { status: "completed", result: videoPluginResult(state.result) };
    throw new ModelExecutionError("MODEL_RESULT_MISSING");
}
