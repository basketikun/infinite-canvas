import type { GenerateVideoInput, ModelsCapability, ModelCapability, TasksCapability } from "@infinite-canvas/plugin-sdk";
import type { CapabilityCallContext } from "@infinite-canvas/plugin-sdk/runtime";
import type { AiTextMessage } from "@infinite-canvas/shared/model-execution";
import { requestEdit, requestGeneration, requestImageQuestion } from "@workbench/services/api/image";
import { requestVideoGeneration, storeGeneratedVideo } from "@workbench/services/api/video";
import { imageToDataUrl } from "@workbench/services/image-storage";
import { getModelConfigIssue, modelOptionLabel, selectableModelsByCapability, useConfigStore, type AiConfig } from "@workbench/stores/use-config-store";
import { buildGenerationConfig } from "@workbench/lib/canvas/canvas-generation-helpers";
import { capabilityCaller } from "./capability-caller";
import { openedWorkSignal } from "./project-data";
import { readPluginVideoTask, submitPluginVideo } from "./video-tasks";

function modelConfig(capability: ModelCapability, model: string | undefined, overrides?: Partial<AiConfig>) {
    const state = useConfigStore.getState();
    const config = { ...buildGenerationConfig({ ...state.config, channelMode: "local" }, undefined, capability), ...(model === undefined ? {} : { model }), ...overrides };
    const issue = getModelConfigIssue(config, config.model);
    if (issue) {
        state.openConfigDialog(true, "builtin:channels", config.model);
        throw new Error(issue.message);
    }
    return config;
}

function references(values: string[]) {
    return values.map((dataUrl, index) => ({ id: `plugin-ref-${index}`, name: `ref-${index}.png`, type: "image/png", dataUrl }));
}

function videoConfig(input: GenerateVideoInput) {
    return modelConfig("video", input.model, {
        ...(input.size === undefined ? {} : { size: input.size }),
        ...(input.seconds === undefined ? {} : { videoSeconds: input.seconds }),
    });
}

function taskRequest(context: CapabilityCallContext, workId?: string, inputSignal?: AbortSignal) {
    const { pluginId, packageName, scope } = capabilityCaller(context);
    const signals = [context.signal];
    if (workId !== undefined) signals.push(openedWorkSignal(scope.signal, workId));
    if (inputSignal) signals.push(inputSignal);
    const signal = AbortSignal.any(signals);
    signal.throwIfAborted();
    return { owner: { pluginId, packageName, projectId: scope.projectId, workId }, signal };
}

export const workspaceTaskMethods: TasksCapability = {
    read(handle, context) {
        const { owner, signal } = taskRequest(context, handle.workId);
        return readPluginVideoTask(owner, handle, signal);
    },
};

/** 工作区与项目使用同一模型服务，实际请求继续交给当前 ModelAdapter。 */
export const workspaceModelMethods: ModelsCapability = {
    async generateImage(input, context) {
        const signal = input.signal ? AbortSignal.any([context.signal, input.signal]) : context.signal;
        signal.throwIfAborted();
        const config = modelConfig("image", input.model, { count: String(input.count ?? 1), ...(input.size === undefined ? {} : { size: input.size }) });
        const images = references(input.references ?? []);
        const items = images.length ? await requestEdit(config, input.prompt, images, { signal }) : await requestGeneration(config, input.prompt, { signal });
        const result = await Promise.all(items.map(async item => {
            try { return await imageToDataUrl({ dataUrl: item.dataUrl }, { signal }); }
            catch (error) { if (signal.aborted) throw error; return item.dataUrl; }
        }));
        signal.throwIfAborted();
        return { images: result };
    },
    async generateVideo(input, context) {
        const signal = input.signal ? AbortSignal.any([context.signal, input.signal]) : context.signal;
        signal.throwIfAborted();
        const config = videoConfig(input);
        const result = await requestVideoGeneration(config, input.prompt, references(input.references ?? []), { signal });
        signal.throwIfAborted();
        const file = await storeGeneratedVideo(result, signal);
        signal.throwIfAborted();
        return { ...(file.storageKey ? { storageKey: file.storageKey } : { url: file.url }), mimeType: file.mimeType, width: file.width, height: file.height, durationMs: file.durationMs };
    },
    async submitVideo(input, context) {
        const { owner, signal } = taskRequest(context, input.workId, input.signal);
        return submitPluginVideo(owner, videoConfig(input), input.prompt, references(input.references ?? []), signal);
    },
    async generateText(input, context) {
        const signal = input.signal ? AbortSignal.any([context.signal, input.signal]) : context.signal;
        signal.throwIfAborted();
        const config = modelConfig("text", input.model);
        const messages: AiTextMessage[] = [...(input.system === undefined ? [] : [{ role: "system" as const, content: input.system }]), { role: "user", content: input.prompt }];
        const text = await requestImageQuestion(config, messages, delta => { signal.throwIfAborted(); input.onDelta?.(delta); }, { signal });
        signal.throwIfAborted();
        return { text };
    },
    listModels({ capability }, { signal }) {
        signal.throwIfAborted();
        const config = useConfigStore.getState().config;
        return selectableModelsByCapability(config, capability).map(value => ({ value, label: modelOptionLabel(config, value) }));
    },
    defaultModel({ capability }, { signal }) {
        signal.throwIfAborted();
        return buildGenerationConfig(useConfigStore.getState().config, undefined, capability).model;
    },
};
