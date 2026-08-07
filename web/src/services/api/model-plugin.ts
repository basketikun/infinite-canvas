import axios, { type AxiosRequestConfig } from "axios";

import i18n from "@/i18n";
import { buildApiUrl, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

type RequestOptions = { signal?: AbortSignal };

export type PluginHttpOptions = {
    headers?: Record<string, string>;
    params?: Record<string, unknown>;
    responseType?: "json" | "blob" | "text" | "arraybuffer";
};

export type PluginHttp = {
    url: (path: string) => string;
    post: (path: string, body?: unknown, options?: PluginHttpOptions) => Promise<unknown>;
    get: (path: string, options?: PluginHttpOptions) => Promise<unknown>;
};

export type PluginPollOptions = { intervalMs?: number; timeoutMs?: number };

export type RunPluginArgs = {
    capability: ModelCapability;
    script: string;
    config: AiConfig;
    prompt?: string;
    images?: string[];
    videoRefs?: string[];
    audioRefs?: string[];
    messages?: unknown[];
    params?: Record<string, unknown>;
    signal?: AbortSignal;
    onDelta?: (text: string) => void;
};

function pluginHeaders(extra?: Record<string, string>, hasJsonBody = false): Record<string, string> {
    const headers: Record<string, string> = {};
    if (hasJsonBody) headers["Content-Type"] = "application/json";
    return { ...headers, ...extra };
}

function pluginUrl(config: AiConfig, path: string) {
    if (/^https?:/i.test(path)) return path;
    return buildApiUrl(config.baseUrl, path.startsWith("/") ? path : `/${path}`);
}

function createPluginHttp(config: AiConfig, options?: RequestOptions): PluginHttp {
    const run = async (method: "get" | "post", path: string, body: unknown, opts?: PluginHttpOptions) => {
        const isForm = typeof FormData !== "undefined" && body instanceof FormData;
        const response = await axios.request({
            method,
            url: pluginUrl(config, path),
            data: method === "post" ? body : undefined,
            params: opts?.params,
            headers: pluginHeaders({ Authorization: `Bearer ${config.apiKey}`, ...opts?.headers }, method === "post" && !isForm && body !== undefined),
            responseType: opts?.responseType || "json",
            signal: options?.signal,
        });
        return response.data;
    };
    return {
        url: (path) => pluginUrl(config, path),
        post: (path, body, opts) => run("post", path, body, opts),
        get: (path, opts) => run("get", path, undefined, opts),
    };
}

/** Raw request with no automatic auth header — the script controls method, url, headers, body entirely. */
function createPluginRequest(config: AiConfig, options?: RequestOptions) {
    return async (requestConfig: AxiosRequestConfig & { url: string }) => {
        const response = await axios.request({ ...requestConfig, url: pluginUrl(config, requestConfig.url), signal: options?.signal });
        return response.data;
    };
}

function sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

function createPoll(signal?: AbortSignal) {
    return async function poll<T, R>(request: () => Promise<T>, extract: (value: T) => R | null | undefined | false, options?: PluginPollOptions): Promise<R> {
        const intervalMs = options?.intervalMs ?? 2500;
        const timeoutMs = options?.timeoutMs ?? 300000;
        const deadline = performance.now() + timeoutMs;
        for (;;) {
            if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
            const result = extract(await request());
            if (result !== null && result !== undefined && result !== false) return result;
            if (performance.now() >= deadline) throw new Error(i18n.t("modelPlugin.pollTimeout"));
            await sleep(intervalMs, signal);
        }
    };
}

/**
 * Run a user-authored model call script as an async function body with flat locals (see PLUGIN_VARIABLES):
 *   prompt / images / messages / params        — request input
 *   model / baseUrl / apiKey / systemPrompt / reasoningEffort     — current channel and text settings
 *   http / request / poll / sleep / signal / onDelta    — request helpers
 * The script must `return` the result; each caller normalizes it to its capability's shape.
 */
export async function runModelPlugin<T = unknown>(args: RunPluginArgs): Promise<T> {
    const { config } = args;
    const http = createPluginHttp(config, { signal: args.signal });
    const request = createPluginRequest(config, { signal: args.signal });
    const poll = createPoll(args.signal);
    const runner = new Function(
        "prompt",
        "images",
        "videoRefs",
        "audioRefs",
        "messages",
        "params",
        "model",
        "baseUrl",
        "apiKey",
        "systemPrompt",
        "reasoningEffort",
        "http",
        "request",
        "poll",
        "sleep",
        "signal",
        "onDelta",
        `"use strict"; return (async () => {\n${args.script}\n})();`,
    ) as (...fnArgs: unknown[]) => Promise<T>;
    try {
        return await runner(
            args.prompt || "",
            args.images || [],
            args.videoRefs || [],
            args.audioRefs || [],
            args.messages || [],
            args.params || {},
            config.model,
            config.baseUrl,
            config.apiKey,
            config.systemPrompt || "",
            config.reasoningEffort,
            http,
            request,
            poll,
            (ms: number) => sleep(ms, args.signal),
            args.signal,
            args.onDelta,
        );
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        if (axios.isCancel(error)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(i18n.t("modelPlugin.executionFailed", { message }));
    }
}

export type PluginVariable = { name: string; type: string; desc: string; capabilities?: ModelCapability[] };

/** Documentation surface shown in the script editor. */
export function getPluginVariables(): PluginVariable[] {
    return [
        { name: "prompt", type: "string", desc: i18n.t("modelPlugin.variables.prompt"), capabilities: ["image", "video", "audio"] },
        { name: "images", type: "string[]", desc: i18n.t("modelPlugin.variables.images"), capabilities: ["image", "video"] },
        { name: "videoRefs", type: "string[]", desc: i18n.t("modelPlugin.variables.videoRefs"), capabilities: ["video"] },
        { name: "audioRefs", type: "string[]", desc: i18n.t("modelPlugin.variables.audioRefs"), capabilities: ["video"] },
        { name: "messages", type: "{ role, content }[]", desc: i18n.t("modelPlugin.variables.messages"), capabilities: ["text"] },
        { name: "params", type: "object", desc: i18n.t("modelPlugin.variables.params") },
        { name: "model", type: "string", desc: i18n.t("modelPlugin.variables.model") },
        { name: "baseUrl", type: "string", desc: i18n.t("modelPlugin.variables.baseUrl") },
        { name: "apiKey", type: "string", desc: i18n.t("modelPlugin.variables.apiKey") },
        { name: "systemPrompt", type: "string", desc: i18n.t("modelPlugin.variables.systemPrompt") },
        { name: "reasoningEffort", type: '"auto" | "low" | "medium" | "high" | "xhigh"', desc: i18n.t("modelPlugin.variables.reasoningEffort"), capabilities: ["text"] },
        { name: "http", type: "object", desc: i18n.t("modelPlugin.variables.http") },
        { name: "request", type: "function", desc: i18n.t("modelPlugin.variables.request") },
        { name: "poll", type: "function", desc: i18n.t("modelPlugin.variables.poll") },
        { name: "sleep", type: "function", desc: i18n.t("modelPlugin.variables.sleep") },
        { name: "signal", type: "AbortSignal", desc: i18n.t("modelPlugin.variables.signal") },
        { name: "onDelta", type: "function", desc: i18n.t("modelPlugin.variables.onDelta"), capabilities: ["text"] },
    ];
}

export function getPluginReturn(capability: ModelCapability) {
    return i18n.t(`modelPlugin.returns.${capability}`);
}

export type PluginTemplate = { label: string; script: string };

export function getPluginTemplates(): Record<ModelCapability, PluginTemplate[]> {
    return {
    image: [
        {
            label: i18n.t("modelPlugin.templates.openai"),
            script: `// ${i18n.t("modelPlugin.templates.imageOpenai")}
// ${i18n.t("modelPlugin.templates.availableImage")}
if (images.length === 0) {
  // ${i18n.t("modelPlugin.templates.textToImage")}
  const data = await request({
    method: "post",
    url: \`\${baseUrl}/v1/images/generations\`,
    headers: { "Content-Type": "application/json", Authorization: \`Bearer \${apiKey}\` },
    data: { model, prompt, n: params.count, size: params.size, response_format: "b64_json" },
  });
  return (data.data || []).map((item) => item.b64_json ? \`data:image/png;base64,\${item.b64_json}\` : item.url);
}

// ${i18n.t("modelPlugin.templates.imageToImage")}
const form = new FormData();
form.set("model", model);
form.set("prompt", prompt);
form.set("n", String(params.count));
form.set("response_format", "b64_json");
for (const dataUrl of images) {
  form.append("image", await (await fetch(dataUrl)).blob(), "ref.png");
}
const edited = await request({
  method: "post",
  url: \`\${baseUrl}/v1/images/edits\`,
  headers: { Authorization: \`Bearer \${apiKey}\` }, // ${i18n.t("modelPlugin.templates.formDataHeader")}
  data: form,
});
return (edited.data || []).map((item) => item.b64_json ? \`data:image/png;base64,\${item.b64_json}\` : item.url);`,
        },
        {
            label: i18n.t("modelPlugin.templates.gemini"),
            script: `// ${i18n.t("modelPlugin.templates.imageGemini")}
// ${i18n.t("modelPlugin.templates.availableImageGemini")}
const parts = [{ text: prompt }];
for (const dataUrl of images) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (match) parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
}
const data = await request({
  method: "post",
  url: \`\${baseUrl}/v1beta/models/\${model}:generateContent\`,
  headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
  data: { contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE"] } },
});
return (data.candidates || [])
  .flatMap((c) => c.content?.parts || [])
  .map((p) => p.inlineData || p.inline_data)
  .filter(Boolean)
  .map((img) => \`data:\${img.mimeType || img.mime_type || "image/png"};base64,\${img.data}\`);`,
        },
    ],
    video: [
        {
            label: i18n.t("modelPlugin.templates.comfyuiH3"),
            script: `// ${i18n.t("modelPlugin.templates.comfyuiH3Hint")}
// ${i18n.t("modelPlugin.templates.availableComfyuiH3")}
// ${i18n.t("modelPlugin.templates.comfyuiWorkflow")}
const WORKFLOW = {
  // "1": { class_type: "LoadImage", inputs: { image: "ref.png" } },
  // "2": { class_type: "LoadVideo", inputs: { file: "ref.mp4" } },
  // "3": { class_type: "LoadAudio", inputs: { audio: "ref.wav" } },
  // "4": { class_type: "MiniMaxH3ReferenceToVideo", inputs: { clip: ["5", 0], vae: ["5", 1], audio_vae: ["5", 2], prompt: "...", width: 1280, height: 720, length: 97, ref_image_size: "1.0", ref_images: [["1", 0]], ref_videos: [["2", 0]], ref_audios: [["3", 0]] } },
  // ...
};

const wf = JSON.parse(JSON.stringify(WORKFLOW));

// ${i18n.t("modelPlugin.templates.uploadRefs")}
// ${i18n.t("modelPlugin.templates.networkRetry")}
async function retry(fn, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { lastErr = e; await sleep(800 * (i + 1)); }
  }
  throw lastErr;
}
const extMap = { "image/png": "png", "image/jpeg": "jpg", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/flac": "flac", "audio/aac": "aac", "audio/ogg": "ogg" };
function refExt(dataUrl) {
  const m = /^data:([^;,]+)/.exec(dataUrl);
  return (m && extMap[m[1]]) || "bin";
}
async function uploadRefs(dataUrls, prefix) {
  const names = [];
  for (let i = 0; i < dataUrls.length; i++) {
    const blob = await (await fetch(dataUrls[i])).blob();
    const form = new FormData();
    form.set("image", blob, prefix + "_" + i + "." + refExt(dataUrls[i]));
    const up = await retry(() => http.post("/upload/image", form));
    names.push(up.name);
  }
  return names;
}
const imgNames = await uploadRefs(images || [], "ref_img");
const vidNames = await uploadRefs(videoRefs || [], "ref_vid");
const audNames = await uploadRefs(audioRefs || [], "ref_aud");
// 注入循环会 shift 清空数组，必须先记录实际上传数量
const used = { img: imgNames.length, vid: vidNames.length, aud: audNames.length };

// ${i18n.t("modelPlugin.templates.injectRefs")}
for (const node of Object.values(wf)) {
  if (!node || typeof node !== "object") continue;
  if (node.class_type === "LoadImage" && imgNames.length) node.inputs.image = imgNames.shift();
  else if (node.class_type === "LoadVideo" && vidNames.length) node.inputs.file = vidNames.shift();
  else if (node.class_type === "LoadAudio" && audNames.length) node.inputs.audio = audNames.shift();
  else if (node.class_type === "CLIPTextEncode") node.inputs.text = prompt;
  else if (/^PrimitiveString/.test(node.class_type) && typeof node.inputs.value === "string") node.inputs.value = prompt;
  else if (typeof node.inputs?.prompt === "string") node.inputs.prompt = prompt;
  if (node.class_type === "RandomNoise") node.inputs.noise_seed = Math.floor(Math.random() * 1e15);
  else if (typeof node.inputs?.seed === "number") node.inputs.seed = Math.floor(Math.random() * 1e15);
}

// ${i18n.t("modelPlugin.templates.trimRefs")}
function trimRefs(w, used) {
  const specs = [["ref_images", used.img], ["ref_videos", used.vid], ["ref_video_audios", used.vid], ["ref_audios", used.aud]];
  for (const node of Object.values(w)) {
    if (!node || typeof node !== "object") continue;
    if (node.class_type !== "MiniMaxH3ReferenceToVideo") continue;
    const inps = node.inputs || {};
    for (const [slotKey, n] of specs) {
      Object.keys(inps).filter((k) => k.startsWith(slotKey + ".")).slice(n).forEach((k) => delete inps[k]);
    }
  }
  // 从保留的参考槽出发做可达性分析，保留下游引用链（如 LoadVideo -> GetVideoComponents）
  const keep = new Set();
  const stack = [];
  for (const node of Object.values(w)) {
    if (!node || typeof node !== "object") continue;
    if (node.class_type !== "MiniMaxH3ReferenceToVideo") continue;
    for (const v of Object.values(node.inputs || {})) {
      if (Array.isArray(v) && typeof v[0] === "string" && w[v[0]] && !keep.has(v[0])) { keep.add(v[0]); stack.push(v[0]); }
    }
  }
  while (stack.length) {
    const nid = stack.pop();
    const node = w[nid];
    if (!node || typeof node !== "object") continue;
    for (const v of Object.values(node.inputs || {})) {
      if (Array.isArray(v) && typeof v[0] === "string" && w[v[0]] && !keep.has(v[0])) { keep.add(v[0]); stack.push(v[0]); }
    }
  }
  for (const [id, node] of Object.entries(w)) {
    if (node && typeof node === "object" && /^(LoadImage|LoadVideo|LoadAudio|GetVideoComponents)$/.test(node.class_type) && !keep.has(id)) delete w[id];
  }
  // ${i18n.t("modelPlugin.templates.cascadeTrim")}
  for (;;) {
    let changed = false;
    for (const [id, node] of Object.entries(w)) {
      if (!node || typeof node !== "object") continue;
      for (const v of Object.values(node.inputs || {})) {
        if (Array.isArray(v) && typeof v[0] === "string" && v[0] !== id && !w[v[0]]) { delete w[id]; changed = true; break; }
      }
    }
    if (!changed) break;
  }
}
trimRefs(wf, used);

const client_id = "canvas-" + Math.random().toString(36).slice(2);
const resp = await retry(() => http.post("/prompt", { prompt: wf, client_id }));
if (!resp.prompt_id) throw new Error("ComfyUI: " + JSON.stringify(resp));
const id = resp.prompt_id;

const outs = await poll(
  () => retry(() => http.get(\`/history/\${id}\`)),
  (h) => {
    const run = h[id] || h[Object.keys(h)[0]];
    if (!run) return null;
    if (run.status?.status_str === "error") {
      throw new Error("ComfyUI: " + (run.status.messages?.at?.(-1)?.[1]?.message || "execution error"));
    }
    if (run.status?.completed) {
      const files = Object.values(run.outputs || {}).flatMap((o) => o.gifs || o.images || []);
      return files.length ? files : null;
    }
    return null;
  },
  { intervalMs: 5000, timeoutMs: 1200000 },
);
const f = outs[0];
return {
  url: http.url(\`/view?filename=\${encodeURIComponent(f.filename)}&subfolder=\${encodeURIComponent(f.subfolder || "")}&type=\${f.type}\`),
  mimeType: /\\.(mp4|webm|mov|mkv)$/i.test(f.filename) ? "video/mp4" : undefined,
};`,
        },
        {
            label: i18n.t("modelPlugin.templates.openai"),
            script: `// ${i18n.t("modelPlugin.templates.videoOpenai")}
const headers = { "Content-Type": "application/json", Authorization: \`Bearer \${apiKey}\` };
const task = await request({
  method: "post",
  url: \`\${baseUrl}/v1/videos\`,
  headers,
  data: { model, prompt, seconds: params.seconds },
});
return await poll(
  () => request({ method: "get", url: \`\${baseUrl}/v1/videos/\${task.id}\`, headers }),
  (state) => state.status === "completed" ? { url: state.video_url || state.url } : null,
  { intervalMs: 2500, timeoutMs: 300000 },
);`,
        },
        {
            label: i18n.t("modelPlugin.templates.gemini"),
            script: `// ${i18n.t("modelPlugin.templates.videoGemini")}
// ${i18n.t("modelPlugin.templates.availableVideoGemini")}
const headers = { "Content-Type": "application/json", "x-goog-api-key": apiKey };
const instance = { prompt };
const first = images[0] && images[0].match(/^data:([^;]+);base64,(.*)$/);
if (first) instance.image = { bytesBase64Encoded: first[2], mimeType: first[1] };
const op = await request({
  method: "post",
  url: \`\${baseUrl}/v1beta/models/\${model}:predictLongRunning\`,
  headers,
  data: { instances: [instance], parameters: { aspectRatio: params.ratio } },
});
return await poll(
  () => request({ method: "get", url: \`\${baseUrl}/v1beta/\${op.name}\`, headers }),
  (state) => {
    if (!state.done) return null;
    const uri = state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (!uri) throw new Error(${JSON.stringify(i18n.t("modelPlugin.templates.geminiNoVideoUri"))});
    return { url: uri.includes("key=") ? uri : \`\${uri}\${uri.includes("?") ? "&" : "?"}key=\${apiKey}\` };
  },
  { intervalMs: 5000, timeoutMs: 300000 },
);`,
        },
    ],
    audio: [
        {
            label: i18n.t("modelPlugin.templates.openai"),
            script: `// ${i18n.t("modelPlugin.templates.audioOpenai")}
return await request({
  method: "post",
  url: \`\${baseUrl}/v1/audio/speech\`,
  headers: { "Content-Type": "application/json", Authorization: \`Bearer \${apiKey}\` },
  responseType: "blob",
  data: { model, input: prompt, voice: params.voice, response_format: params.format, speed: Number(params.speed) },
});`,
        },
        {
            label: i18n.t("modelPlugin.templates.gemini"),
            script: `// ${i18n.t("modelPlugin.templates.audioGemini")}
// ${i18n.t("modelPlugin.templates.availableAudioGemini")}
const data = await request({
  method: "post",
  url: \`\${baseUrl}/v1beta/models/\${model}:generateContent\`,
  headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
  data: {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: params.voice } } },
    },
  },
});
const audio = data.candidates?.[0]?.content?.parts?.map((p) => p.inlineData || p.inline_data).find(Boolean);
if (!audio?.data) throw new Error(${JSON.stringify(i18n.t("modelPlugin.templates.geminiNoAudio"))});
return { data: audio.data };`,
        },
    ],
    text: [
        {
            label: i18n.t("modelPlugin.templates.openai"),
            script: `// ${i18n.t("modelPlugin.templates.textOpenai")}
const data = await request({
  method: "post",
  url: \`\${baseUrl}/v1/responses\`,
  headers: { "Content-Type": "application/json", Authorization: \`Bearer \${apiKey}\` },
  data: {
    model,
    input: messages,
    ...(reasoningEffort === "auto" ? {} : { reasoning: { effort: reasoningEffort } }),
  },
});
const text = data.output_text
  || (data.output || []).flatMap((o) => o.content || []).map((c) => c.text || "").join("")
  || "";
onDelta(text);
return text;`,
        },
        {
            label: i18n.t("modelPlugin.templates.gemini"),
            script: `// ${i18n.t("modelPlugin.templates.textGemini")}
// ${i18n.t("modelPlugin.templates.availableTextGemini")}
const contents = messages
  .filter((m) => m.role !== "system")
  .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
const data = await request({
  method: "post",
  url: \`\${baseUrl}/v1beta/models/\${model}:generateContent\`,
  headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
  data: { contents, ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}) },
});
const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
onDelta(text);
return text;`,
        },
    ],
    };
}

/** Normalize whatever an image script returns into the app's generated-image shape. */
export function normalizePluginImages(result: unknown): string[] {
    const items = Array.isArray(result) ? result : [result];
    const urls = items
        .map((item) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object") {
                const record = item as Record<string, unknown>;
                if (typeof record.dataUrl === "string") return record.dataUrl;
                if (typeof record.url === "string") return record.url;
                if (typeof record.b64_json === "string") return `data:image/png;base64,${record.b64_json}`;
            }
            return "";
        })
        .filter(Boolean);
    if (!urls.length) throw new Error(i18n.t("modelPlugin.noImages"));
    return urls;
}
