import axios from "axios";

import { audioMimeType, normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@/lib/audio-generation";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { buildApiUrl, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

type RequestOptions = { signal?: AbortSignal };
type AudioChatResponse = { choices?: Array<{ message?: { audio?: { data?: string } } }>; error?: { message?: string } };

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "X-Canvas-Capability": "audio",
    };
}

export async function requestAudioGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<Blob> {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.audioModel);
    const model = requestConfig.model.trim();
    assertAudioConfig(requestConfig, model);
    const format = normalizeAudioFormatValue(config.audioFormat);

    try {
        if (model.startsWith("gpt-4o-audio")) return await requestAudioChatCompletion(requestConfig, prompt, format, options);
        const response = await axios.post<Blob>(
            aiApiUrl(requestConfig, "/audio/speech"),
            {
                model,
                input: prompt,
                voice: normalizeAudioVoiceValue(config.audioVoice),
                response_format: format,
                speed: Number(normalizeAudioSpeedValue(config.audioSpeed)),
                ...(config.audioInstructions.trim() ? { instructions: config.audioInstructions.trim() } : {}),
            },
            { headers: aiHeaders(requestConfig), responseType: "blob", signal: options?.signal },
        );
        await assertAudioBlob(response.data);
        return response.data.type.startsWith("audio/") ? response.data : new Blob([response.data], { type: audioMimeType(format) });
    } catch (error) {
        throw new Error(readAxiosError(error, "音频生成失败"));
    }
}

async function requestAudioChatCompletion(config: AiConfig, prompt: string, format: string, options?: RequestOptions) {
    const speed = normalizeAudioSpeedValue(config.audioSpeed);
    const instructions = [config.audioInstructions.trim(), speed === "1" ? "" : "请以 " + speed + " 倍语速朗读。"].filter(Boolean).join("\n");
    const response = await axios.post<AudioChatResponse>(
        aiApiUrl(config, "/chat/completions"),
        {
            model: config.model,
            modalities: ["text", "audio"],
            messages: [...(instructions ? [{ role: "system", content: instructions }] : []), { role: "user", content: prompt }],
            audio: { voice: normalizeAudioVoiceValue(config.audioVoice), format: format === "pcm" ? "pcm16" : format },
        },
        { headers: aiHeaders(config), signal: options?.signal },
    );
    const data = response.data.choices?.[0]?.message?.audio?.data;
    if (!data) throw new Error(response.data.error?.message || "音频模型没有返回音频数据");
    return base64AudioBlob(data, format);
}

export async function storeGeneratedAudio(blob: Blob, format = "mp3"): Promise<UploadedFile> {
    const audio = blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
    return uploadMediaFile(audio, "audio");
}

function base64AudioBlob(data: string, format: string) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: audioMimeType(format) });
}

function assertAudioConfig(config: AiConfig, model: string) {
    if (!model) throw new Error("请先配置音频模型");
    if (!config.baseUrl.trim()) throw new Error("模型服务配置异常，请刷新页面后重试");
    if (!config.apiKey.trim()) throw new Error("登录授权配置异常，请重新登录");
    if (config.apiFormat === "gemini") throw new Error("Gemini 调用格式暂不支持音频生成，请使用 OpenAI 格式渠道");
}

async function assertAudioBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "音频生成失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; code?: number }>(error)) {
        const responseData = error.response?.data;
        return responseData?.msg || responseData?.error?.message || statusMessage(error.response?.status, fallback);
    }
    return error instanceof Error ? error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "登录授权已失效，或账号套餐/模型权限不足";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}（${status}）` : fallback;
}
