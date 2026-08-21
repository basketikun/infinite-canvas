import axios, { type AxiosRequestConfig } from "axios";

import i18n from "@/i18n";
import { buildApiUrl, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { createComfyUiRuntime } from "./comfyui-plugin-runtime";

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
    /** Parsed workflow JSON uploaded for the model (optional); exposed to the script as the `workflow` variable. */
    workflow?: unknown;
    prompt?: string;
    images?: string[];
    videoRefs?: string[];
    audioRefs?: string[];
    /** First-frame reference data URLs (FL2VA); exposed to the script as `firstFrame`. */
    firstFrame?: string[];
    /** Last-frame reference data URLs (FL2VA); exposed to the script as `lastFrame`. */
    lastFrame?: string[];
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
    const comfyui = createComfyUiRuntime(args.signal);
    const runner = new Function(
        "prompt",
        "images",
        "videoRefs",
        "audioRefs",
        "firstFrame",
        "lastFrame",
        "messages",
        "params",
        "workflow",
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
        "comfyui",
        `"use strict"; return (async () => {\n${args.script}\n})();`,
    ) as (...fnArgs: unknown[]) => Promise<T>;
    try {
        return await runner(
            args.prompt || "",
            args.images || [],
            args.videoRefs || [],
            args.audioRefs || [],
            args.firstFrame || [],
            args.lastFrame || [],
            args.messages || [],
            args.params || {},
            args.workflow,
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
            comfyui,
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
        { name: "firstFrame", type: "string[]", desc: i18n.t("modelPlugin.variables.firstFrame"), capabilities: ["video"] },
        { name: "lastFrame", type: "string[]", desc: i18n.t("modelPlugin.variables.lastFrame"), capabilities: ["video"] },
        { name: "messages", type: "{ role, content }[]", desc: i18n.t("modelPlugin.variables.messages"), capabilities: ["text"] },
        { name: "params", type: "object", desc: i18n.t("modelPlugin.variables.params") },
        { name: "workflow", type: "object", desc: i18n.t("modelPlugin.variables.workflow") },
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
        { name: "comfyui", type: "object", desc: i18n.t("modelPlugin.variables.comfyui"), capabilities: ["video"] },
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
                script: `
// @template comfyui-h3-ref2va-v2
// H3 Ref2VA：参考图、参考视频和参考音频由画布连接提供。
// 可用：prompt、images、videoRefs、audioRefs、params、workflow、comfyui。
// 请为该模型上传经过 ComfyUI 验证的 API-format workflow；参考加载节点会按实际输入动态创建。
const WORKFLOW = {
  // 把你在 ComfyUI 里验证过的 H3 工作流导出为 API 格式填到这里。
  // 参考加载节点(LoadImage/LoadVideo/LoadAudio/GetVideoComponents)可以不导出：脚本会按上传的参考数量动态创建并连接
  // ref_images.ref_image_N / ref_videos.ref_video_N / ref_video_audios.ref_video_audio_N / ref_audios.ref_audio_N 槽位。
  // 为让画布 UI 参数生效，工作流建议包含：
  //   ResolutionSelector(比例/像素量) / PrimitiveFloat(时长秒数, 其输出接 ComfyMathExpression 的 values.a) / CreateVideo / VAEDecodeAudio
  // "136": { class_type: "MiniMaxH3ReferenceToVideo", inputs: { clip: ["128", 0], vae: ["119", 0], audio_vae: ["120", 0], prompt: ["138", 0], width: ["115", 0], height: ["115", 1], length: ["131", 1], ref_image_size: "match" } },
};

const wf = JSON.parse(JSON.stringify(workflow || WORKFLOW));
const p = params || {};

// ComfyUI 原生接口没有 /v1，所有请求必须使用基于 baseUrl 的绝对地址（绕开统一 /v1 拼接）
const comfyBase = comfyui.normalizeBaseUrl(baseUrl);

function nodesOf(cls) {
  return Object.values(wf).filter((n) => n && typeof n === "object" && n.class_type === cls);
}

const h3Nodes = nodesOf("MiniMaxH3ReferenceToVideo");
if (h3Nodes.length !== 1) throw new Error("工作流必须且只能包含 1 个 MiniMaxH3ReferenceToVideo 节点");
const h3 = h3Nodes[0];
function linkedNode(value) {
  return Array.isArray(value) && wf[value[0]] && typeof wf[value[0]] === "object" ? wf[value[0]] : null;
}

// ---------- 画布 UI 参数映射 ----------
// 时长：只修改 H3 length 实际连接的 ComfyMathExpression -> PrimitiveFloat 链
if (p.seconds !== undefined) {
  const sec = Math.max(1, Math.min(15, Math.round(Number(p.seconds) || 10)));
  const lengthNode = linkedNode(h3.inputs && h3.inputs.length);
  const src = lengthNode && lengthNode.class_type === "ComfyMathExpression" && lengthNode.inputs && lengthNode.inputs["values.a"];
  if (Array.isArray(src) && wf[src[0]] && wf[src[0]].class_type === "PrimitiveFloat") {
    wf[src[0]].inputs.value = sec;
  }
}

// 比例 + 像素量：ResolutionSelector
const AR_LABEL = {
  "1:1": "1:1 (Square)", "2:3": "2:3 (Portrait Photo)", "3:2": "3:2 (Photo)", "3:4": "3:4 (Portrait Standard)",
  "4:3": "4:3 (Standard)", "9:16": "9:16 (Portrait Widescreen)", "16:9": "16:9 (Widescreen)", "21:9": "21:9 (Ultrawide)"
};
const AR_WH = { "1:1": [1, 1], "2:3": [2, 3], "3:2": [3, 2], "3:4": [3, 4], "4:3": [4, 3], "9:16": [9, 16], "16:9": [16, 9], "21:9": [21, 9] };
function resolveAspect() {
  const mPx = /^(\\d+)x(\\d+)$/.exec(String(p.size || "")) || /^(\\d+)x(\\d+)$/.exec(String(p.ratio || ""));
  if (mPx) {
    const ratio = Number(mPx[1]) / Number(mPx[2]);
    let best = "16:9", bestDiff = Infinity;
    for (const k of Object.keys(AR_WH)) {
      const rw = AR_WH[k][0], rh = AR_WH[k][1];
      const d = Math.abs(Math.log(ratio / (rw / rh)));
      if (d < bestDiff) { bestDiff = d; best = k; }
    }
    return { key: best, w: Number(mPx[1]), h: Number(mPx[2]) };
  }
  const raw = String(p.ratio || "").trim();
  if (AR_LABEL[raw]) return { key: raw, w: 0, h: 0 };
  return null;
}
const resolutionNodes = [linkedNode(h3.inputs && h3.inputs.width), linkedNode(h3.inputs && h3.inputs.height)]
  .filter((node, index, all) => node && node.class_type === "ResolutionSelector" && all.indexOf(node) === index);
for (const n of resolutionNodes) {
  const aspect = resolveAspect();
  const current = String(n.inputs.aspect_ratio || "");
  let key = aspect && aspect.key;
  if (!key) {
    const mCur = /^(\\d+:\\d+)/.exec(current);
    key = mCur && AR_LABEL[mCur[1]] ? mCur[1] : "16:9";
  }
  if (aspect && aspect.key) n.inputs.aspect_ratio = AR_LABEL[key];
  const mRes = /^(\\d+)p?$/i.exec(String(p.resolution || ""));
  if (mRes) {
    // 分辨率档位（如 720p）：短边 = 档位像素
    const rw = AR_WH[key][0], rh = AR_WH[key][1];
    const base = Number(mRes[1]);
    const w = rw >= rh ? Math.round(base * rw / rh) : base;
    const h = rw >= rh ? base : Math.round(base * rh / rw);
    n.inputs.megapixels = Math.max(0.1, Math.min(16, Math.round((w * h / (1024 * 1024)) * 100) / 100));
  } else if (aspect && aspect.w) {
    n.inputs.megapixels = Math.max(0.1, Math.min(16, Math.round((aspect.w * aspect.h / (1024 * 1024)) * 100) / 100));
  }
}

// 生成音频：generateAudio=false 时移除音频解码与合成（画面不受影响）
if (p.generateAudio === false) {
  for (const [id, n] of Object.entries(wf)) {
    if (!n || typeof n !== "object") continue;
    if (n.class_type === "CreateVideo") delete n.inputs.audio;
    if (n.class_type === "VAEDecodeAudio") delete wf[id];
  }
}
// watermark 无本地等价节点，忽略

const referenceCount = (images || []).length + (videoRefs || []).length + (audioRefs || []).length;
if (referenceCount > 12) throw new Error("Ref2VA 模式参考文件合计最多 12 个（图最多 9、视频最多 3、音频最多 3）");
const imgNames = await comfyui.uploadDataUrls(comfyBase, images || [], "ref_img", 9, "参考图");
const vidNames = await comfyui.uploadDataUrls(comfyBase, videoRefs || [], "ref_vid", 3, "参考视频");
const audNames = await comfyui.uploadDataUrls(comfyBase, audioRefs || [], "ref_aud", 3, "参考音频");

// 提示词：只修改 H3 prompt 实际连接的节点，避免覆盖工作流里的文件名等其他字符串
const promptInput = h3.inputs && h3.inputs.prompt;
const promptNode = linkedNode(promptInput);
if (typeof promptInput === "string") h3.inputs.prompt = prompt;
else if (promptNode && promptNode.class_type === "CLIPTextEncode") promptNode.inputs.text = prompt;
else if (promptNode && /^PrimitiveString/.test(promptNode.class_type) && typeof promptNode.inputs.value === "string") promptNode.inputs.value = prompt;
else if (promptNode && typeof promptNode.inputs.prompt === "string") promptNode.inputs.prompt = prompt;
// 种子：关闭随机后固定使用 params.seed（空值兜底为 0），开启时每次生成新种子并随结果返回
const seedValue = p.randomSeed === false ? Math.max(0, Math.floor(Number(p.seed) || 0)) : Math.floor(Math.random() * 1e15);
for (const node of Object.values(wf)) {
  if (!node || typeof node !== "object") continue;
  if (node.class_type === "RandomNoise") node.inputs.noise_seed = seedValue;
  else if (typeof node.inputs.seed === "number") node.inputs.seed = seedValue;
}

// 清空 H3 参考槽 -> 清理孤儿加载节点 -> 按上传数量动态重建
for (const n of h3Nodes) {
  for (const k of Object.keys(n.inputs)) {
    if (/^ref_(images|videos|video_audios|audios)\\./.test(k)) delete n.inputs[k];
  }
}
const keep = new Set();
const stack = [];
for (const node of Object.values(wf)) {
  if (!node || typeof node !== "object") continue;
  for (const v of Object.values(node.inputs || {})) {
    if (Array.isArray(v) && typeof v[0] === "string" && wf[v[0]] && !keep.has(v[0])) { keep.add(v[0]); stack.push(v[0]); }
  }
}
while (stack.length) {
  const node = wf[stack.pop()];
  if (!node || typeof node !== "object") continue;
  for (const v of Object.values(node.inputs || {})) {
    if (Array.isArray(v) && typeof v[0] === "string" && wf[v[0]] && !keep.has(v[0])) { keep.add(v[0]); stack.push(v[0]); }
  }
}
for (const [id, node] of Object.entries(wf)) {
  if (node && typeof node === "object" && /^(LoadImage|LoadVideo|LoadAudio|GetVideoComponents)$/.test(node.class_type) && !keep.has(id)) delete wf[id];
}
// 级联删除依赖已移除节点的断裂节点
for (;;) {
  let changed = false;
  for (const [id, node] of Object.entries(wf)) {
    if (!node || typeof node !== "object") continue;
    for (const v of Object.values(node.inputs || {})) {
      if (Array.isArray(v) && typeof v[0] === "string" && v[0] !== id && !wf[v[0]]) { delete wf[id]; changed = true; break; }
    }
  }
  if (!changed) break;
}
// 重建：图 -> LoadImage；视频 -> LoadVideo + GetVideoComponents(帧+音轨)；音频 -> LoadAudio
function dynamicId(prefix, index) {
  let id = prefix + index;
  while (wf[id]) id = "_" + id;
  return id;
}
imgNames.forEach((name, i) => {
  const id = dynamicId("dyn_img_", i);
  wf[id] = { inputs: { image: name }, class_type: "LoadImage", _meta: { title: "参考图 " + (i + 1) } };
  h3.inputs["ref_images.ref_image_" + i] = [id, 0];
});
vidNames.forEach((name, i) => {
  const id = dynamicId("dyn_vid_", i);
  const gvc = dynamicId("dyn_gvc_", i);
  wf[id] = { inputs: { file: name, "video-preview": "" }, class_type: "LoadVideo", _meta: { title: "参考视频 " + (i + 1) } };
  wf[gvc] = { inputs: { video: [id, 0] }, class_type: "GetVideoComponents", _meta: { title: "视频元素 " + (i + 1) } };
  h3.inputs["ref_videos.ref_video_" + i] = [gvc, 0];
  h3.inputs["ref_video_audios.ref_video_audio_" + i] = [gvc, 1];
});
audNames.forEach((name, i) => {
  const id = dynamicId("dyn_aud_", i);
  wf[id] = { inputs: { audio: name }, class_type: "LoadAudio", _meta: { title: "参考音频 " + (i + 1) } };
  h3.inputs["ref_audios.ref_audio_" + i] = [id, 0];
});

const output = await comfyui.runWorkflow(comfyBase, wf);
return { ...comfyui.toVideoResult(comfyBase, output), seed: seedValue };
`,
            },
            {
                label: i18n.t("modelPlugin.templates.comfyuiH3Fl2va"),
                script: `// @supports first-last-frame
// @template comfyui-h3-fl2va-v2
// H3 FL2VA：首帧、尾帧由画布专用端口提供，不支持参考视频或参考音频。
// 可用：prompt、firstFrame、lastFrame、params、workflow、comfyui。
const WORKFLOW = {
  // 把你在 ComfyUI 里验证过的 FL2VA 工作流导出为 API 格式填到这里
  // （条件节点 MiniMaxH3ImageToVideo，UNet 为 minimax_h3_fl2va_pruned_int8_convrot.safetensors，无音频链）
  // 首尾帧加载节点无需导出：脚本会按 firstFrame / lastFrame 动态创建 LoadImage 并连接 first_frame / last_frame
  // 为让画布 UI 参数生效，工作流建议包含：ResolutionSelector / PrimitiveFloat(时长, 其输出接 ComfyMathExpression 的 values.a)
};


const wf = JSON.parse(JSON.stringify(workflow || WORKFLOW));
const p = params || {};

// ComfyUI 原生接口没有 /v1，所有请求必须使用基于 baseUrl 的绝对地址
const comfyBase = comfyui.normalizeBaseUrl(baseUrl);

function nodesOf(cls) {
  return Object.values(wf).filter((n) => n && typeof n === "object" && n.class_type === cls);
}

const i2vNodes = nodesOf("MiniMaxH3ImageToVideo");
if (i2vNodes.length !== 1) throw new Error("工作流必须且只能包含 1 个 MiniMaxH3ImageToVideo 节点");
const i2v = i2vNodes[0];
function linkedNode(value) {
  return Array.isArray(value) && wf[value[0]] && typeof wf[value[0]] === "object" ? wf[value[0]] : null;
}

// FL2VA 只支持首帧+尾帧两张图；不支持参考视频/音频
// 首帧/尾帧由画布专用端口决定；调用层会把无 slot 的旧连接按顺序回退为首帧、尾帧
if ((firstFrame || []).length + (lastFrame || []).length > 2) throw new Error("FL2VA 模式最多 2 张图：首帧 + 尾帧合计不超过 2 张");
if ((videoRefs || []).length) throw new Error("FL2VA 模式不支持参考视频，请切换到 Ref2VA 模型");
if ((audioRefs || []).length) throw new Error("FL2VA 模式不支持参考音频，请切换到 Ref2VA 模型");

// ---------- 画布 UI 参数映射（与 Ref2VA 版一致）----------
if (p.seconds !== undefined) {
  const sec = Math.max(1, Math.min(15, Math.round(Number(p.seconds) || 10)));
  const lengthNode = linkedNode(i2v.inputs && i2v.inputs.length);
  const src = lengthNode && lengthNode.class_type === "ComfyMathExpression" && lengthNode.inputs && lengthNode.inputs["values.a"];
  if (Array.isArray(src) && wf[src[0]] && wf[src[0]].class_type === "PrimitiveFloat") {
    wf[src[0]].inputs.value = sec;
  }
}
const AR_LABEL = {
  "1:1": "1:1 (Square)", "2:3": "2:3 (Portrait Photo)", "3:2": "3:2 (Photo)", "3:4": "3:4 (Portrait Standard)",
  "4:3": "4:3 (Standard)", "9:16": "9:16 (Portrait Widescreen)", "16:9": "16:9 (Widescreen)", "21:9": "21:9 (Ultrawide)"
};
const AR_WH = { "1:1": [1, 1], "2:3": [2, 3], "3:2": [3, 2], "3:4": [3, 4], "4:3": [4, 3], "9:16": [9, 16], "16:9": [16, 9], "21:9": [21, 9] };
function resolveAspect() {
  const mPx = /^(\\d+)x(\\d+)$/.exec(String(p.size || "")) || /^(\\d+)x(\\d+)$/.exec(String(p.ratio || ""));
  if (mPx) {
    const ratio = Number(mPx[1]) / Number(mPx[2]);
    let best = "16:9", bestDiff = Infinity;
    for (const k of Object.keys(AR_WH)) {
      const d = Math.abs(Math.log(ratio / (AR_WH[k][0] / AR_WH[k][1])));
      if (d < bestDiff) { bestDiff = d; best = k; }
    }
    return { key: best, w: Number(mPx[1]), h: Number(mPx[2]) };
  }
  const raw = String(p.ratio || "").trim();
  if (AR_LABEL[raw]) return { key: raw, w: 0, h: 0 };
  return null;
}
const resolutionNodes = [linkedNode(i2v.inputs && i2v.inputs.width), linkedNode(i2v.inputs && i2v.inputs.height)]
  .filter((node, index, all) => node && node.class_type === "ResolutionSelector" && all.indexOf(node) === index);
for (const n of resolutionNodes) {
  const aspect = resolveAspect();
  const current = String(n.inputs.aspect_ratio || "");
  let key = aspect && aspect.key;
  if (!key) {
    const mCur = /^(\\d+:\\d+)/.exec(current);
    key = mCur && AR_LABEL[mCur[1]] ? mCur[1] : "16:9";
  }
  if (aspect && aspect.key) n.inputs.aspect_ratio = AR_LABEL[key];
  const mRes = /^(\\d+)p?$/i.exec(String(p.resolution || ""));
  if (mRes) {
    const base = Number(mRes[1]);
    const w = AR_WH[key][0] >= AR_WH[key][1] ? Math.round(base * AR_WH[key][0] / AR_WH[key][1]) : base;
    const h = AR_WH[key][0] >= AR_WH[key][1] ? base : Math.round(base * AR_WH[key][1] / AR_WH[key][0]);
    n.inputs.megapixels = Math.max(0.1, Math.min(16, Math.round((w * h / (1024 * 1024)) * 100) / 100));
  } else if (aspect && aspect.w) {
    n.inputs.megapixels = Math.max(0.1, Math.min(16, Math.round((aspect.w * aspect.h / (1024 * 1024)) * 100) / 100));
  }
}

// ---------- 上传首尾帧图 ----------
const firstFrameNames = await comfyui.uploadDataUrls(comfyBase, firstFrame || [], "fl2va_first", 1, "FL2VA 首帧");
const lastFrameNames = await comfyui.uploadDataUrls(comfyBase, lastFrame || [], "fl2va_last", 1, "FL2VA 尾帧");

// ---------- 提示词与种子 ----------
const promptInput = i2v.inputs && i2v.inputs.prompt;
const promptNode = linkedNode(promptInput);
if (typeof promptInput === "string") i2v.inputs.prompt = prompt;
else if (promptNode && promptNode.class_type === "CLIPTextEncode") promptNode.inputs.text = prompt;
else if (promptNode && /^PrimitiveString/.test(promptNode.class_type) && typeof promptNode.inputs.value === "string") promptNode.inputs.value = prompt;
else if (promptNode && typeof promptNode.inputs.prompt === "string") promptNode.inputs.prompt = prompt;
const seedValue = p.randomSeed === false ? Math.max(0, Math.floor(Number(p.seed) || 0)) : Math.floor(Math.random() * 1e15);
for (const node of Object.values(wf)) {
  if (!node || typeof node !== "object") continue;
  if (node.class_type === "RandomNoise") node.inputs.noise_seed = seedValue;
  else if (typeof node.inputs.seed === "number") node.inputs.seed = seedValue;
}

// ---------- 动态连接首尾帧：按角色（first/last）而非位置，只连尾帧也只进 last_frame ----------
delete i2v.inputs.first_frame;
delete i2v.inputs.last_frame;
function dynamicId(prefix, index) {
  let id = prefix + index;
  while (wf[id]) id = "_" + id;
  return id;
}
firstFrameNames.forEach((name, i) => {
  const id = dynamicId("dyn_first_", i);
  wf[id] = { inputs: { image: name }, class_type: "LoadImage", _meta: { title: "首帧" } };
  i2v.inputs.first_frame = [id, 0];
});
lastFrameNames.forEach((name, i) => {
  const id = dynamicId("dyn_last_", i);
  wf[id] = { inputs: { image: name }, class_type: "LoadImage", _meta: { title: "尾帧" } };
  i2v.inputs.last_frame = [id, 0];
});

// ---------- 提交与轮询 ----------
const output = await comfyui.runWorkflow(comfyBase, wf);
return { ...comfyui.toVideoResult(comfyBase, output), seed: seedValue };
`,
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
