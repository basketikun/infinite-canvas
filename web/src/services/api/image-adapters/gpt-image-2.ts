import { nanoid } from "nanoid";
import type { AiConfig } from "@/stores/use-config-store";
import type { ImageAdapter, ImageResult, PresetSize } from "./types";

// ---------------------------------------------------------------------------
// Size / quality resolution (shared with the legacy path)
// ---------------------------------------------------------------------------
const QUALITY_BASE: Record<string, number> = {
  low: 1024,
  medium: 2048,
  high: 2880,
  standard: 1024,
  hd: 2048,
};
const QUALITY_ALIASES: Record<string, string> = {
  "1k": "low",
  "2k": "medium",
  "4k": "high",
};
const DEFAULT_IMAGE_SHORT_SIDE = 1024;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MIN_PIXELS = 655360;
const IMAGE_MAX_PIXELS = 8294400;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_RATIO = 3;
const IMAGE_OUTPUT_FORMAT = "png";

function normalizeQuality(quality: string) {
  const value = quality.trim().toLowerCase();
  const normalized = QUALITY_ALIASES[value] || value;
  return QUALITY_BASE[normalized] ? normalized : undefined;
}

function parseImageRatio(value: string) {
  const parts = value.split(":");
  if (parts.length !== 2) throw new Error("\u56fe\u50cf\u5c3a\u5bf8\u683c\u5f0f\u4e0d\u652f\u6301\uff0c\u8bf7\u4f7f\u7528 auto\u30019:16 \u6216 1024x1024");
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error("\u56fe\u50cf\u6bd4\u4f8b\u5fc5\u987b\u662f\u6b63\u6570\uff0c\u4f8b\u5982 9:16");
  if (Math.max(w, h) / Math.min(w, h) > IMAGE_MAX_RATIO) throw new Error("\u56fe\u50cf\u5bbd\u9ad8\u6bd4\u4e0d\u80fd\u8d85\u8fc7 3:1\uff0c\u8bf7\u8c03\u6574\u5c3a\u5bf8");
  return { width: w, height: h };
}

function parseImageDimensions(value: string) {
  const match = value.match(/^(\\d+)x(\\d+)$/i);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function validateImageSize(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    throw new Error("\u56fe\u50cf\u5c3a\u5bf8\u5fc5\u987b\u662f\u6b63\u6574\u6570\uff0c\u4f8b\u5982 1024x1024");
  if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0)
    throw new Error("\u56fe\u50cf\u5c3a\u5bf8\u7684\u5bbd\u9ad8\u5fc5\u987b\u662f 16 \u7684\u500d\u6570\uff0c\u8bf7\u8c03\u6574\u5c3a\u5bf8");
  if (Math.max(width, height) > IMAGE_MAX_EDGE)
    throw new Error("\u56fe\u50cf\u5c3a\u5bf8\u6700\u957f\u8fb9\u4e0d\u80fd\u8d85\u8fc7 3840px\uff0c\u8bf7\u8c03\u6574\u5c3a\u5bf8");
  if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO)
    throw new Error("\u56fe\u50cf\u5bbd\u9ad8\u6bd4\u4e0d\u80fd\u8d85\u8fc7 3:1\uff0c\u8bf7\u8c03\u6574\u5c3a\u5bf8");
  const pixels = width * height;
  if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS)
    throw new Error("\u56fe\u50cf\u603b\u50cf\u7d20\u9700\u5728 655360 \u5230 8294400 \u4e4b\u95f4\uff0c\u8bf7\u8c03\u6574\u5c3a\u5bf8");
}

