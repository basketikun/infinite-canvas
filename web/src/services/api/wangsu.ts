import axios from "axios";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { dataUrlToFile } from "@/lib/image-utils";
import { imageToDataUrl } from "@/services/image-storage";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

/**
 * 网宿(wangsu) AI 网关图片供应商。
 *
 * 单一 baseUrl + 固定账号前缀，代理三类模型：
 *  - Gemini 生图（chat completions, modalities:["image"]）→ 鉴权用主 apiKey
 *  - 豆包 Seedream 文生图/图生图（/doubaosd/images/generations、/dobao-edit/images/edits）→ 鉴权用 doubaoApiKey / doubaoEditApiKey
 *  - GPT-Image-2（走豆包文生图接口，但返回 b64_json，尺寸按 GPT-Image-2 规则 clamp）
 *
 * 实现逻辑移植自 comfyui-rick-launcher backend-api 的 WangsuImageProvider。
 */

const WANGSU_API_PREFIX = "/v1/b2646c784575449c0fa8d73bb583cbd9";
const CHAT_PATH = "/gemini/chat/completions";
const TEXT_TO_IMAGE_PATH = "/doubaosd/images/generations";
const IMAGE_EDIT_PATH = "/dobao-edit/images/edits";

const GEMINI_IMAGE_MODELS = new Set(["gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview"]);

const DOUBAO_MIN_TOTAL_PIXELS = 921600;
const DOUBAO_MAX_TOTAL_PIXELS = 16_777_216;
const GPT_IMAGE_2_MAX_EDGE = 3840;
const GPT_IMAGE_2_MAX_TOTAL_PIXELS = 8_294_400;
const GPT_IMAGE_2_SIZE_STEP = 16;

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

type RequestOptions = { signal?: AbortSignal };

export type WangsuConfig = AiConfig & { extraSecrets?: Record<string, string> };

type WangsuChatPart = { type?: string; text?: string; image_url?: { url?: string } | string; b64_json?: string };
type WangsuChatMessage = { content?: string | WangsuChatPart[] };
type WangsuChatChoice = { message?: WangsuChatMessage };
type WangsuChatResponse = { choices?: WangsuChatChoice[]; error?: { message?: string }; code?: number; msg?: string };
type WangsuImageResponse = { data?: Array<Record<string, unknown>>; error?: { message?: string }; code?: number; msg?: string };

export type WangsuImageResult = { id: string; dataUrl: string };

export function isWangsuConfig(config: Pick<AiConfig, "apiFormat">) {
    return config.apiFormat === "wangsu";
}

function isGeminiImageModel(model: string) {
    return GEMINI_IMAGE_MODELS.has(model.trim().toLowerCase());
}

function isGptImage2Model(model: string) {
    const value = model.trim().toLowerCase();
    return value === "gpt-image-2" || value.startsWith("gpt-image-2-");
}

function extraSecrets(config: WangsuConfig) {
    return config.extraSecrets && typeof config.extraSecrets === "object" ? config.extraSecrets : {};
}

function geminiApiKey(config: WangsuConfig) {
    const key = String(config.apiKey || "").trim();
    if (!key) throw new Error(apiText("wangsuGeminiKeyRequired"));
    return key;
}

function doubaoApiKey(config: WangsuConfig) {
    const key = String(extraSecrets(config).doubaoApiKey || config.apiKey || "").trim();
    if (!key) throw new Error(apiText("wangsuDoubaoKeyRequired"));
    return key;
}

function editApiKey(config: WangsuConfig) {
    const secrets = extraSecrets(config);
    const key = String(secrets.doubaoEditApiKey || secrets.doubaoApiKey || config.apiKey || "").trim();
    if (!key) throw new Error(apiText("wangsuEditKeyRequired"));
    return key;
}

/** baseUrl 已带账号前缀则直接拼接，否则自动补前缀（对齐参考 _build_prefixed_url）。 */
function wangsuApiUrl(baseUrl: string, path: string) {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    const withPrefix = normalized.endsWith(WANGSU_API_PREFIX) ? normalized : `${normalized}${WANGSU_API_PREFIX}`;
    return `${withPrefix}${path}`;
}

