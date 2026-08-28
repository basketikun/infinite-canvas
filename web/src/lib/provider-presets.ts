import axios from "axios";

import { catalogFromIds, normalizePricing, parsePrice, type CatalogModel } from "@/lib/model-catalog";
import { buildApiUrl, normalizeChannelModels, useConfigStore, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

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
    /**
     * Fallback call script per capability, attached to every model of that capability that has no
     * entry in `scripts`. Providers whose API is not OpenAI-compatible (fal queue, Replicate
     * predictions) need one for every model their catalog returns, not just the curated few.
     */
    capabilityScripts?: Partial<Record<ModelCapability, string>>;
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
const FAL_CATALOG_URL = "https://api.fal.ai/v1/models";

/** OpenAI-compatible providers: GET {base}/models with Bearer auth. Publishes ids only, no metadata. */
async function fetchOpenAiCompatible(baseUrl: string, apiKey: string): Promise<CatalogModel[]> {
    const response = await axios.get<{ data?: Array<{ id?: string }> }>(buildApiUrl(baseUrl, "/models"), {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    return catalogFromIds((response.data.data || []).map((model) => model.id || ""));
}

/**
 * OpenRouter publishes declared modalities and per-unit USD pricing for every model.
 *
 * `output_modalities` is required and is not merely a filter: a bare GET /models returns only the
 * text models (387 of them), which silently hides the 27 video, 50 image and 4 audio models the
 * site lists. Asking for all four returns the whole catalog in one call.
 */
const OPENROUTER_MODALITIES = "text,image,video,audio";

async function fetchOpenRouterCatalog(apiKey: string): Promise<CatalogModel[]> {
    const response = await axios.get<{ data?: OpenRouterModel[] }>(buildApiUrl(OPENROUTER_BASE, "/models"), {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        params: { output_modalities: OPENROUTER_MODALITIES },
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

/**
 * OpenRouter video generation is a job API, not a single call: POST /videos returns
 * { id, polling_url, status }, and the caller polls that url until status is terminal. Only
 * "completed" carries `unsigned_urls`; "failed", "cancelled" and "expired" all end the job.
 *
 * Every parameter is a per-model enum, and the three models disagree completely: Veo 3.1 takes
 * 4/6/8 seconds at 720p/1080p/4K, Sora 2 Pro takes 4/8/12/16/20, Seedance takes anything from 4 to
 * 30 at 480p/720p. Our own settings are a fixed list that matches none of them, and this app stores
 * video size as "1280x720" where the API wants the aspect ratio "16:9" - so the script reads each
 * model's declared limits from /videos/models and snaps to them instead of sending a rejected enum.
 */
const OPENROUTER_VIDEO_SCRIPT = `// OpenRouter video generation (POST /videos, then poll the job)
// Size here is whatever the studio holds - a preset like "1280x720", a hand-typed "800x600", or an
// "16:9" from a script. Compare them as numbers and take the closest option the model allows, since
// the API only accepts its enum and a pixel string is rejected outright.
const STANDARD_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9", "9:21"];
const ratioValue = (text) => {
  const [w, h] = String(text || "").split(/[:x×]/).map(Number);
  return w > 0 && h > 0 ? w / h : 0;
};

// Per-model limits. Treated as optional: if this lookup fails the request still goes out with our
// own settings, which is no worse than not having asked.
let specs = null;
try {
  const list = await http.get("/videos/models");
  specs = (list.data || list || []).find((item) => item.id === model) || null;
} catch (error) {
  specs = null;
}

const nearest = (options, wanted) => options.reduce((best, value) => (Math.abs(value - wanted) < Math.abs(best - wanted) ? value : best));
const body = { model, prompt };

const seconds = Number(params.seconds) || 6;
body.duration = specs && specs.supported_durations && specs.supported_durations.length ? nearest(specs.supported_durations, seconds) : seconds;

const resolutions = specs && specs.supported_resolutions;
const resolution = params.resolution;
if (resolutions && resolutions.length) body.resolution = resolutions.includes(resolution) ? resolution : resolutions[0];
else if (resolution) body.resolution = resolution;

const ratios = specs && specs.supported_aspect_ratios;
const allowed = ratios && ratios.length ? ratios : STANDARD_RATIOS;
const wantedRatio = ratioValue(params.ratio);
if (wantedRatio) {
  body.aspect_ratio = allowed.reduce((best, option) => (Math.abs(ratioValue(option) - wantedRatio) < Math.abs(ratioValue(best) - wantedRatio) ? option : best));
}

// Asking for audio from a model that cannot produce it is rejected outright, so only pass the flag
// when the model advertises support.
if (typeof params.generateAudio === "boolean" && (!specs || specs.generate_audio)) body.generate_audio = params.generateAudio;
if (images && images.length) {
  body.input_references = images.map((url) => ({ type: "image_url", image_url: { url } }));
}

const job = await http.post("/videos", body);
const done = await poll(
  () => http.get(job.polling_url || "/videos/" + job.id),
  (state) => (["completed", "failed", "cancelled", "expired"].includes(state.status) ? state : null),
  { intervalMs: 5000, timeoutMs: 600000 }
);
if (done.status !== "completed") throw new Error(done.error || ("video generation " + done.status));
const url = (done.unsigned_urls || [])[0];
if (!url) throw new Error("no video returned");
return { url };`;

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
const FAL_VIDEO_SCRIPT = falQueue('result.video?.url || ""');
const FAL_AUDIO_SCRIPT = falQueue('{ url: result.audio?.url || result.audio_url || "" }');

/**
 * fal LLM / vision endpoints also go through the queue API, so they cannot use the default
 * OpenAI-compatible chat path. Messages are flattened into a single prompt because the queue
 * endpoints take `prompt` plus an optional `system_prompt` rather than a message array.
 */
const FAL_TEXT_SCRIPT = `// fal.ai text generation (queued LLM endpoints)
const headers = { Authorization: "Key " + apiKey };
const history = (messages || []).filter((item) => item.role !== "system");
const payload = { prompt: history.map((item) => item.content).join("\n\n") };
if (systemPrompt) payload.system_prompt = systemPrompt;
const queued = await http.post("https://queue.fal.run/" + model, payload, { headers });
const base = "https://queue.fal.run/" + model + "/requests/" + queued.request_id;
await poll(
  () => http.get(base + "/status", { headers }),
  (status) => status.status === "COMPLETED"
);
const result = await http.get(base, { headers });
const text = result.output || result.response || "";
if (text) onDelta(text);
return text;`;

/**
 * Replicate image models: same predictions API as video, but the output is one or more image URLs.
 * Reference images go in `input.image`, the most common field name across Replicate image models —
 * models that name it differently (flux-kontext uses `input_image`) need this script edited.
 */
const REPLICATE_IMAGE_SCRIPT = `// Replicate predictions API (image)
const headers = { Authorization: "Bearer " + apiKey, Prefer: "wait" };
const input = { prompt };
if (images && images.length) input.image = images[0];
const pred = await http.post("https://api.replicate.com/v1/models/" + model + "/predictions", { input }, { headers });
let output = pred.output;
if (!output) {
  const done = await poll(() => http.get(pred.urls.get, { headers }), (p) => p.status === "succeeded" || p.status === "failed");
  if (done.status === "failed") throw new Error(done.error || "generation failed");
  output = done.output;
}
return Array.isArray(output) ? output.filter(Boolean) : [output].filter(Boolean);`;

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

/** fal categories read as "{input}-to-{output}"; the output half is the capability we store. */
const FAL_OUTPUT_MODALITY: Record<string, string> = { image: "image", video: "video", audio: "audio", speech: "audio", text: "text" };

/**
 * Modalities implied by a fal category. Returns undefined for categories outside the four
 * capabilities this app models (3d, training, workflow, json), so they are dropped rather than
 * silently filed as text.
 */
function falModalities(category: string): { inputModalities: string[]; outputModalities: string[] } | undefined {
    if (category === "llm") return { inputModalities: ["text"], outputModalities: ["text"] };
    if (category === "vision") return { inputModalities: ["text", "image"], outputModalities: ["text"] };
    const [input, output] = category.split("-to-");
    const outputModality = output && FAL_OUTPUT_MODALITY[output];
    if (!input || !outputModality) return undefined;
    const inputModality = FAL_OUTPUT_MODALITY[input] || "text";
    return { inputModalities: inputModality === "text" ? ["text"] : ["text", inputModality], outputModalities: [outputModality] };
}

type FalModel = { endpoint_id?: string; metadata?: { display_name?: string; category?: string; status?: string } };

/**
 * fal's public catalog: cursor-paginated, 100 per page (~900 models), readable without a key.
 * Publishes no pricing.
 *
 * Keyless reads are rate-limited and walking every page unauthenticated does hit 429, so a page
 * that fails after the first one returns the models gathered so far rather than throwing away a
 * usable partial catalog. Supplying a key raises the limit and is used when the channel has one.
 */
async function fetchFalCatalog(apiKey: string): Promise<CatalogModel[]> {
    const headers = apiKey ? { Authorization: `Key ${apiKey}` } : undefined;
    const models: CatalogModel[] = [];
    let cursor = "";
    // The page cap stops a runaway loop if the cursor ever fails to advance.
    for (let page = 0; page < 20; page++) {
        let payload: { models?: FalModel[]; next_cursor?: string; has_more?: boolean };
        try {
            const response = await axios.get<typeof payload>(`${FAL_CATALOG_URL}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { headers });
            payload = response.data;
        } catch (error) {
            if (!models.length) throw error;
            break; // rate-limited or transient: keep the pages we already have
        }
        for (const model of payload.models || []) {
            const id = model.endpoint_id;
            if (!id || model.metadata?.status === "deprecated") continue;
            const modalities = falModalities(model.metadata?.category || "");
            if (!modalities) continue;
            models.push({ id, label: model.metadata?.display_name, ...modalities });
        }
        if (!payload.has_more || !payload.next_cursor) break;
        cursor = payload.next_cursor;
    }
    return models;
}

/**
 * Replicate has no capability metadata on a model, and its full /v1/models list is many thousands
 * of entries deep. Its curated collections carry exactly the signal we need, so read those instead.
 */
const REPLICATE_COLLECTIONS: Array<{ slug: string; inputModalities: string[]; outputModalities: string[] }> = [
    { slug: "text-to-image", inputModalities: ["text"], outputModalities: ["image"] },
    { slug: "image-editing", inputModalities: ["text", "image"], outputModalities: ["image"] },
    { slug: "text-to-video", inputModalities: ["text"], outputModalities: ["video"] },
    { slug: "image-to-video", inputModalities: ["text", "image"], outputModalities: ["video"] },
    { slug: "text-to-speech", inputModalities: ["text"], outputModalities: ["audio"] },
    { slug: "ai-music-generation", inputModalities: ["text"], outputModalities: ["audio"] },
    { slug: "language-models", inputModalities: ["text"], outputModalities: ["text"] },
];

type ReplicateModel = { owner?: string; name?: string; description?: string };

/** Replicate requires a token for every endpoint, so this cannot run before a key is entered. */
async function fetchReplicateCatalog(apiKey: string): Promise<CatalogModel[]> {
    if (!apiKey) throw new Error("Replicate requires an API token to read its catalog");
    const headers = { Authorization: `Bearer ${apiKey}` };
    const merged = new Map<string, CatalogModel>();
    const results = await Promise.allSettled(
        REPLICATE_COLLECTIONS.map(async (collection) => {
            const response = await axios.get<{ models?: ReplicateModel[] }>(`https://api.replicate.com/v1/collections/${collection.slug}`, { headers });
            return { collection, models: response.data.models || [] };
        }),
    );
    for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const { collection, models } = result.value;
        for (const model of models) {
            if (!model.owner || !model.name) continue;
            const id = `${model.owner}/${model.name}`;
            const existing = merged.get(id);
            // A model can appear in several collections (text-to-image and image-editing, say);
            // union the modalities so its image-input support is not lost to whichever came first.
            merged.set(id, {
                id,
                label: existing?.label || model.name,
                inputModalities: Array.from(new Set([...(existing?.inputModalities || []), ...collection.inputModalities])),
                outputModalities: Array.from(new Set([...(existing?.outputModalities || []), ...collection.outputModalities])),
            });
        }
    }
    if (!merged.size) throw new Error("Replicate returned no models for the known collections");
    return Array.from(merged.values());
}

/** Standard OpenAI-compatible catalog fetch shared by most presets. */
const openAiCompatible = (baseUrl: string) => (apiKey: string) => fetchOpenAiCompatible(baseUrl, apiKey);

export const providerPresets: ProviderPreset[] = [
    {
        id: "fal",
        name: "fal.ai",
        baseUrl: "https://queue.fal.run",
        apiFormat: "openai",
        models: ["fal-ai/kling-video/v2/master/text-to-video", "fal-ai/kling-video/v2/master/image-to-video", "fal-ai/minimax/video-01", "fal-ai/luma-dream-machine", "fal-ai/veo3", "fal-ai/flux/schnell", "fal-ai/flux-pro/v1.1"],
        capabilities: { "fal-ai/luma-dream-machine": "video" },
        // Every fal model goes through the same queue API, so the scripts are assigned by capability
        // rather than listed per model - the live catalog returns ~900 of them.
        capabilityScripts: { image: FAL_IMAGE_SCRIPT, video: FAL_VIDEO_SCRIPT, audio: FAL_AUDIO_SCRIPT, text: FAL_TEXT_SCRIPT },
        keylessCatalog: true,
        fetchModels: fetchFalCatalog,
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
        capabilityScripts: { image: REPLICATE_IMAGE_SCRIPT, video: REPLICATE_VIDEO_SCRIPT },
        fetchModels: fetchReplicateCatalog,
    },
    {
        id: "openrouter",
        name: "OpenRouter",
        baseUrl: OPENROUTER_BASE,
        apiFormat: "openai",
        models: ["google/gemini-2.5-flash-image", "google/gemini-3.1-flash-image", "google/gemini-3-pro-image", "openai/gpt-5-image", "google/gemini-2.5-flash", "openai/gpt-4o-mini"],
        // The auto-routers declare every output modality, so they would otherwise land in the image
        // picker as if they were image models. They route text; treat them as such.
        capabilities: { "openrouter/auto": "text", "openrouter/auto-beta": "text" },
        capabilityScripts: { image: OPENROUTER_IMAGE_SCRIPT, video: OPENROUTER_VIDEO_SCRIPT },
        keylessCatalog: true,
        fetchModels: fetchOpenRouterCatalog,
    },
];

/**
 * Apply a preset's hand-written capability fixes and call scripts on top of normalized models.
 * A preset override is a curated fix for a specific model id, so it outranks the provider's own
 * declaration - providers do get this wrong (OpenRouter's auto-router declares image output it
 * will not actually produce). It never outranks the user's own choice in the channel editor.
 */
function applyPreset(preset: ProviderPreset | undefined, models: ChannelModel[]): ChannelModel[] {
    return models.map((model) => {
        const override = model.capabilitySource === "user" ? undefined : preset?.capabilities?.[model.name];
        const capability = override || model.capability;
        const capabilitySource = override ? ("preset" as const) : model.capabilitySource;
        const presetScript = preset?.scripts?.[model.name] || preset?.capabilityScripts?.[capability];
        // A hand-written script is the user's, and outranks ours exactly like a hand-set capability.
        if (model.scriptSource === "user") return { ...model, capability, capabilitySource };
        return { ...model, capability, capabilitySource, script: presetScript, scriptSource: presetScript ? ("preset" as const) : undefined };
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

/**
 * Union two model lists by name. A refreshed catalog always wins on metadata (pricing, image-input
 * support, label) and on capability - except where the user set the capability by hand, which is
 * intent we must not overwrite. Locally edited scripts are always preserved.
 */
export function mergeChannelModels(current: ChannelModel[], incoming: ChannelModel[]): ChannelModel[] {
    const map = new Map(current.map((model) => [model.name, model]));
    for (const model of incoming) {
        const existing = map.get(model.name);
        if (!existing) {
            map.set(model.name, model);
            continue;
        }
        const keepCapability = existing.capabilitySource === "user";
        map.set(model.name, {
            ...existing,
            capability: keepCapability ? existing.capability : model.capability,
            capabilitySource: keepCapability ? existing.capabilitySource : model.capabilitySource,
            acceptsImageInput: model.acceptsImageInput ?? existing.acceptsImageInput,
            pricing: model.pricing ?? existing.pricing,
            label: model.label ?? existing.label,
            // Ours to replace unless the user wrote it: a stored preset script that keeps winning is a
            // shipped bug that no refresh can ever reach.
            ...(existing.scriptSource === "user" ? { script: existing.script, scriptSource: existing.scriptSource } : { script: model.script ?? existing.script, scriptSource: model.scriptSource }),
        });
    }
    return Array.from(map.values());
}

/**
 * Connect a channel: pull its whole catalog and fold it into whatever the channel already has.
 * This is the only import path the UI needs - the user picks which model to use in the studio
 * pickers, which filter by capability, so there is nothing to hand-select here.
 */
export async function connectChannel(channel: ModelChannel): Promise<ChannelModel[]> {
    const catalog = await fetchChannelCatalog(channel);
    if (!catalog.length) throw new Error("provider returned an empty model list");
    return mergeChannelModels(channel.models, enrichModelsForChannel(channel, catalog));
}

/** Apply a preset's capability fixes and call scripts to a fetched catalog (or a bare id list). */
export function enrichModelsForChannel(channel: ModelChannel, models: Array<string | CatalogModel>): ChannelModel[] {
    return applyPreset(presetForChannel(channel), normalizeChannelModels(models));
}

export type { ChannelModel };

/**
 * One-shot repair for channels saved before the per-provider call scripts shipped: without it an
 * OpenRouter channel from an earlier build keeps `script: undefined` forever and image requests
 * fall through to the generic OpenAI paths — `/images/edits`, which OpenRouter does not
 * implement, so every image-to-image call 404s.
 *
 * It runs once and records that it did. Re-running on every boot would resurrect a script the
 * user deliberately cleared, because "cleared" and "never had one" are the same stored value.
 *
 * The store's own rehydration cannot do this: it would have to import this module, which
 * imports the store. A script already stored (preset or hand-edited) is never overwritten.
 */
const PRESET_SCRIPTS_MIGRATION = "preset-scripts-v1";

export function healPresetScripts(): void {
    const { config, migrations } = useConfigStore.getState();
    if (migrations[PRESET_SCRIPTS_MIGRATION]) return;
    let changed = false;
    const channels = config.channels.map((channel) => {
        const preset = presetForChannel(channel);
        if (!preset) return channel;
        let channelChanged = false;
        const models = channel.models.map((model) => {
            if (model.script) return model;
            const script = preset.scripts?.[model.name] || preset.capabilityScripts?.[model.capability];
            if (!script) return model;
            channelChanged = true;
            return { ...model, script, scriptSource: "preset" as const };
        });
        if (!channelChanged) return channel;
        changed = true;
        return { ...channel, models };
    });
    // Record the run either way, so a no-op boot still closes the migration out.
    const applied = { ...migrations, [PRESET_SCRIPTS_MIGRATION]: true };
    useConfigStore.setState(changed ? { config: { ...config, channels }, migrations: applied } : { migrations: applied });
}
