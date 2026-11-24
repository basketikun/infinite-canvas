import { audioMimeType } from "@infinite-canvas/model-runtime/media";
import { channelWrites, resolveModelRequestConfig, type AiConfig } from "@workbench/stores/use-config-store";
import { callScriptsReady } from "@workbench/stores/use-call-script-store";
import { models } from "./models/runtime";
import type { ModelRequestOptions } from "./models/types";

export async function requestAudioGeneration(config: AiConfig, prompt: string, options?: ModelRequestOptions): Promise<Blob | string> {
    await Promise.all([callScriptsReady, channelWrites.flush()]);
    const requestConfig = resolveModelRequestConfig(config, config.model || config.audioModel);
    const result = await models.generateAudio({
        call: requestConfig, prompt,
        options: { voice: config.audioVoice, format: config.audioFormat, speed: config.audioSpeed, instructions: config.audioInstructions },
    }, options);
    return typeof result === "string" || result.type.startsWith("audio/") ? result : new Blob([result], { type: audioMimeType(config.audioFormat) });
}
