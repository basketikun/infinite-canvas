import { network } from "@workbench/services/network/runtime";
import { modelCapabilityLabels } from "@workbench/constant/labels";
import { runScript, type ScriptHost } from "@infinite-canvas/model-runtime/script";
import { assertCallScript, toModelError } from "@infinite-canvas/model-runtime/execute";
import { createCallScriptSource } from "@infinite-canvas/model-runtime/call-scripts/template";
import { useCallScriptStore } from "@workbench/stores/use-call-script-store";
import { normalizeLocalProxyUrl, useConfigStore } from "@workbench/stores/use-config-store";

import type { ModelCapability } from "@infinite-canvas/shared/models";
import type { ModelCall, ModelExecutionConfig } from "@infinite-canvas/shared/model-execution";

import type { GenerateTextOnStepEndCallback, LanguageModelUsage, ModelMessage, StopCondition, TextStreamPart, ToolSet } from "ai";
import type { TextAgentProtocol } from "@infinite-canvas/shared/model-execution";

export type RunPluginArgs = {
    capability: ModelCapability;
    script: string;
    config: ModelExecutionConfig;
    prompt?: string;
    images?: string[];
    videos?: string[];
    audios?: string[];
    messages?: unknown[];
    tools?: ToolSet;
    stopWhen?: StopCondition<any, any>;
    onAgentStepStart?: () => void;
    onAgentStepEnd?: GenerateTextOnStepEndCallback<ToolSet>;
    onAgentEvent?: (event: TextStreamPart<ToolSet>) => void;
    onReasoningDelta?: (text: string) => void;
    contextTokens?: number;
    compactContext?: boolean;
    onAgentCompacting?: (compacting: boolean) => void;
    onAgentContextCompacted?: (messages: ModelMessage[], usage: LanguageModelUsage) => void;
    options?: Record<string, unknown>;
    signal?: AbortSignal;
    onDelta?: (text: string) => void;
    taskId?: string;
};

/** 聊天工具循环：校验调用方式后运行脚本，回调在停止后不再送达。 */
export async function runModelCall<T = unknown>(args: RunPluginArgs & { config: ModelCall }): Promise<T> {
    assertCallScript(useCallScriptStore.getState(), args.config, args.capability);
    const { signal } = args;
    const guard = <A extends unknown[], V>(callback: ((...values: A) => V) | undefined) => callback && ((...values: A) => { signal?.throwIfAborted(); return callback(...values); });
    signal?.throwIfAborted();
    const result = await runModelPlugin<T>({
        ...args,
        onDelta: guard(args.onDelta), onAgentEvent: guard(args.onAgentEvent),
        onAgentStepStart: guard(args.onAgentStepStart), onAgentStepEnd: guard(args.onAgentStepEnd),
        onAgentCompacting: guard(args.onAgentCompacting), onAgentContextCompacted: guard(args.onAgentContextCompacted),
    });
    signal?.throwIfAborted();
    return result;
}

/** 浏览器读取素材、上传公开链接和识别本地代理的方式。 */
export function createBrowserScriptHost(signal?: AbortSignal): ScriptHost {
    const toBlob = async (source: string | Blob) => {
        if (source instanceof Blob) return source;
        try {
            const response = await fetch(network.url(source), { signal });
            if (!response.ok) throw new Error("Media request failed", { cause: response });
            return await response.blob();
        } catch (error) {
            signal?.throwIfAborted();
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            throw new Error("SCRIPT_REFERENCE_READ_FAILED", { cause: error });
        }
    };
    return {
        mapUrl: network.url,
        toBlob,
        toDataUrl: async (source) => {
            if (typeof source === "string" && source.startsWith("data:")) return source;
            const blob = await toBlob(source);
            return new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = () => reject(new Error("SCRIPT_REFERENCE_READ_FAILED", { cause: reader.error }));
                reader.onabort = () => reject(new DOMException("Aborted", "AbortError"));
                reader.onloadend = () => signal?.removeEventListener("abort", abort);
                const abort = () => reader.abort();
                if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
                signal?.addEventListener("abort", abort, { once: true });
                reader.readAsDataURL(blob);
            });
        },
        toPublicUrl: async (source) => {
            const { toPublicMediaUrl } = await import("@workbench/services/object-storage");
            return toPublicMediaUrl(source, signal);
        },
        proxied: (url) => {
            const proxyBase = normalizeLocalProxyUrl(useConfigStore.getState().config.proxyUrl);
            return network.kind === "browser" && Boolean(proxyBase) && url.startsWith(`${proxyBase}/`);
        },
    };
}

/**
 * 脚本只定义 main(params)，参数与工具通过一个对象提供，不注入零散变量。
 */
export async function runModelPlugin<T = unknown>(args: RunPluginArgs): Promise<T> {
    const host = createBrowserScriptHost(args.signal);
    try {
        return await runScript<T>(args, {
            ...host,
            runTextAgent: async (protocol, settings) => {
                const { runTextAgent } = await import("./text-agent");
                return runTextAgent(protocol as TextAgentProtocol, args, settings as import("./text-agent").TextAgentSettings);
            },
        });
    } catch (error) {
        if (args.tools) throw error;
        throw toModelError(error, host.proxied);
    }
}

export function getPluginAuthoringPrompt(capability: ModelCapability, modelName: string, draft: string) {
    return [
        `为无限画布编写调用脚本，用途：${modelCapabilityLabels[capability]}，模型：${modelName}。`,
        "只定义 async function main(params)，由应用调用，无需手动调用或顶层 return。保留模板中的完整参数注释，按需解构 params；生成设置位于 params.options，辅助方法通过 params.utils 使用。不依赖零散全局变量，不写 import 或 Markdown 围栏，只输出完整源码。\n排版以易读为先：请求配置、请求体等多字段对象逐字段换行，嵌套内容分层缩进；长条件和链式调用分行，条件与循环使用代码块，不把多个字段或处理步骤压在同一行。",
        createCallScriptSource(capability),
        "当前源码（在此基础上修改）",
        draft,
    ].join("\n\n");
}