function resolveSize(quality: string | undefined, ratio: string): string {
  const parsedRatio = parseImageRatio(ratio);
  const basePixels = quality ? QUALITY_BASE[quality] : undefined;
  const isLandscape = parsedRatio.width >= parsedRatio.height;
  const longRatio = isLandscape ? parsedRatio.width / parsedRatio.height : parsedRatio.height / parsedRatio.width;
  let longSide: number;
  let shortSide: number;
  if (basePixels) {
    const targetPixels = basePixels * basePixels;
    const longSideRaw = Math.sqrt(targetPixels * longRatio);
    longSide = Math.floor(longSideRaw / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    shortSide = Math.round(longSide / longRatio / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
  } else {
    shortSide = DEFAULT_IMAGE_SHORT_SIDE;
    longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
  }
  const width = isLandscape ? longSide : shortSide;
  const height = isLandscape ? shortSide : longSide;
  validateImageSize(width, height);
  return width + "x" + height;
}

function resolveRequestSize(quality: string | undefined, size: string) {
  const value = size.trim();
  if (!value || value.toLowerCase() === "auto") return undefined;
  const dimensions = parseImageDimensions(value);
  if (dimensions) {
    validateImageSize(dimensions.width, dimensions.height);
    return dimensions.width + "x" + dimensions.height;
  }
  if (value.includes(":")) return resolveSize(quality, value);
  throw new Error("\u56fe\u50cf\u5c3a\u5bf8\u683c\u5f0f\u4e0d\u652f\u6301\uff0c\u8bf7\u4f7f\u7528 auto\u30019:16 \u6216 1024x1024");
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------
function resolveImageDataUrl(item: Record<string, unknown>) {
  if (typeof item.b64_json === "string" && item.b64_json) {
    return "data:image/png;base64," + item.b64_json;
  }
  if (typeof item.url === "string" && item.url) {
    return item.url;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Preset size options for the aspect-ratio grid
// ---------------------------------------------------------------------------
const aspectOptions: PresetSize[] = [
  { id: "1:1", label: "1:1", width: 1024, height: 1024, icon: "square" },
  { id: "3:2", label: "3:2", width: 1536, height: 1024, icon: "landscape" },
  { id: "2:3", label: "2:3", width: 1024, height: 1536, icon: "portrait" },
  { id: "4:3", label: "4:3", width: 1360, height: 1024, icon: "landscape" },
  { id: "3:4", label: "3:4", width: 1024, height: 1360, icon: "portrait" },
  { id: "16:9", label: "16:9", width: 1824, height: 1024, icon: "landscape" },
  { id: "9:16", label: "9:16", width: 1024, height: 1824, icon: "portrait" },
  { id: "1:1-2k", label: "1:1(2k)", size: "2048x2048", width: 2048, height: 2048, icon: "square" },
  { id: "16:9-2k", label: "16:9(2k)", size: "2048x1152", width: 2048, height: 1152, icon: "landscape" },
  { id: "9:16-2k", label: "9:16(2k)", size: "1152x2048", width: 1152, height: 2048, icon: "portrait" },
  { id: "16:9-4k", label: "16:9(4k)", size: "3840x2160", width: 3840, height: 2160, icon: "landscape" },
  { id: "9:16-4k", label: "9:16(4k)", size: "2160x3840", width: 2160, height: 3840, icon: "portrait" },
  { id: "auto", label: "auto", width: 0, height: 0, icon: "square" },
];

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
export const gptImage2Adapter: ImageAdapter = {
  id: "gpt-image-2",
  name: "OpenAI Compatible",

  buildBody(config: AiConfig, prompt: string, count: number): Record<string, unknown> {
    const quality = normalizeQuality(config.quality);
    const requestSize = resolveRequestSize(quality, config.size);
    const body: Record<string, unknown> = {
      model: config.model,
      prompt,
      n: count,
      response_format: "b64_json",
      output_format: IMAGE_OUTPUT_FORMAT,
    };
    if (quality) body.quality = quality;
    if (requestSize) body.size = requestSize;
    return body;
  },

  parseResponse(raw: unknown): ImageResult[] {
    let data = raw;
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch { throw new Error("\u63a5\u53e3\u8fd4\u56de\u5f02\u5e38\uff1a\u4e0d\u662f\u6709\u6548\u7684 JSON"); }
    }
    const payload = data as { data?: Record<string, unknown>[] };
    if (!payload || !Array.isArray(payload.data)) {
      throw new Error("\u63a5\u53e3\u8fd4\u56de\u5f02\u5e38\uff1a\u6570\u636e\u683c\u5f0f\u4e0d\u6b63\u786e");
    }
    const images = payload.data
      .map(resolveImageDataUrl)
      .filter((v): v is string => Boolean(v))
      .map((dataUrl) => ({ id: nanoid(), dataUrl }));
    if (images.length === 0) {
      throw new Error("\u63a5\u53e3\u6ca1\u6709\u8fd4\u56de\u56fe\u7247");
    }
    return images;
  },

  ui: {
    sizeMode: "dynamic",
    qualitySupported: true,
    countSupported: true,
    editSupported: true,
    useDefaultEndpoint: true,
  },
};
