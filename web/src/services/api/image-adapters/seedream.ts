import { nanoid } from "nanoid";
import type { AiConfig } from "@/stores/use-config-store";
import type { ImageAdapter, ImageResult, PresetSize } from "./types";

const SEEDREAM_SIZE_PRESETS: PresetSize[] = [
  { id: "2K", label: "2K", width: 2048, height: 2048, icon: "square" },
  { id: "2K-16:9", label: "2K 16:9", width: 2848, height: 1600, icon: "landscape" },
  { id: "2K-9:16", label: "2K 9:16", width: 1600, height: 2848, icon: "portrait" },
  { id: "2K-4:3", label: "2K 4:3", width: 2304, height: 1728, icon: "landscape" },
  { id: "2K-3:4", label: "2K 3:4", width: 1728, height: 2304, icon: "portrait" },
  { id: "2K-3:2", label: "2K 3:2", width: 2496, height: 1664, icon: "landscape" },
  { id: "2K-2:3", label: "2K 2:3", width: 1664, height: 2496, icon: "portrait" },
  { id: "2K-21:9", label: "2K 21:9", width: 3136, height: 1344, icon: "landscape" },
  { id: "4K", label: "4K", width: 4096, height: 4096, icon: "square" },
  { id: "4K-16:9", label: "4K 16:9", width: 5504, height: 3040, icon: "landscape" },
  { id: "4K-9:16", label: "4K 9:16", width: 3040, height: 5504, icon: "portrait" },
  { id: "4K-4:3", label: "4K 4:3", width: 4704, height: 3520, icon: "landscape" },
  { id: "4K-3:4", label: "4K 3:4", width: 3520, height: 4704, icon: "portrait" },
  { id: "4K-3:2", label: "4K 3:2", width: 4992, height: 3328, icon: "landscape" },
  { id: "4K-2:3", label: "4K 2:3", width: 3328, height: 4992, icon: "portrait" },
  { id: "4K-21:9", label: "4K 21:9", width: 6240, height: 2656, icon: "landscape" },
];

function resolveSeedreamSize(config: AiConfig): string | undefined {
  const raw = (config.size || "auto").trim();
  if (!raw || raw === "auto") return undefined;
  const preset = SEEDREAM_SIZE_PRESETS.find((p) => p.id === raw);
  if (preset) return preset.width + "x" + preset.height;
  if (/^\d+x\d+$/i.test(raw)) return raw;
  if (raw.includes(":")) {
    const parts = raw.split(":");
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      const shortSide = 2048;
      const longSide = Math.round(shortSide * Math.max(w, h) / Math.min(w, h) / 16) * 16;
      return w >= h ? longSide + "x" + shortSide : shortSide + "x" + longSide;
    }
  }
  return "2048x2048";
}

function resolveImageDataUrl(item: Record<string, unknown>) {
  if (typeof item.b64_json === "string" && item.b64_json) {
    return "data:image/jpeg;base64," + item.b64_json;
  }
  if (typeof item.url === "string" && item.url) return item.url;
  return null;
}

export const seedreamAdapter: ImageAdapter = {
  id: "seedream",
  name: "Seedream (Volcengine)",
  buildBody(config: AiConfig, prompt: string, count: number): Record<string, unknown> {
    const size = resolveSeedreamSize(config);
    const body: Record<string, unknown> = { model: config.model, prompt, response_format: "b64_json", watermark: false };
    if (size) body.size = size;
    if (count > 1) {
      body.sequential_image_generation = "auto";
      body.sequential_image_generation_options = { max_images: count };
    }
    return body;
  },
  parseResponse(raw: unknown): ImageResult[] {
    let data = raw;
    // Handle case where proxy returns string body instead of parsed JSON
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch { throw new Error("\u63a5\u53e3\u8fd4\u56de\u5f02\u5e38\uff1a\u4e0d\u662f\u6709\u6548\u7684 JSON"); }
    }
    const payload = data as { data?: Record<string, unknown>[] };
    if (!payload || !Array.isArray(payload.data)) throw new Error("\u63a5\u53e3\u8fd4\u56de\u5f02\u5e38");
    const images = payload.data.map(resolveImageDataUrl).filter((v): v is string => Boolean(v)).map((dataUrl) => ({ id: nanoid(), dataUrl }));
    if (images.length === 0) throw new Error("\u63a5\u53e3\u6ca1\u6709\u8fd4\u56de\u56fe\u7247");
    return images;
  },
  ui: { sizeMode: "preset", presetSizes: SEEDREAM_SIZE_PRESETS, qualitySupported: false, countSupported: true, editSupported: false, useDefaultEndpoint: true },
};