function wangsuJsonHeaders(apiKey: string) {
    return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

/** quality（auto/low/medium/high）→ 网宿分辨率 label（1K/2K/4K）。 */
function resolveWangsuResolution(quality: string | undefined) {
    const value = String(quality || "")
        .trim()
        .toLowerCase();
    if (value === "low") return "1K";
    if (value === "medium") return "2K";
    if (value === "high") return "4K";
    return "1K";
}

/** size（比例串或 WxH）→ 网宿 aspect_ratio；AUTO 表示不显式指定。 */
function resolveWangsuAspectRatio(size: string | undefined) {
    const value = String(size || "").trim();
    if (!value || value.toLowerCase() === "auto") return "AUTO";
    if (value.includes(":")) return value;
    const dims = value.match(/^(\d+)x(\d+)$/);
    if (!dims) return "AUTO";
    const width = Number(dims[1]);
    const height = Number(dims[2]);
    if (!width || !height) return "AUTO";
    const ratio = width / height;
    const options: Array<[string, number]> = [
        ["1:1", 1],
        ["2:3", 2 / 3],
        ["3:2", 3 / 2],
        ["3:4", 3 / 4],
        ["4:3", 4 / 3],
        ["4:5", 4 / 5],
        ["5:4", 5 / 4],
        ["9:16", 9 / 16],
        ["16:9", 16 / 9],
        ["21:9", 21 / 9],
    ];
    return options.reduce((best, item) => (Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best), options[0])[0];
}

/** 由 quality + size 得出网宿可用的显式像素尺寸（对齐参考 _convert_size_for_model）。 */
function convertSizeForModel(quality: string | undefined, size: string | undefined, model: string) {
    const converted = convertDoubaoSize(resolveWangsuResolution(quality), resolveWangsuAspectRatio(size));
    return isGptImage2Model(model) ? clampGptImage2Size(converted) : converted;
}

/** 移植 _convert_doubao_size：把「分辨率 + 比例」换算成满足豆包像素约束的 WxH。 */
function convertDoubaoSize(resolution: string | undefined, aspectRatio: string | undefined) {
    const resolutionMap: Record<string, number> = { "1K": 1920, "2K": 2048, "4K": 4096 };
    const baseSize = resolutionMap[String(resolution || "1K").toUpperCase()] ?? 1920;

    const aspectRatioMap: Record<string, [number, number]> = {
        "1:1": [baseSize, baseSize],
        "2:3": [baseSize, Math.round(baseSize * 1.5)],
        "3:2": [Math.round(baseSize * 1.5), baseSize],
        "3:4": [baseSize, Math.round(baseSize * 1.333)],
        "4:3": [Math.round(baseSize * 1.333), baseSize],
        "4:5": [baseSize, Math.round(baseSize * 1.25)],
        "5:4": [Math.round(baseSize * 1.25), baseSize],
        "9:16": [Math.round(baseSize * 0.5625), baseSize],
        "16:9": [baseSize, Math.round(baseSize * 0.5625)],
        "21:9": [baseSize, Math.round((baseSize * 9) / 21)],
        ORIGINAL: [baseSize, baseSize],
        AUTO: [baseSize, baseSize],
    };

    const normalizedRatio = ["ORIGINAL", "AUTO"].includes(String(aspectRatio || "").toUpperCase()) ? "1:1" : String(aspectRatio || "1:1");
    const [rawWidth, rawHeight] = aspectRatioMap[normalizedRatio] ?? [baseSize, baseSize];
    let width = rawWidth;
    let height = rawHeight;

    const totalPixels = Math.max(width * height, 1);
    const ratio = height ? width / height : 1;
    if (totalPixels < DOUBAO_MIN_TOTAL_PIXELS) {
        const scale = Math.sqrt(DOUBAO_MIN_TOTAL_PIXELS / totalPixels);
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
    } else if (totalPixels > DOUBAO_MAX_TOTAL_PIXELS) {
        const scale = Math.sqrt(DOUBAO_MAX_TOTAL_PIXELS / totalPixels);
        width = Math.max(1, Math.floor(width * scale));
        height = Math.max(1, Math.floor(height * scale));
    }

    if (width >= height) {
        height = Math.max(1, Math.round(width / ratio));
    } else {
        width = Math.max(1, Math.round(height * ratio));
    }

    while (width * height > DOUBAO_MAX_TOTAL_PIXELS) {
        if (width >= height && width > 1) {
            width -= 1;
            height = Math.max(1, Math.round(width / ratio));
        } else if (height > 1) {
            height -= 1;
            width = Math.max(1, Math.round(height * ratio));
        } else {
            break;
        }
    }

    while (width * height < DOUBAO_MIN_TOTAL_PIXELS) {
        if (width >= height) {
            width += 1;
            height = Math.max(1, Math.round(width / ratio));
        } else {
            height += 1;
            width = Math.max(1, Math.round(height * ratio));
        }
    }

    return `${width}x${height}`;
}

/** 移植 _clamp_gpt_image_2_size。 */
function clampGptImage2Size(size: string) {
    try {
        const parts = String(size || "")
            .toLowerCase()
            .split("x", 2);
        let width = Math.max(1, Number.parseInt(parts[0], 10) || 1);
        let height = Math.max(1, Number.parseInt(parts[1], 10) || 1);

        const ratio = height ? width / height : 1;
        const maxEdgeScale = Math.min(1, GPT_IMAGE_2_MAX_EDGE / Math.max(width, height));
        const maxTotalScale = Math.min(1, Math.sqrt(GPT_IMAGE_2_MAX_TOTAL_PIXELS / (width * height)));
        const scale = Math.min(maxEdgeScale, maxTotalScale);

        width = Math.max(GPT_IMAGE_2_SIZE_STEP, Math.floor(width * scale));
        height = Math.max(GPT_IMAGE_2_SIZE_STEP, Math.floor(height * scale));
        width = Math.max(GPT_IMAGE_2_SIZE_STEP, Math.floor(width / GPT_IMAGE_2_SIZE_STEP) * GPT_IMAGE_2_SIZE_STEP);
        height = Math.max(GPT_IMAGE_2_SIZE_STEP, Math.floor(height / GPT_IMAGE_2_SIZE_STEP) * GPT_IMAGE_2_SIZE_STEP);

        if (ratio >= 1) {
            height = Math.max(GPT_IMAGE_2_SIZE_STEP, Math.floor(Math.floor(width / ratio) / GPT_IMAGE_2_SIZE_STEP) * GPT_IMAGE_2_SIZE_STEP);
        } else {
            width = Math.max(GPT_IMAGE_2_SIZE_STEP, Math.floor(Math.floor(height * ratio) / GPT_IMAGE_2_SIZE_STEP) * GPT_IMAGE_2_SIZE_STEP);
        }

        while (Math.max(width, height) > GPT_IMAGE_2_MAX_EDGE || width * height > GPT_IMAGE_2_MAX_TOTAL_PIXELS) {
            if (width >= height && width > GPT_IMAGE_2_SIZE_STEP) {
                width -= GPT_IMAGE_2_SIZE_STEP;
                height = Math.max(GPT_IMAGE_2_SIZE_STEP, Math.floor(Math.floor(width / ratio) / GPT_IMAGE_2_SIZE_STEP) * GPT_IMAGE_2_SIZE_STEP);
            } else if (height > GPT_IMAGE_2_SIZE_STEP) {
                height -= GPT_IMAGE_2_SIZE_STEP;
                width = Math.max(GPT_IMAGE_2_SIZE_STEP, Math.floor(Math.floor(height * ratio) / GPT_IMAGE_2_SIZE_STEP) * GPT_IMAGE_2_SIZE_STEP);
            } else {
                break;
            }
        }

        return `${width}x${height}`;
    } catch {
        return "1024x1024";
    }
}

async function buildWangsuMessagesContent(prompt: string, references: ReferenceImage[]) {
    if (!references.length) return prompt;
    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [{ type: "text", text: prompt }];
    for (const image of references) {
        content.push({ type: "image_url", image_url: { url: await imageToDataUrl(image) } });
    }
    return content;
}

async function requestWangsuGeminiOnce(config: WangsuConfig, prompt: string, references: ReferenceImage[], options?: RequestOptions) {
    const rawAspect = resolveWangsuAspectRatio(config.size);
    const aspect = rawAspect === "AUTO" ? "1:1" : rawAspect;
    const eca: Record<string, string> = { image_size: resolveWangsuResolution(config.quality) };
    if (aspect !== "ORIGINAL") eca.aspect_ratio = aspect;

    const payload = {
        model: config.model.trim(),
        messages: [{ role: "user", content: await buildWangsuMessagesContent(prompt, references) }],
        stream: false,
        modalities: ["image"],
        eca_image_config: eca,
    };
    const response = await axios.post<WangsuChatResponse>(wangsuApiUrl(config.baseUrl, CHAT_PATH), payload, {
        headers: wangsuJsonHeaders(geminiApiKey(config)),
        signal: options?.signal,
    });
    return [{ id: nanoid(), dataUrl: extractWangsuGeminiImage(response.data) }];
}

/** 移植 _extract_image_result_from_chat_response；浏览器端直接返回 dataUrl，无需二次下载。 */
function extractWangsuGeminiImage(payload: WangsuChatResponse) {
    if (typeof payload.error?.message === "string" && payload.error.message) throw new Error(payload.error.message);
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || apiText("requestFailed"));

    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    if (!choices.length) throw new Error(apiText("wangsuNoImage"));
    const message = choices[0]?.message ?? {};
    const content = message.content;

    if (Array.isArray(content)) {
        for (const item of content) {
            if (!item || typeof item !== "object") continue;
            const rawImageUrl = item.image_url;
            let imageUrl = "";
            if (rawImageUrl && typeof rawImageUrl === "object") imageUrl = String(rawImageUrl.url || "").trim();
            else if (typeof rawImageUrl === "string") imageUrl = rawImageUrl.trim();
            if (imageUrl.startsWith("data:image/") && imageUrl.includes(",")) return imageUrl;
            if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) return imageUrl;
            const b64Json = String(item.b64_json || "").trim();
            if (b64Json) return `data:image/png;base64,${b64Json}`;
        }
    }

    const contentText = String(content || "").trim();
    if (!contentText) throw new Error(apiText("wangsuNoImage"));

    const markdownMatch = contentText.match(/!\[.*?\]\((data:image\/[^;]+;base64,[^)]+)\)/);
    if (markdownMatch) return markdownMatch[1];

    const dataUriMatch = contentText.match(/(data:image\/[^;]+;base64,[^"'\\s]+)/);
    if (dataUriMatch) return dataUriMatch[1];

    const pureB64Match = contentText.match(/^([A-Za-z0-9+/=]{100,})$/);
    if (pureB64Match) return `data:image/png;base64,${pureB64Match[1]}`;

    throw new Error(apiText("wangsuImageParsingFailed"));
}

/** 移植 _parse_submit_result：把 {data:[{b64_json|url}]} 归一成 dataUrl 列表。 */
function parseWangsuImageData(payload: WangsuImageResponse) {
    if (typeof payload.error?.message === "string" && payload.error.message) throw new Error(payload.error.message);
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || apiText("requestFailed"));

    const data = Array.isArray(payload.data) ? payload.data : [];
    const images: string[] = [];
    for (const item of data) {
        if (!item || typeof item !== "object") continue;
        const b64 = typeof item.b64_json === "string" ? item.b64_json.trim() : "";
        if (b64) {
            images.push(`data:image/png;base64,${b64}`);
            continue;
        }
        const url = typeof item.url === "string" ? item.url.trim() : "";
        if (url) images.push(url);
    }
    if (!images.length) throw new Error(apiText("wangsuNoImage"));
    return images;
}

async function requestWangsuTextToImage(config: WangsuConfig, prompt: string, count: number, options?: RequestOptions) {
    const body: Record<string, unknown> = {
        model: config.model.trim(),
        prompt,
        size: convertSizeForModel(config.quality, config.size, config.model),
        n: count,
    };
    if (!isGptImage2Model(config.model)) body.response_format = "url";

    const response = await axios.post<WangsuImageResponse>(wangsuApiUrl(config.baseUrl, TEXT_TO_IMAGE_PATH), body, {
        headers: wangsuJsonHeaders(doubaoApiKey(config)),
        signal: options?.signal,
    });
    return parseWangsuImageData(response.data).map((dataUrl) => ({ id: nanoid(), dataUrl }));
}

async function requestWangsuEditImages(config: WangsuConfig, prompt: string, references: ReferenceImage[], count: number, options?: RequestOptions) {
    const files = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    if (!files.length) throw new Error(apiText("wangsuNoImage"));

    const formData = new FormData();
    formData.set("model", config.model.trim());
    formData.set("prompt", prompt);
    formData.set("size", convertSizeForModel(config.quality, config.size, config.model));
    formData.set("n", String(count));
    if (!isGptImage2Model(config.model)) formData.set("response_format", "url");
    files.forEach((file) => formData.append("image[]", file));

    const response = await axios.post<WangsuImageResponse>(wangsuApiUrl(config.baseUrl, IMAGE_EDIT_PATH), formData, {
        headers: { Authorization: `Bearer ${editApiKey(config)}` },
        signal: options?.signal,
    });
    return parseWangsuImageData(response.data).map((dataUrl) => ({ id: nanoid(), dataUrl }));
}

export async function requestWangsuGeneration(config: WangsuConfig, prompt: string, count: number, options?: RequestOptions): Promise<WangsuImageResult[]> {
    try {
        const model = config.model.trim();
        if (!model) throw new Error(apiText("wangsuModelRequired"));
        if (!prompt.trim()) throw new Error(apiText("wangsuPromptRequired"));
        const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
        if (isGeminiImageModel(model)) {
            return (await Promise.all(Array.from({ length: n }, () => requestWangsuGeminiOnce(config, prompt, [], options)))).flat();
        }
        return requestWangsuTextToImage(config, prompt, Math.min(n, 8), options);
    } catch (error) {
        throw new Error(readWangsuError(error));
    }
}

export async function requestWangsuEdit(config: WangsuConfig, prompt: string, references: ReferenceImage[], count: number, options?: RequestOptions): Promise<WangsuImageResult[]> {
    try {
        const model = config.model.trim();
        if (!model) throw new Error(apiText("wangsuModelRequired"));
        if (!prompt.trim()) throw new Error(apiText("wangsuPromptRequired"));
        const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
        if (isGeminiImageModel(model)) {
            return (await Promise.all(Array.from({ length: n }, () => requestWangsuGeminiOnce(config, prompt, references, options)))).flat();
        }
        if (!references.length) return requestWangsuTextToImage(config, prompt, Math.min(n, 8), options);
        return requestWangsuEditImages(config, prompt, references, Math.min(n, 8), options);
    } catch (error) {
        throw new Error(readWangsuError(error));
    }
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            if (/<[a-z][\s\S]*>/i.test(value)) return apiText("htmlError", { preview: `${value.slice(0, 80)}...` });
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    const errorMsg = typeof payload.error === "string" ? payload.error : (payload.error as { message?: unknown })?.message;
    return readApiErrorMessage(payload.msg) || readApiErrorMessage(payload.message) || readApiErrorMessage(errorMsg) || readApiErrorMessage(payload.detail) || "";
}

function readWangsuError(error: unknown) {
    if (axios.isCancel(error)) return apiText("requestCanceled");
    if (axios.isAxiosError(error)) {
        const responseData = error.response?.data;
        const apiMsg = readApiErrorMessage(responseData);
        if (apiMsg) return apiMsg;
        const status = error.response?.status;
        if (status === 401 || status === 403) return apiText("authenticationFailed");
        if (status === 429) return apiText("rateLimited");
        if (status === 404) return apiText("notFound");
        return status ? apiText("httpFailed", { status }) : error.message || apiText("requestFailed");
    }
    if (error instanceof DOMException && error.name === "AbortError") return apiText("requestCanceled");
    return error instanceof Error ? error.message : apiText("requestFailed");
}
