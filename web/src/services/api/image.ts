import axios from "axios";

import { type AiConfig } from "@/lib/ai-config";
import { createId } from "@/lib/id";
import { dataUrlToFile } from "@/lib/image-utils";
import { imageToDataUrl } from "@/services/image-storage";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceImage } from "@/types/image";

export type ChatCompletionMessage = {
  role: "user" | "assistant";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

type UpstreamImageItem = Record<string, unknown>;

type UpstreamImageResponse = {
  data?: UpstreamImageItem[];
};

type ImageProxyResult = {
  upstream: UpstreamImageResponse | null;
  remaining: number;
  upstreamMeta?: string;
};

type ApiEnvelope<T> = {
  code: number;
  data: T;
  msg: string;
};

export type GeneratedImage = { id: string; dataUrl: string };

export type GenerationResult = {
  images: GeneratedImage[];
  remaining: number;
  // 后端反代返回的上游响应 raw JSON 字符串（已去除 b64_json 大字段），供 admin 审计落库使用。
  upstreamMeta?: string;
};

function resolveImageDataUrl(item: UpstreamImageItem) {
  if (typeof item.b64_json === "string" && item.b64_json) {
    return `data:image/png;base64,${item.b64_json}`;
  }
  if (typeof item.url === "string" && item.url) {
    return item.url;
  }
  return null;
}

function parseImageResult(result: ImageProxyResult): GenerationResult {
  const images =
    result.upstream?.data
      ?.map(resolveImageDataUrl)
      .filter((value): value is string => Boolean(value))
      .map((dataUrl) => ({ id: createId(), dataUrl })) || [];

  if (images.length === 0) {
    throw new Error("接口没有返回图片");
  }

  if (result.remaining >= 0) {
    useUserStore.getState().setCredits(result.remaining);
  }

  return { images, remaining: result.remaining, upstreamMeta: result.upstreamMeta };
}

// 413 是 nginx 在请求体过大时直接拒绝；此时返回的不是项目自定义 envelope，
// 需要单独识别并给出中文提示，否则用户只能看到"请求失败：413"这种无意义信息。
const OVERSIZE_REQUEST_TIP = "请求体过大（超过 50MB），请压缩参考图或减少同时上传的图片数量";

function describeStatus(status?: number, fallback = "请求失败") {
  if (status === 413) return OVERSIZE_REQUEST_TIP;
  if (status === 401) return "请先登录或重新登录";
  if (status === 504) return "服务器响应超时，请稍后再试";
  return status ? `${fallback}：${status}` : fallback;
}

function readEnvelopeError<T>(envelope: ApiEnvelope<T> | undefined, fallback: string, status?: number) {
  if (envelope && envelope.code !== 0 && envelope.msg) return envelope.msg;
  return describeStatus(status, fallback);
}

function readAxiosError(error: unknown, fallback: string) {
  if (axios.isAxiosError<ApiEnvelope<unknown>>(error)) {
    const envelope = error.response?.data;
    if (envelope && typeof envelope === "object" && "msg" in envelope && envelope.code !== 0) {
      return envelope.msg || describeStatus(error.response?.status, fallback);
    }
    return describeStatus(error.response?.status, fallback);
  }
  return error instanceof Error ? error.message : fallback;
}

function authHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...(extra || {}) };
}

function parseStreamChunk(chunk: string, onDelta: (value: string) => void) {
  let deltaText = "";
  for (const eventBlock of chunk.split("\n\n")) {
    const data = eventBlock.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
    if (!data || data === "[DONE]") continue;
    const delta = (JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content || "";
    deltaText += delta;
  }
  if (deltaText) onDelta(deltaText);
}

export async function requestGeneration(token: string, config: AiConfig, prompt: string): Promise<GenerationResult> {
  const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
  try {
    const response = await axios.post<ApiEnvelope<ImageProxyResult>>(
      "/api/v1/images/generations",
      {
        prompt,
        n,
        quality: config.quality || undefined,
        size: config.size || undefined,
      },
      {
        headers: authHeaders(token, { "Content-Type": "application/json" }),
        validateStatus: () => true,
      },
    );
    if (response.data?.code !== 0) {
      throw new Error(readEnvelopeError(response.data, "请求失败", response.status));
    }
    return parseImageResult(response.data.data);
  } catch (error) {
    throw new Error(readAxiosError(error, "请求失败"));
  }
}

export async function requestEdit(token: string, config: AiConfig, prompt: string, references: ReferenceImage[]): Promise<GenerationResult> {
  const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
  const formData = new FormData();
  formData.set("prompt", prompt);
  formData.set("n", String(n));
  if (config.quality) {
    formData.set("quality", config.quality);
  }
  if (config.size) {
    formData.set("size", config.size);
  }
  const files = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
  files.forEach((file) => formData.append("image", file));

  try {
    const response = await axios.post<ApiEnvelope<ImageProxyResult>>("/api/v1/images/edits", formData, {
      headers: authHeaders(token),
      validateStatus: () => true,
    });
    if (response.data?.code !== 0) {
      throw new Error(readEnvelopeError(response.data, "请求失败", response.status));
    }
    return parseImageResult(response.data.data);
  } catch (error) {
    throw new Error(readAxiosError(error, "请求失败"));
  }
}

export async function requestImageQuestion(token: string, messages: ChatCompletionMessage[], onDelta: (text: string) => void) {
  let buffer = "";
  let answer = "";
  let processedLength = 0;

  try {
    await axios.post(
      "/api/v1/chat/completions",
      {
        messages,
        stream: true,
      },
      {
        headers: authHeaders(token, { "Content-Type": "application/json" }),
        responseType: "text",
        validateStatus: () => true,
        onDownloadProgress: (event) => {
          const responseText = String(event.event?.target?.responseText || "");
          const nextText = responseText.slice(processedLength);
          processedLength = responseText.length;
          buffer += nextText;
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() || "";
          for (const chunk of chunks) {
            parseStreamChunk(chunk, (delta) => {
              answer += delta;
              onDelta(answer);
            });
          }
        },
      },
    );
    if (buffer) {
      parseStreamChunk(buffer, (delta) => {
        answer += delta;
        onDelta(answer);
      });
    }
  } catch (error) {
    throw new Error(readAxiosError(error, "请求失败"));
  }
  return answer || "没有返回内容";
}
