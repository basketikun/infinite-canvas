import axios from "axios";

import { catalogFromIds, normalizePricing, parsePrice, type CatalogModel } from "@/lib/model-catalog";
import { buildApiUrl, normalizeChannelModels, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

export type ProviderPreset = {
    id: string;
    name: string;
    baseUrl: string;
    apiFormat: "openai" | "gemini";
    /** Fallback models shown before any fetch; live catalog replaces this when fetch succeeds. */
    models: string[];
    /** Capability overrides for ids whose names defeat keyword guessing (e.g. seedance, luma). */
    capabilities?: Record<string, ModelCapability>;
    /** Per-model API call script overrides (keyed by model id). */
    scripts?: Record<string, string>;
    /** Attached to every image-capable model (for providers whose image endpoint differs). */
    imageScript?: string;
    /** Fetch the live catalog with an API key, including whatever metadata the provider publishes. */
    fetchModels?: (apiKey: string) => Promise<CatalogModel[]>;
    /** True when the public catalog is readable without a key (OpenRouter). */
    keylessCatalog?: boolean;
};

type OpenRouterModel = {
    id?: string;
    name?: string;
    architecture?: { output_modalities?: string[]; input_modalities?: string[] };
    pricing?: Record<string, string | number | null>;
};

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/** OpenAI-compatible providers: GET {base}/models with Bearer auth. Publishes ids only, no metadata. */
async function fetchOpenAiCompatible(baseUrl: string, apiKey: string): Promise<CatalogModel[]> {
    const response = await axios.get<{ data?: Array<{ id?: string }> }>(buildApiUrl(baseUrl, "/models"), {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    return catalogFromIds((response.data.data || []).map((model) => model.id || ""));
}

/** OpenRouter publishes declared modalities and per-unit USD pricing for every model. */
async function fetchOpenRouterCatalog(apiKey: string): Promise<CatalogModel[]> {
    const response = await axios.get<{ data?: OpenRouterModel[] }>(buildApiUrl(OPENROUTER_BASE, "/models"), {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    const fetchedAt = Date.now();
    return (response.data.data || [])
        .filter((model): model is OpenRouterModel & { id: string } => Boolean(model.id))
        .map((model) => ({
            id: model.id,
            label: model.name,
            outputModalities: model.architecture?.output_modalities,
            inputModalities: model.architecture?.input_modalities,
            pricing: normalizePricing(
                {
                    prompt: parsePrice(model.pricing?.prompt),
                    completion: parsePrice(model.pricing?.completion),
                    imageOutputToken: parsePrice(model.pricing?.image_output),
                    imageInputToken: parsePrice(model.pricing?.image),
                    audio: parsePrice(model.pricing?.audio),
                },
                fetchedAt,
            ),
        }));
}

/** xAI quotes token prices in USD cents per 100M tokens; convert to USD per token. */
const XAI_PRICE_SCALE = 1 / (100 * 1_000_000 * 100);

type XaiModel = { id?: string; prompt_text_token_price?: number; completion_text_token_price?: number; prompt_image_token_price?: number };

/** xAI exposes pricing on its typed model endpoints; the plain /models list does not carry it. */
async function fetchXaiCatalog(apiKey: string): Promise<CatalogModel[]> {
    if (!apiKey) return fetchOpenAiCompatible("https://api.x.ai/v1", "");
    const headers = { Authorization: `Bearer ${apiKey}` };
    const fetchedAt = Date.now();
    const endpoints = ["/language-models", "/image-generation-models"];
    const results = await Promise.allSettled(endpoints.map((path) => axios.get<{ models?: XaiModel[]; data?: XaiModel[] }>(buildApiUrl("https://api.x.ai/v1", path), { headers })));
    const models = results.flatMap((result) => (result.status === "fulfilled" ? result.value.data.models || result.value.data.data || [] : []));
    if (!models.length) return fetchOpenAiCompatible("https://api.x.ai/v1", apiKey);
    return models
        .filter((model): model is XaiModel & { id: string } => Boolean(model.id))
        .map((model) => ({
            id: model.id,
            pricing: normalizePricing(
                {
                    prompt: parsePrice(model.prompt_text_token_price, XAI_PRICE_SCALE),
                    completion: parsePrice(model.completion_text_token_price, XAI_PRICE_SCALE),
                    imageInputToken: parsePrice(model.prompt_image_token_price, XAI_PRICE_SCALE),
                },
                fetchedAt,
            ),
        }));
}

/**
 * OpenRouter image generation uses POST /images (b64_json in data[]) instead of /images/generations.
 * Reference images for image-to-image go in `input_references`; without them an edit request
 * silently degrades into plain text-to-image.
 */
const OPENROUTER_IMAGE_SCRIPT = `// OpenRouter image generation (POST /images, b64_json result)
const body = { model, prompt };
if (params.size) body.aspect_ratio = params.size;
if (images && images.length) {
  body.input_references = images.map((url) => ({ type: "image_url", image_url: { url } }));
}
const n = Math.min(params.count || 1, 10);
const single = { ...body };
if (n > 1) body.n = n;
try {
  const data = await http.post("/images", body);
  return (data.data || []).map((item) => item.b64_json).filter(Boolean);
} catch (error) {
  if (n <= 1) throw error;
  // single-image providers reject n>1: fall back to sequential calls, keeping the references
  const results = [];
  for (let i = 0; i < n; i++) {
    const data = await http.post("/images", single);
    results.push(...(data.data || []).map((item) => item.b64_json).filter(Boolean));
  }
  return results;
}`;

/** fal.ai queue API with Key auth: submit -> poll status -> fetch result. Works for image and video. */
const falQueue = (extract: string) => `// fal.ai queued generation (Key auth)
const headers = { Authorization: "Key " + apiKey };
const payload = { prompt };
if (params.ratio) payload.aspect_ratio = params.ratio;
if (images && images.length) payload.image_url = images[0];
const queued = await http.post("https://queue.fal.run/" + model, payload, { headers });
const base = "https://queue.fal.run/" + model + "/requests/" + queued.request_id;
await poll(
  () => http.get(base + "/status", { headers }),
  (status) => status.status === "COMPLETED"
);
const result = await http.get(base, { headers });
return ${extract};`;

const FAL_IMAGE_SCRIPT = falQueue("(result.images || []).map((img) => img.url).filter(Boolean)");
const FAL_VIDEO_SCRIPT = falQueue("result.video?.url || \"\"");

/** Replicate predictions API: sync call via Prefer: wait, poll fallback, output is a URL. */
const REPLICATE_VIDEO_SCRIPT = `// Replicate predictions API (video)
const headers = { Authorization: "Bearer " + apiKey, Prefer: "wait" };
const pred = await http.post("https://api.replicate.com/v1/models/" + model + "/predictions", { input: { prompt } }, { headers });
let output = pred.output;
if (!output) {
  const done = await poll(() => http.get(pred.urls.get, { headers }), (p) => p.status === "succeeded" || p.status === "failed");
  if (done.status === "failed") throw new Error(done.error || "generation failed");
  output = done.output;
}
return Array.isArray(output) ? output[output.length - 1] : output;`;

/** OpenAI Sora: POST /videos -> poll -> download content as data URL. */
const SORA_VIDEO_SCRIPT = `// OpenAI Sora (POST /videos)
const video = await http.post("/videos", { model, prompt, seconds: String(params.seconds || "4") });
const done = await poll(
  () => http.get("/videos/" + video.id),
  (v) => v.status === "completed" || v.status === "failed"
);
if (done.status === "failed") throw new Error(done.error?.message || "generation failed");
const blob = await http.get("/videos/" + done.id + "/content", { responseType: "blob" });
return await new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error("failed to read video content"));
  reader.readAsDataURL(blob);
});`;

/** Gemini Veo: predictLongRunning -> poll operation -> signed video URL (key appended). */
const VEO_SCRIPT = `// Google Veo via Gemini API (predictLongRunning)
const headers = { "x-goog-api-key": apiKey };
const op = await http.post("/v1beta/models/" + model + ":predictLongRunning", { instances: [{ prompt }] }, { headers });
const done = await poll(
  () => http.get("https://generativelanguage.googleapis.com/v1beta/" + op.name, { headers }),
  (o) => o.done
);
const uri = done.response?.generatedVideos?.[0]?.video?.uri;
if (!uri) throw new Error("no video returned");
return uri + (uri.includes("?") ? "&" : "?") + "key=" + apiKey;`;

/** Standard OpenAI-compatible catalog fetch shared by most presets. */
const openAiCompatible = (baseUrl: string) => (apiKey: string) => fetchOpenAiCompatible(baseUrl, apiKey);

export const providerPresets: ProviderPreset[] = [
    {
        id: "fal",
        name: "fal.ai",
        baseUrl: "https://queue.fal.run",
        apiFormat: "openai",
        models: [
            "fal-ai/kling-video/v2/master/text-to-video",
            "fal-ai/kling-video/v2/master/image-to-video",
            "fal-ai/minimax/video-01",
            "fal-ai/luma-dream-machine",
            "fal-ai/veo3",
            "fal-ai/flux/schnell",
            "fal-ai/flux-pro/v1.1",
        ],
        capabilities: { "fal-ai/luma-dream-machine": "video" },
        scripts: {
            "fal-ai/kling-video/v2/master/text-to-video": FAL_VIDEO_SCRIPT,
            "fal-ai/kling-video/v2/master/image-to-video": FAL_VIDEO_SCRIPT,
            "fal-ai/minimax/video-01": FAL_VIDEO_SCRIPT,
            "fal-ai/luma-dream-machine": FAL_VIDEO_SCRIPT,
            "fal-ai/veo3": FAL_VIDEO_SCRIPT,
            "fal-ai/flux/schnell": FAL_IMAGE_SCRIPT,
            "fal-ai/flux-pro/v1.1": FAL_IMAGE_SCRIPT,
        },
    },
    {
        id: "gemini",
        name: "Google Gemini",
        baseUrl: "https://generativelanguage.googleapis.com",
        apiFormat: "gemini",
        models: ["veo-3.1-generate-preview", "gemini-3-pro-image-preview", "gemini-2.5-flash-image", "gemini-2.5-flash"],
        scripts: { "veo-3.1-generate-preview": VEO_SCRIPT },
    },
    {
        id: "openai",
        name: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        apiFormat: "openai",
        models: ["sora-2", "sora-2-pro", "gpt-image-2", "gpt-5.5", "gpt-4o-mini-tts"],
        scripts: { "sora-2": SORA_VIDEO_SCRIPT, "sora-2-pro": SORA_VIDEO_SCRIPT },
        fetchModels: openAiCompatible("https://api.openai.com/v1"),
    },
    {
        id: "xai",
        name: "xAI",
        baseUrl: "https://api.x.ai/v1",
        apiFormat: "openai",
        models: ["grok-imagine-video", "grok-imagine-image", "grok-4"],
        fetchModels: fetchXaiCatalog,
    },
    {
        id: "replicate",
        name: "Replicate",
        baseUrl: "https://api.replicate.com/v1",
        apiFormat: "openai",
        models: ["kwaivgi/kling-v2.1", "bytedance/seedance-1-pro", "wavespeedai/wan-2.1-t2v-480p", "minimax/video-01"],
        capabilities: { "bytedance/seedance-1-pro": "video" },
        scripts: {
            "kwaivgi/kling-v2.1": REPLICATE_VIDEO_SCRIPT,
            "bytedance/seedance-1-pro": REPLICATE_VIDEO_SCRIPT,
            "wavespeedai/wan-2.1-t2v-480p": REPLICATE_VIDEO_SCRIPT,
            "minimax/video-01": REPLICATE_VIDEO_SCRIPT,
        },
    },
    {
        id: "openrouter",
        name: "OpenRouter",
        baseUrl: OPENROUTER_BASE,
        apiFormat: "openai",
        models: ["google/gemini-2.5-flash-image", "google/gemini-3.1-flash-image", "google/gemini-3-pro-image", "openai/gpt-5-image", "google/gemini-2.5-flash", "openai/gpt-4o-mini"],
        imageScript: OPENROUTER_IMAGE_SCRIPT,
        keylessCatalog: true,
        fetchModels: fetchOpenRouterCatalog,
    },
];

/**
 * Apply a preset's hand-written capability fixes and call scripts on top of normalized models.
 * A preset override outranks name guessing but not a capability the provider itself declared.
 */
function applyPreset(preset: ProviderPreset | undefined, models: ChannelModel[]): ChannelModel[] {
    return models.map((model) => {
        const override = preset?.capabilities?.[model.name];
        const useOverride = override && model.capabilitySource !== "provider";
        const capability = useOverride ? override : model.capability;
        const capabilitySource = useOverride ? ("provider" as const) : model.capabilitySource;
        const script = preset?.scripts?.[model.name] || (preset?.imageScript && capability === "image" ? preset.imageScript : undefined);
        return { ...model, capability, capabilitySource, script };
    });
}

/** Build a ready-to-edit channel from a preset: capabilities fixed up, scripts pre-wired, key left empty. */
export function channelFromPreset(preset: ProviderPreset): ModelChannel {
    return {
        id: `preset-${preset.id}-${Date.now().toString(36)}`,
        name: preset.name,
        baseUrl: preset.baseUrl,
        apiKey: "",
        apiFormat: preset.apiFormat,
        models: applyPreset(preset, normalizeChannelModels(preset.models)),
    };
}

/** Fetch a preset's live catalog (empty key allowed for public catalogs like OpenRouter). */
export async function fetchPresetModels(preset: ProviderPreset, apiKey = ""): Promise<CatalogModel[]> {
    if (!preset.fetchModels) throw new Error("provider does not support catalog fetching");
    return preset.fetchModels(apiKey.trim());
}

export function presetForChannel(channel: ModelChannel): ProviderPreset | undefined {
    return providerPresets.find((preset) => preset.baseUrl === channel.baseUrl || preset.name === channel.name);
}

/** True when this channel's catalog can be read without an API key. */
export function channelSupportsKeylessCatalog(channel: ModelChannel): boolean {
    return Boolean(presetForChannel(channel)?.keylessCatalog);
}

/**
 * Fetch a channel's catalog through its preset when it has one (so OpenRouter/xAI metadata and
 * pricing survive), falling back to the channel's own /models endpoint for custom channels.
 */
export async function fetchChannelCatalog(channel: ModelChannel): Promise<CatalogModel[]> {
    const preset = presetForChannel(channel);
    // A keyless catalog still accepts a key when the user has entered one, so just pass it through.
    if (preset?.fetchModels) return preset.fetchModels(channel.apiKey.trim());
    const { fetchChannelModels } = await import("@/services/api/image");
    return catalogFromIds(await fetchChannelModels(channel));
}

/** Apply a preset's capability fixes and call scripts to a fetched catalog (or a bare id list). */
export function enrichModelsForChannel(channel: ModelChannel, models: Array<string | CatalogModel>): ChannelModel[] {
    return applyPreset(presetForChannel(channel), normalizeChannelModels(models));
}

export type { ChannelModel };
