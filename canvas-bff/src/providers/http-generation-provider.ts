import { isIP } from "node:net";

import type {
  GenerationProvider,
  ProviderResult,
} from "../worker/generation-worker.js";
import type { GenerationRecord } from "../generations/repository.js";
import { ProviderSecretBox } from "../crypto/secret-box.js";
import type { ProviderRepository } from "./repository.js";

type FetchLike = typeof fetch;

export class HttpGenerationProvider implements GenerationProvider {
  private readonly baseUrl: string;
  private readonly providers: ProviderRepository;
  private readonly secretBox: ProviderSecretBox;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs?: number;

  constructor(options: {
    baseUrl: string;
    providers: ProviderRepository;
    secretBox: ProviderSecretBox;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.providers = options.providers;
    this.secretBox = options.secretBox;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs;
  }

  async start(generation: GenerationRecord): Promise<ProviderResult> {
    const context = await this.providerContext(generation);
    if (!context)
      return {
        status: "failed",
        retryable: false,
        errorCode: "PROVIDER_NOT_FOUND",
      };
    if (generation.kind === "image")
      return this.image(context.baseUrl, context.secret, generation, context.allowExternalOutputUrl);
    if (generation.kind === "audio")
      return this.audio(context.baseUrl, context.secret, generation);
    if (generation.kind === "video")
      return this.videoStart(context.baseUrl, context.secret, generation, context.allowExternalOutputUrl);
    return this.text(context.baseUrl, context.secret, generation);
  }

  async poll(generation: GenerationRecord): Promise<ProviderResult> {
    const context = await this.providerContext(generation);
    if (!context)
      return {
        status: "failed",
        retryable: false,
        errorCode: "PROVIDER_NOT_FOUND",
      };
    if (!generation.providerTaskId)
      return {
        status: "failed",
        retryable: false,
        errorCode: "PROVIDER_TASK_MISSING",
      };
    const response = await this.request(
      context.baseUrl,
      `/v1/videos/${encodeURIComponent(generation.providerTaskId)}`,
      context.secret,
    );
    if (!response.ok) return httpFailure(response.status);
    const payload = await jsonBody(response);
    const data = recordValue(payload.data);
    const status = stringValue(payload.status ?? data.status)?.toLowerCase();
    if (
      ["queued", "pending", "running", "in_progress", "processing"].includes(
        status || "",
      )
    ) {
      return {
        status: "pending",
        providerTaskId: generation.providerTaskId,
        progress: numberValue(payload.progress ?? data.progress) ?? 0,
      };
    }
    if (["failed", "cancelled", "canceled", "expired"].includes(status || ""))
      return {
        status: "failed",
        retryable: false,
        errorCode:
          status === "cancelled" || status === "canceled"
            ? "PROVIDER_CANCELLED"
            : status === "expired"
              ? "PROVIDER_EXPIRED"
              : "PROVIDER_FAILED",
      };
    if (
      status === "done" ||
      status === "completed" ||
      status === "succeeded" ||
      (!status && mediaUrl(payload))
    ) {
      return this.downloadCompletedVideo(
        context.baseUrl,
        generation.providerTaskId,
        payload,
        context.secret,
        context.allowExternalOutputUrl,
      );
    }
    return {
      status: "failed",
      retryable: false,
      errorCode: "PROVIDER_STATUS_UNKNOWN",
    };
  }

  private async image(
    baseUrl: string,
    secret: string,
    generation: GenerationRecord,
    allowExternalOutputUrl: boolean,
  ): Promise<ProviderResult> {
    const response = await this.request(baseUrl, "/v1/images/generations", secret, {
      method: "POST",
      body: {
        model: inputString(generation, "model") || "gpt-image-1",
        prompt: inputString(generation, "prompt"),
        n: inputNumber(generation, "count") ?? 1,
        size: inputString(generation, "size") || undefined,
        response_format: "b64_json",
      },
    });
    if (!response.ok) return httpFailure(response.status);
    const payload = await jsonBody(response);
    const first = arrayValue(payload.data)[0];
    const encoded = stringValue(first?.b64_json ?? first?.base64);
    if (encoded)
      return {
        status: "succeeded",
        data: Buffer.from(encoded, "base64"),
        contentType: "image/png",
      };
    const url = stringValue(first?.url) || mediaUrl(payload);
    return url
      ? this.download(baseUrl, url, secret, "image/png", allowExternalOutputUrl)
      : {
          status: "failed",
          retryable: false,
          errorCode: "PROVIDER_EMPTY_OUTPUT",
        };
  }

  private async audio(
    baseUrl: string,
    secret: string,
    generation: GenerationRecord,
  ): Promise<ProviderResult> {
    const response = await this.request(baseUrl, "/v1/audio/speech", secret, {
      method: "POST",
      body: {
        model: inputString(generation, "model") || "gpt-4o-mini-tts",
        input: inputString(generation, "prompt"),
        voice: inputString(generation, "voice") || "alloy",
        response_format: inputString(generation, "format") || "mp3",
      },
    });
    if (!response.ok) return httpFailure(response.status);
    return {
      status: "succeeded",
      data: Buffer.from(await response.arrayBuffer()),
      contentType:
        response.headers.get("content-type")?.split(";", 1)[0] || "audio/mpeg",
    };
  }

  private async videoStart(
    baseUrl: string,
    secret: string,
    generation: GenerationRecord,
    allowExternalOutputUrl: boolean,
  ): Promise<ProviderResult> {
    const response = await this.request(baseUrl, "/v1/videos", secret, {
      method: "POST",
      body: {
        model: inputString(generation, "model") || "sora-2",
        prompt: inputString(generation, "prompt"),
        seconds: inputString(generation, "seconds") || undefined,
        size: inputString(generation, "size") || undefined,
      },
    });
    if (!response.ok) return httpFailure(response.status);
    const payload = await jsonBody(response);
    const data = recordValue(payload.data);
    const id = stringValue(
      payload.id ?? payload.request_id ?? data.id ?? data.request_id,
    );
    const status = stringValue(payload.status ?? data.status)?.toLowerCase();
    if (!id && mediaUrl(payload))
      return this.download(baseUrl, mediaUrl(payload)!, secret, "video/mp4", allowExternalOutputUrl);
    if (!id)
      return {
        status: "failed",
        retryable: false,
        errorCode: "PROVIDER_TASK_MISSING",
      };
    if (["completed", "succeeded", "done"].includes(status || ""))
      return this.downloadCompletedVideo(baseUrl, id, payload, secret, allowExternalOutputUrl);
    return {
      status: "pending",
      providerTaskId: id,
      progress: numberValue(payload.progress ?? data.progress) ?? 0,
    };
  }

  private async text(
    baseUrl: string,
    secret: string,
    generation: GenerationRecord,
  ): Promise<ProviderResult> {
    const response = await this.request(baseUrl, "/v1/chat/completions", secret, {
      method: "POST",
      body: {
        model: inputString(generation, "model") || "gpt-4o-mini",
        messages: [
          { role: "user", content: inputString(generation, "prompt") },
        ],
      },
    });
    if (!response.ok) return httpFailure(response.status);
    const payload = await jsonBody(response);
    const firstChoice = arrayValue(payload.choices)[0];
    const message = recordValue(firstChoice?.message);
    const content = stringValue(
      message.content ?? recordValue(payload.data).content,
    );
    return content
      ? {
          status: "succeeded",
          data: content,
          contentType: "text/plain; charset=utf-8",
        }
      : {
          status: "failed",
          retryable: false,
          errorCode: "PROVIDER_EMPTY_OUTPUT",
        };
  }

  private async download(
    baseUrl: string,
    url: string,
    secret: string,
    fallbackContentType: string,
    allowExternalOutputUrl = false,
  ): Promise<ProviderResult> {
    if (!this.isAllowedOutputUrl(baseUrl, url, allowExternalOutputUrl))
      return {
        status: "failed",
        retryable: false,
        errorCode: "PROVIDER_OUTPUT_URL_NOT_ALLOWED",
      };
    const isExternal = this.isExternalOutputUrl(baseUrl, url);
    const response = await this.request(baseUrl, url, secret, {
      withAuthorization: !isExternal,
    });
    if (!response.ok) return httpFailure(response.status);
    return {
      status: "succeeded",
      data: Buffer.from(await response.arrayBuffer()),
      contentType:
        response.headers.get("content-type")?.split(";", 1)[0] ||
        fallbackContentType,
      ...(isAbsoluteHttpUrl(url) ? { providerUrl: url } : {}),
    };
  }

  private downloadCompletedVideo(
    baseUrl: string,
    taskId: string,
    payload: Record<string, unknown>,
    secret: string,
    allowExternalOutputUrl = false,
  ): Promise<ProviderResult> {
    const url = mediaUrl(payload);
    return this.download(
      baseUrl,
      url && this.isAllowedOutputUrl(baseUrl, url, allowExternalOutputUrl)
        ? url
        : `/v1/videos/${encodeURIComponent(taskId)}/content`,
      secret,
      "video/mp4",
      allowExternalOutputUrl,
    );
  }

  private isAllowedOutputUrl(
    baseUrl: string,
    url: string,
    allowExternalOutputUrl = false,
  ): boolean {
    try {
      const parsed = new URL(url, baseUrl);
      const base = new URL(baseUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
      if (parsed.origin === base.origin) return true;
      return allowExternalOutputUrl && isSafeExternalOutputUrl(parsed);
    } catch {
      return false;
    }
  }

  private isExternalOutputUrl(baseUrl: string, url: string): boolean {
    try {
      return new URL(url, baseUrl).origin !== new URL(baseUrl).origin;
    } catch {
      return false;
    }
  }

  private async providerContext(
    generation: GenerationRecord,
  ): Promise<
    | { baseUrl: string; secret: string; allowExternalOutputUrl: boolean }
    | undefined
  > {
    const provider = await this.providers.get(
      generation.accountId,
      generation.providerId,
    );
    if (!provider || provider.status !== "active") return undefined;
    try {
      return {
        baseUrl: provider.baseUrl || this.baseUrl,
        secret: this.secretBox.decrypt(provider.secret),
        allowExternalOutputUrl: Boolean(provider.sub2ApiKeyId),
      };
    } catch {
      return undefined;
    }
  }

  private async request(
    baseUrl: string,
    path: string,
    secret: string,
    options: { method?: string; body?: unknown; withAuthorization?: boolean } = {},
  ): Promise<Response> {
    const controller =
      this.timeoutMs && this.timeoutMs > 0 ? new AbortController() : undefined;
    const timeout = controller
      ? setTimeout(() => controller.abort(), this.timeoutMs)
      : undefined;
    try {
      return await this.fetchImpl(
        path.startsWith("http") ? path : `${baseUrl}${path}`,
        {
          method: options.method ?? "GET",
          headers: {
            Accept: "application/json",
            ...(options.withAuthorization === false || !secret
              ? {}
              : { Authorization: `Bearer ${secret}` }),
            ...(options.body ? { "Content-Type": "application/json" } : {}),
          },
          ...(options.body ? { body: JSON.stringify(options.body) } : {}),
          ...(controller ? { signal: controller.signal } : {}),
        },
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError")
        return new Response(null, { status: 504 });
      return new Response(null, { status: 503 });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

function httpFailure(status: number): ProviderResult {
  return {
    status: "failed",
    retryable:
      status === 408 || status === 425 || status === 429 || status >= 500,
    errorCode: `UPSTREAM_HTTP_${status}`,
  };
}
async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
function inputString(generation: GenerationRecord, key: string): string {
  const value = generation.input[key];
  return typeof value === "string"
    ? value.trim()
    : value === undefined || value === null
      ? ""
      : String(value);
}
function inputNumber(
  generation: GenerationRecord,
  key: string,
): number | undefined {
  const value = Number(generation.input[key]);
  return Number.isFinite(value) ? value : undefined;
}
function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object"),
      )
    : [];
}
function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
function mediaUrl(payload: Record<string, unknown>): string | undefined {
  const data =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : undefined;
  const video =
    payload.video &&
    typeof payload.video === "object" &&
    !Array.isArray(payload.video)
      ? (payload.video as Record<string, unknown>)
      : undefined;
  return stringValue(
    payload.url ??
      payload.video_url ??
      payload.result_url ??
      data?.url ??
      data?.video_url ??
      data?.result_url ??
      video?.url ??
      video?.video_url ??
      video?.result_url,
  );
}

function isAbsoluteHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function isSafeExternalOutputUrl(url: URL): boolean {
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  )
    return false;
  const version = isIP(hostname);
  return version === 0
    ? true
    : version === 4
      ? !isPrivateIPv4(hostname)
      : !isPrivateIPv6(hostname);
}

function isPrivateIPv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateIPv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIPv4(normalized.slice("::ffff:".length));
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized)
  );
}
