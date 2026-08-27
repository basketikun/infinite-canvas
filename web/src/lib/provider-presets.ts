import axios from "axios";

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
    /** Fetch the live model catalog with an API key; returns raw model ids. */
    fetchModels?: (apiKey: string) => Promise<string[]>;
};

type OpenRouterModel = { id?: string; architecture?: { output_modalities?: string[] } };

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/** OpenAI-compatible providers: GET {base}/models with Bearer auth. */
async function fetchOpenAiCompatible(baseUrl: string, apiKey: string): Promise<string[]> {
    const response = await axios.get<{ data?: Array<{ id?: string }> }>(buildApiUrl(baseUrl, "/models"), {
        headers: { Authorization: `Bearer ${apiKey}` },
    });
    return (response.data.data || []).map((model) => model.id || "").filter(Boolean);
}

/** OpenRouter image generation uses POST /images (b64_json in data[]) instead of /images/generations. */
const OPENROUTER_IMAGE_SCRIPT = `// OpenRouter image generation (POST /images, b64_json result)
const body = { model, prompt };
if (params.size) body.aspect_ratio = params.size;
const n = Math.min(params.count || 1, 10);
if (n > 1) body.n = n;
try {
  const data = await http.post("/images", body);
  return (data.data || []).map((item) => item.b64_json).filter(Boolean);
} catch (error) {
  if (n <= 1) throw error;
  // single-image providers reject n>1: fall back to sequential calls
  const results = [];
  for (let i = 0; i < n; i++) {
    const data = await http.post("/images", { model, prompt });
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
        fetchModels: openAiCompatible("https://api.x.ai/v1"),
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
        fetchModels: async (apiKey) => {
            const response = await axios.get<{ data?: OpenRouterModel[] }>(buildApiUrl(OPENROUTER_BASE, "/models"), { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} });
            return (response.data.data || []).map((model) => model.id || "").filter(Boolean);
        },
    },
];

/** Build a ready-to-edit channel from a preset: capabilities fixed up, scripts pre-wired, key left empty. */
export function channelFromPreset(preset: ProviderPreset): ModelChannel {
    const models = normalizeChannelModels(preset.models).map((model) => {
        const capability = preset.capabilities?.[model.name] || model.capability;
        const script = preset.scripts?.[model.name] || (preset.imageScript && capability === "image" ? preset.imageScript : undefined);
        return { ...model, capability, script };
    });
    return {
        id: `preset-${preset.id}-${Date.now().toString(36)}`,
        name: preset.name,
        baseUrl: preset.baseUrl,
        apiKey: "",
        apiFormat: preset.apiFormat,
        models,
    };
}

/** Fetch a preset's live catalog (empty key allowed for public catalogs like OpenRouter). */
export async function fetchPresetModels(preset: ProviderPreset, apiKey = ""): Promise<string[]> {
    if (!preset.fetchModels) throw new Error("provider does not support catalog fetching");
    return preset.fetchModels(apiKey.trim());
}

function presetForChannel(channel: ModelChannel): ProviderPreset | undefined {
    return providerPresets.find((preset) => preset.baseUrl === channel.baseUrl || preset.name === channel.name);
}

/** Apply a preset's capability fixes and call scripts to an arbitrary model-id list (e.g. a fetched catalog). */
export function enrichModelsForChannel(channel: ModelChannel, names: string[]): ChannelModel[] {
    const preset = presetForChannel(channel);
    return normalizeChannelModels(names).map((model) => {
        const capability = preset?.capabilities?.[model.name] || model.capability;
        const script = preset?.scripts?.[model.name] || (preset?.imageScript && capability === "image" ? preset.imageScript : undefined);
        return { ...model, capability, script };
    });
}

export type { ChannelModel };
