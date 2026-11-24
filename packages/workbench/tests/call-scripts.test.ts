import assert from "node:assert/strict";
import { test } from "node:test";
import { lexer, walkTokens } from "marked";
import { builtinCallScripts } from "@infinite-canvas/model-runtime/call-scripts/builtin";
import type { CallScript } from "@infinite-canvas/shared/models";

// 只运行真实脚本 main；网络、流事件与素材转换使用固定样例，不需要账号。
// 协议依据与测试范围见 apps/docs/content/docs/development/call-scripts.mdx「输入输出测试」。
const root = "https://provider.example/gateway";
const imageUrl = "https://cdn.example/reference.png";
const lastImageUrl = "https://cdn.example/last.png";
const videoUrl = "https://cdn.example/result.mp4";
const audioUrl = "https://cdn.example/audio.mp3";
const imageData = "data:image/png;base64,AA==";
const videoData = "data:video/mp4;base64,AA==";
const audioData = "data:audio/wav;base64,AA==";
const imageBlob = new Blob(["image"], { type: "image/png" });
const videoBlob = new Blob(["video"], { type: "video/mp4" });
const audioBlob = new Blob(["audio"], { type: "audio/mpeg" });
const bearer = { Authorization: "Bearer test-key" };
const google = { "x-goog-api-key": "test-key" };
const messages = [
    { role: "system", content: "请用中文回答" },
    { role: "user", content: "你好" },
];
const options = {
    image: { size: "1024x1024", ratio: "1:1", resolution: "1K", quality: "high", count: 1, background: "transparent" },
    video: { mode: "frames", seconds: "6", size: "1280x720", resolution: "720p", ratio: "16:9", generateAudio: true, watermark: false },
    audio: { voice: "alloy", format: "mp3", speed: "1.25", instructions: "轻声朗读" },
    text: {},
};

type Input = {
    model?: string;
    images?: string[];
    videos?: string[];
    audios?: string[];
    messages?: unknown[];
    taskId?: string;
    options?: Record<string, unknown>;
};
type Request = {
    method: string;
    url: string;
    headers: Record<string, string>;
    data?: unknown;
    params?: Record<string, unknown>;
    responseType?: string;
};
type Step = Request & { response: unknown };
type Case = {
    name: string;
    input?: Input;
    steps: Step[];
    result?: unknown;
    deltas?: string[];
    error?: RegExp;
};
type Fixture = { id: string; cases: Case[] };

async function checkCase(script: CallScript, sample: Case) {
    const requests: Request[] = [];
    const deltas: string[] = [];
    const request = async (value: Request) => {
        const index = requests.length;
        requests.push(value);
        assert.ok(index < sample.steps.length, "出现未声明的请求");
        const response = sample.steps[index].response;
        if (response instanceof Error) throw response;
        return structuredClone(response);
    };
    const main = new Function(script.source + "\nreturn main;")();
    let result: unknown;
    let failure: unknown;
    try {
        result = await main({
            capability: script.capability,
            model: "test-model",
            baseUrl: root + "/v1",
            apiKey: "test-key",
            prompt: "测试提示词",
            systemPrompt: "请用中文回答",
            reasoningEffort: "high",
            messages,
            images: [],
            videos: [],
            audios: [],
            ...sample.input,
            options: { ...options[script.capability], ...sample.input?.options },
            utils: {
                request,
                http: {
                    url: (path: string) => root + "/v1" + path,
                    post: (path: string, data: unknown, config: Partial<Request> = {}) => request({ method: "post", url: root + "/v1" + path, headers: bearer, data, ...config }),
                    get: (path: string, config: Partial<Request> = {}) => request({ method: "get", url: root + "/v1" + path, headers: bearer, ...config }),
                },
                stream: async (value: Request, onEvent: (event: unknown) => void) => {
                    const events = await request({ ...value, method: "post" }) as unknown[];
                    for (const event of events) onEvent(event);
                },
                onDelta: (text: string) => deltas.push(text),
                toBlob: async (source: string) => {
                    assert.ok([imageUrl, lastImageUrl, videoUrl, audioUrl].includes(source), "未知参考素材");
                    return source === videoUrl ? videoBlob : source === audioUrl ? audioBlob : imageBlob;
                },
                toDataUrl: async (source: string) => {
                    assert.ok([imageUrl, lastImageUrl, imageData, "blob:image", "blob:video", "blob:audio"].includes(source), "未知素材输入");
                    return source === "blob:video" ? videoData : source === "blob:audio" ? audioData : imageData;
                },
                toPublicUrl: async (source: string) => {
                    assert.ok([imageUrl, lastImageUrl, videoUrl, audioUrl].includes(source), "未知公开素材");
                    return source;
                },
                markdownImages: (text: string) => {
                    const urls: string[] = [];
                    walkTokens(lexer(text), (token) => { if (token.type === "image") urls.push(token.href); });
                    return urls;
                },
            },
        });
    } catch (error) {
        failure = error;
    }
    assert.equal(requests.length, sample.steps.length, "请求数量不符合预期");
    for (const [index, actual] of requests.entries()) {
        const { response, ...expected } = sample.steps[index];
        const data = actual.data instanceof FormData
            ? await Promise.all([...actual.data].map(async ([key, value]) => [key, typeof value === "string" ? value : { name: value.name, type: value.type, text: await value.text() }]))
            : actual.data;
        // timeout 由已有调用策略负责；这里比较路径、鉴权、完整正文及下载类型。
        assert.deepEqual({ method: actual.method, url: actual.url, headers: actual.headers, data, params: actual.params, responseType: actual.responseType }, { data: undefined, params: undefined, responseType: undefined, ...expected });
    }
    if (sample.error) {
        assert.ok(failure instanceof Error, "应拒绝该输入或响应");
        assert.match(failure.message, sample.error);
    } else {
        assert.ifError(failure);
        assert.deepEqual(result, sample.result);
        if (result instanceof Blob && sample.result instanceof Blob) {
            assert.equal(result.type, sample.result.type);
            assert.deepEqual(await result.arrayBuffer(), await sample.result.arrayBuffer());
        }
    }
    if (sample.deltas) assert.deepEqual(deltas, sample.deltas);
}

const fixtures: Fixture[] = [
    {
        id: "grok-image",
        cases: [
            {
                name: "官方文生图字段、批量数量与图片 URL",
                input: { model: "grok-imagine-image-2.0", options: { count: 2, resolution: "2K", quality: "medium" } },
                steps: [{
                    method: "post", url: root + "/v1/images/generations", headers: bearer,
                    data: { model: "grok-imagine-image-2.0", prompt: "测试提示词", n: 2, response_format: "url", aspect_ratio: "1:1", resolution: "2k", quality: "medium" },
                    response: { data: [{ url: imageUrl, mime_type: "image/jpeg" }, { url: lastImageUrl, mime_type: "image/png" }] },
                }],
                result: [{ url: imageUrl }, { url: lastImageUrl }],
            },
            {
                name: "自动设置省略尺寸和质量，不发送 Images 专属字段",
                input: { model: "grok-imagine-image-2.0", options: { ratio: undefined, resolution: undefined, quality: undefined } },
                steps: [{
                    method: "post", url: root + "/v1/images/generations", headers: bearer,
                    data: { model: "grok-imagine-image-2.0", prompt: "测试提示词", n: 1, response_format: "url" },
                    response: { data: [{ url: imageUrl }] },
                }],
                result: [{ url: imageUrl }],
            },
            ...[imageUrl, "blob:image"].map((source): Case => ({
                name: "单图 JSON 编辑：" + (source === imageUrl ? "保留公开链接" : "本地图片转 Base64"),
                input: { model: "grok-imagine-image-2.0", images: [source], options: { quality: "low" } },
                steps: [{
                    method: "post", url: root + "/v1/images/edits", headers: bearer,
                    data: {
                        model: "grok-imagine-image-2.0", prompt: "测试提示词", n: 1, response_format: "url",
                        aspect_ratio: "1:1", resolution: "1k", quality: "low",
                        image: { type: "image_url", url: source === imageUrl ? imageUrl : imageData },
                    },
                    response: { data: [{ url: lastImageUrl }] },
                }],
                result: [{ url: lastImageUrl }],
            })),
            {
                name: "多图 JSON 编辑使用 images，保持图片顺序与 data URL",
                input: { model: "grok-imagine-image-2.0", images: [imageData, lastImageUrl], options: { quality: undefined } },
                steps: [{
                    method: "post", url: root + "/v1/images/edits", headers: bearer,
                    data: {
                        model: "grok-imagine-image-2.0", prompt: "测试提示词", n: 1, response_format: "url",
                        aspect_ratio: "1:1", resolution: "1k",
                        images: [{ type: "image_url", url: imageData }, { type: "image_url", url: lastImageUrl }],
                    },
                    response: { data: [{ url: imageUrl }] },
                }],
                result: [{ url: imageUrl }],
            },
        ],
    },
    {
        id: "openai-image",
        cases: [{
            name: "文生图字段与 Base64 结果",
            input: { model: "gpt-image-1" },
            steps: [{
                method: "post", url: root + "/v1/images/generations", headers: bearer,
                data: {
                    model: "gpt-image-1",
                    prompt: "测试提示词",
                    n: 1,
                    output_format: "png",
                    size: "1024x1024",
                    quality: "high",
                    background: "transparent",
                },
                response: { created: 123, data: [{ b64_json: "AA==" }] },
            }],
            result: [{ b64_json: "AA==" }],
        }],
    },
    {
        id: "openai-chat-image",
        cases: [{
            name: "聊天生图参考图与结构化图片结果",
            input: { images: [imageUrl] },
            steps: [{
                method: "post", url: root + "/v1/chat/completions", headers: bearer,
                data: {
                    model: "test-model",
                    messages: [{ role: "user", content: [{ type: "text", text: "测试提示词" }, { type: "image_url", image_url: { url: imageUrl } }] }],
                    modalities: ["text", "image"],
                    stream: false,
                    image_config: { aspect_ratio: "1:1", image_size: "1K" },
                },
                response: { choices: [{ finish_reason: "stop", message: { content: "完成", images: [{ type: "image_url", image_url: { url: imageData } }] } }] },
            }],
            result: [imageData],
        }],
    },
    {
        id: "openai-responses-image",
        cases: [{
            name: "图片工具请求与混合 output 解析",
            input: { images: [imageUrl] },
            steps: [{
                method: "post", url: root + "/v1/responses", headers: bearer,
                data: {
                    model: "test-model",
                    input: [{ role: "user", content: [{ type: "input_text", text: "测试提示词" }, { type: "input_image", image_url: imageUrl }] }],
                    tools: [{ type: "image_generation", output_format: "png", size: "1024x1024", quality: "high", background: "transparent" }],
                    tool_choice: { type: "image_generation" },
                    stream: false,
                },
                response: { status: "completed", output: [{ type: "message", content: [] }, { type: "image_generation_call", status: "completed", result: "AA==" }] },
            }],
            result: [imageData],
        }],
    },
    {
        id: "gemini-image",
        cases: [{
            name: "内联参考图、图片设置与混合图文结果",
            input: { images: [imageData] },
            steps: [{
                method: "post", url: root + "/v1beta/models/test-model:generateContent", headers: google,
                data: {
                    contents: [{ role: "user", parts: [{ text: "测试提示词" }, { inlineData: { mimeType: "image/png", data: "AA==" } }] }],
                    generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: "1K" } },
                },
                response: { candidates: [{ content: { parts: [{ text: "完成" }, { inlineData: { mimeType: "image/png", data: "AA==" } }, { fileData: { fileUri: imageUrl } }] } }] },
            }],
            result: [imageData, imageUrl],
        }],
    },
    {
        id: "agnes-image",
        cases: [{
            name: "参考图扩展字段与 URL 结果",
            input: { images: [imageUrl] },
            steps: [{
                method: "post", url: root + "/v1/images/generations", headers: bearer,
                data: {
                    model: "test-model",
                    prompt: "测试提示词",
                    size: "1K",
                    ratio: "1:1",
                    extra_body: { image: [imageUrl], response_format: "b64_json" },
                },
                response: { data: [{ url: imageUrl }] },
            }],
            result: [{ url: imageUrl }],
        }],
    },
    {
        id: "openai-text",
        cases: [{
            name: "Responses 请求与流式文本累计",
            steps: [{
                method: "post", url: root + "/v1/responses", headers: bearer,
                data: { model: "test-model", input: messages, stream: true, reasoning: { effort: "high" } },
                response: [
                    { type: "response.output_text.delta", delta: "你" },
                    { type: "response.output_text.delta", delta: "好" },
                    { type: "response.completed", response: { status: "completed" } },
                ],
            }],
            result: "你好",
            deltas: ["你", "你好", "你好"],
        }],
    },
    {
        id: "openai-chat-text",
        cases: [{
            name: "Chat 请求、流式增量与停止状态",
            steps: [{
                method: "post", url: root + "/v1/chat/completions", headers: bearer,
                data: { model: "test-model", messages, stream: true, reasoning_effort: "high" },
                response: [
                    { choices: [{ delta: { content: "你" }, finish_reason: null }] },
                    { choices: [{ delta: { content: "好" }, finish_reason: "stop" }] },
                ],
            }],
            result: "你好",
            deltas: ["你", "你好"],
        }],
    },
    {
        id: "anthropic-text",
        cases: [{
            name: "独立 system、消息与文本增量",
            steps: [{
                method: "post", url: root + "/v1/messages",
                headers: { "x-api-key": "test-key", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
                data: {
                    model: "test-model",
                    messages: [{ role: "user", content: "你好" }],
                    system: [{ type: "text", text: "请用中文回答" }],
                    max_tokens: 16384,
                    stream: true,
                },
                response: [
                    { type: "content_block_start", content_block: { type: "text", text: "你" } },
                    { type: "content_block_delta", delta: { type: "text_delta", text: "好" } },
                    { type: "message_delta", delta: { stop_reason: "end_turn" } },
                    { type: "message_stop" },
                ],
            }],
            result: "你好",
            deltas: ["你", "你好", "你好", "你好"],
        }],
    },
    {
        id: "gemini-text",
        cases: [{
            name: "Gemini 消息结构、系统提示与正文累计",
            steps: [{
                method: "post", url: root + "/v1beta/models/test-model:streamGenerateContent?alt=sse", headers: google,
                data: {
                    contents: [{ role: "user", parts: [{ text: "你好" }] }],
                    systemInstruction: { parts: [{ text: "请用中文回答" }] },
                },
                response: [
                    { candidates: [{ content: { parts: [{ thought: true, text: "内部思考" }, { text: "你" }] } }] },
                    { candidates: [{ content: { parts: [{ text: "好" }] }, finishReason: "STOP" }] },
                ],
            }],
            result: "你好",
            deltas: ["你", "你好"],
        }],
    },
    {
        id: "agnes-text",
        cases: [{
            name: "原始消息透传与文本累计",
            steps: [{
                method: "post", url: root + "/v1/chat/completions", headers: bearer,
                data: { model: "test-model", messages, stream: true },
                response: [
                    { choices: [{ delta: { content: "你" } }] },
                    { choices: [{ delta: { content: "好" }, finish_reason: "stop" }] },
                ],
            }],
            result: "你好",
            deltas: ["你", "你好"],
        }],
    },
    {
        id: "openai-audio",
        cases: [{
            name: "Speech 音色、语速和二进制音频",
            steps: [{
                method: "post", url: root + "/v1/audio/speech", headers: bearer,
                data: {
                    model: "test-model",
                    input: "测试提示词",
                    voice: "alloy",
                    response_format: "mp3",
                    speed: 1.25,
                    instructions: "轻声朗读",
                },
                responseType: "blob",
                response: audioBlob,
            }],
            result: audioBlob,
        }],
    },
    {
        id: "openai-chat-audio",
        cases: [{
            name: "聊天音频、PCM 格式映射与 Base64 结果",
            input: { options: { format: "pcm" } },
            steps: [{
                method: "post", url: root + "/v1/chat/completions", headers: bearer,
                data: {
                    model: "test-model",
                    modalities: ["text", "audio"],
                    audio: { voice: "alloy", format: "pcm16" },
                    stream: false,
                    messages: [
                        { role: "system", content: "Read the user's text aloud verbatim. Do not answer or explain it.\nSpeak at 1.25 times normal speaking speed.\n轻声朗读" },
                        { role: "user", content: "测试提示词" },
                    ],
                },
                response: { choices: [{ finish_reason: "stop", message: { audio: { id: "audio-1", data: "AA==", transcript: "测试提示词" } } }] },
            }],
            result: { data: "AA==" },
        }],
    },
];

type VideoFixture = {
    id: string;
    create: Case;
    taskId?: string;
    query: Omit<Step, "response">;
    pending: unknown[];
    failed: unknown;
    completed: unknown;
    downloads?: Step[];
    result?: unknown;
    invalid?: Input;
};

const videoFixtures: VideoFixture[] = [
    {
        id: "grok2api-video",
        create: {
            name: "Grok2API 严格 JSON 字段与 request_id，不发送声音和水印开关",
            steps: [{
                method: "post", url: root + "/v1/videos/generations", headers: bearer,
                data: { model: "test-model", prompt: "测试提示词", duration: "6", aspect_ratio: "16:9", resolution: "720p" },
                response: { request_id: "task-1" },
            }],
            result: { id: "task-1" },
        },
        query: { method: "get", url: root + "/v1/videos/task-1", headers: bearer },
        pending: [{ status: "pending", progress: 30 }],
        failed: { status: "failed", error: { code: "generation_failed", message: "模拟服务错误" } },
        completed: { status: "done", video: { url: videoUrl, respect_moderation: true } },
        invalid: { images: [imageUrl, lastImageUrl] },
    },
    ...["openai-video", "openai-multimodal-video"].map((id): VideoFixture => ({
        id,
        create: {
            name: "文件表单与创建任务 ID",
            input: { images: [imageUrl] },
            steps: [{
                method: "post", url: root + "/v1/videos", headers: bearer,
                data: id === "openai-video" ? [
                    ["model", "test-model"], ["prompt", "测试提示词"], ["seconds", "6"], ["size", "1280x720"],
                    ["input_reference", { name: "reference.png", type: "image/png", text: "image" }],
                ] : [
                    ["model", "test-model"], ["prompt", "测试提示词"], ["seconds", "6"], ["size", "1280x720"],
                    ["resolution_name", "720p"], ["generate_audio", "true"], ["watermark", "false"], ["mode", "frames"], ["ratio", "16:9"],
                    ["first_frame", { name: "ref.png", type: "image/png", text: "image" }],
                    ["images", { name: "ref.png", type: "image/png", text: "image" }],
                ],
                response: { id: "task-1", object: "video", status: "queued" },
            }],
            result: { id: "task-1" },
        },
        query: { method: "get", url: root + "/v1/videos/task-1", headers: bearer },
        pending: [{ id: "task-1", status: "queued" }, { id: "task-1", status: "in_progress", progress: 50 }],
        failed: { id: "task-1", status: "failed", error: { code: "generation_failed", message: "模拟服务错误" } },
        completed: { id: "task-1", status: "completed", progress: 100 },
        downloads: [{ method: "get", url: root + "/v1/videos/task-1/content", headers: bearer, responseType: "blob", response: videoBlob }],
        result: videoBlob,
        ...(id === "openai-video" ? { invalid: { videos: [videoUrl] } } : {}),
    })),
    {
        id: "gemini-video",
        taskId: "models/test-model/operations/task-1",
        create: {
            name: "Veo 文生视频参数与 operation 名称",
            steps: [{
                method: "post", url: root + "/v1beta/models/test-model:predictLongRunning", headers: google,
                data: {
                    instances: [{ prompt: "测试提示词" }],
                    parameters: { aspectRatio: "16:9", durationSeconds: 6, resolution: "720p" },
                },
                response: { name: "models/test-model/operations/task-1" },
            }],
            result: { id: "models/test-model/operations/task-1" },
        },
        query: { method: "get", url: root + "/v1beta/models/test-model/operations/task-1", headers: google },
        pending: [{ name: "models/test-model/operations/task-1", done: false }],
        failed: { done: true, error: { code: 3, message: "模拟服务错误" } },
        completed: { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: videoUrl } }] } } },
        downloads: [{ method: "get", url: videoUrl, headers: google, responseType: "blob", response: videoBlob }],
        result: videoBlob,
    },
    {
        id: "agnes-video",
        create: {
            name: "首尾帧请求与 video_id",
            input: { images: [imageUrl, lastImageUrl] },
            steps: [{
                method: "post", url: root + "/v1/videos", headers: bearer,
                data: {
                    model: "test-model",
                    prompt: "测试提示词",
                    mode: "keyframe",
                    seconds: "6",
                    size: "720P",
                    aspect_ratio: "16:9",
                    first_frame: imageUrl,
                    last_frame: lastImageUrl,
                },
                response: { video_id: "task-1" },
            }],
            result: { id: "task-1" },
        },
        query: { method: "get", url: root + "/agnesapi", headers: bearer, params: { video_id: "task-1", model_name: "test-model" } },
        pending: [{ status: "queued" }, { status: "in_progress" }],
        failed: { status: "failed", error: "模拟服务错误" },
        completed: { status: "completed", url: videoUrl },
    },
    {
        id: "seedance-video",
        create: {
            name: "首尾帧角色、尺寸与任务 ID",
            input: { images: [imageUrl, lastImageUrl] },
            steps: [{
                method: "post", url: root + "/api/v3/contents/generations/tasks", headers: bearer,
                data: {
                    model: "test-model",
                    content: [
                        { type: "text", text: "测试提示词" },
                        { type: "image_url", image_url: { url: imageUrl }, role: "first_frame" },
                        { type: "image_url", image_url: { url: lastImageUrl }, role: "last_frame" },
                    ],
                    duration: 6,
                    resolution: "720p",
                    ratio: "adaptive",
                    generate_audio: true,
                    watermark: false,
                },
                response: { id: "task-1" },
            }],
            result: { id: "task-1" },
        },
        query: { method: "get", url: root + "/api/v3/contents/generations/tasks/task-1", headers: bearer },
        pending: [{ status: "queued" }, { status: "running" }],
        failed: { status: "failed", error: { code: "InvalidParameter", message: "模拟服务错误" } },
        completed: { status: "succeeded", content: { video_url: videoUrl } },
    },
    {
        id: "wan-video",
        create: {
            name: "万相文生请求与异步提交头",
            input: { model: "wan2.6-t2v" },
            steps: [{
                method: "post", url: root + "/api/v1/services/aigc/video-generation/video-synthesis",
                headers: { ...bearer, "X-DashScope-Async": "enable" },
                data: { model: "wan2.6-t2v", input: { prompt: "测试提示词" }, parameters: { size: "1280*720", duration: 6 } },
                response: { output: { task_id: "task-1" } },
            }],
            result: { id: "task-1" },
        },
        query: { method: "get", url: root + "/api/v1/tasks/task-1", headers: bearer },
        pending: [{ output: { task_status: "PENDING" } }, { output: { task_status: "RUNNING" } }],
        failed: { output: { task_status: "FAILED", code: "InvalidParameter", message: "模拟服务错误" } },
        completed: { output: { task_status: "SUCCEEDED", video_url: videoUrl } },
        invalid: { model: "wan2.6-t2v", videos: [videoUrl] },
    },
    {
        id: "kling-video",
        create: {
            name: "可灵无图片时文生，任务记录创建类型",
            steps: [{
                method: "post", url: root + "/v1/videos/text2video", headers: bearer,
                data: { model_name: "test-model", prompt: "测试提示词", duration: "6", aspect_ratio: "16:9" },
                response: { code: 0, data: { task_id: "task-1" } },
            }],
            result: { id: "text2video/task-1" },
        },
        taskId: "text2video/task-1",
        query: { method: "get", url: root + "/v1/videos/text2video/task-1", headers: bearer },
        pending: [{ code: 0, data: { task_status: "submitted" } }, { code: 0, data: { task_status: "processing" } }],
        failed: { code: 0, data: { task_status: "failed", task_status_msg: "模拟服务错误" } },
        completed: { code: 0, data: { task_status: "succeed", task_result: { videos: [{ url: videoUrl }] } } },
        invalid: { videos: [videoUrl] },
    },
    {
        id: "vidu-video",
        create: {
            name: "Vidu 首尾帧请求与 Token 鉴权",
            input: { images: [imageUrl, lastImageUrl] },
            steps: [{
                method: "post", url: root + "/ent/v2/start-end2video", headers: { Authorization: "Token test-key" },
                data: { model: "test-model", prompt: "测试提示词", duration: 6, resolution: "720p", images: [imageUrl, lastImageUrl] },
                response: { task_id: "task-1", state: "created" },
            }],
            result: { id: "task-1" },
        },
        query: { method: "get", url: root + "/ent/v2/tasks/task-1/creations", headers: { Authorization: "Token test-key" } },
        pending: [{ state: "created" }, { state: "queueing" }, { state: "processing" }],
        failed: { state: "failed", err_code: "ContentModeration" },
        completed: { id: "task-1", state: "success", err_code: "", creations: [{ id: "video-1", url: videoUrl }] },
        invalid: { videos: [videoUrl] },
    },
    {
        id: "hailuo-video",
        create: {
            name: "海螺首尾帧、分辨率及业务成功码",
            input: { images: [imageUrl, lastImageUrl] },
            steps: [{
                method: "post", url: root + "/v1/video_generation", headers: bearer,
                data: {
                    model: "test-model",
                    prompt: "测试提示词",
                    duration: 6,
                    resolution: "720P",
                    first_frame_image: imageUrl,
                    last_frame_image: lastImageUrl,
                },
                response: { task_id: "task-1", base_resp: { status_code: 0, status_msg: "success" } },
            }],
            result: { id: "task-1" },
        },
        query: { method: "get", url: root + "/v1/query/video_generation?task_id=task-1", headers: bearer },
        pending: ["Preparing", "Queueing", "Processing"].map((status) => ({ status, base_resp: { status_code: 0 } })),
        failed: { status: "Fail", base_resp: { status_code: 0, status_msg: "success" } },
        completed: { status: "Success", file_id: "file-1", base_resp: { status_code: 0 } },
        downloads: [{
            method: "get", url: root + "/v1/files/retrieve", headers: bearer,
            params: { file_id: "file-1" },
            response: { file: { file_id: "file-1", download_url: videoUrl }, base_resp: { status_code: 0 } },
        }],
        invalid: { images: [imageUrl, lastImageUrl, imageUrl] },
    },
    {
        id: "grok-video-generations",
        create: {
            name: "Grok 首尾帧请求与 request_id",
            input: { images: [imageUrl, lastImageUrl] },
            steps: [{
                method: "post", url: root + "/v1/videos/generations", headers: bearer,
                data: {
                    model: "test-model",
                    prompt: "测试提示词",
                    duration: 6,
                    aspect_ratio: "16:9",
                    resolution: "720p",
                    generate_audio: true,
                    image: { url: imageUrl },
                    last_frame: { url: lastImageUrl },
                },
                response: { request_id: "task-1" },
            }],
            result: { id: "task-1" },
        },
        query: { method: "get", url: root + "/v1/videos/task-1", headers: bearer },
        pending: [{ status: "pending", progress: 30 }],
        failed: { status: "failed", error: { code: "generation_failed", message: "模拟服务错误" } },
        completed: { status: "done", video: { url: videoUrl, respect_moderation: true } },
        invalid: { videos: [videoUrl] },
    },
];

for (const video of videoFixtures) {
    fixtures.push({
        id: video.id,
        cases: [
            video.create,
            ...video.pending.map((response, index): Case => ({
                name: "处理中状态 " + (index + 1),
                input: { taskId: video.taskId || "task-1" },
                steps: [{ ...video.query, response }],
                result: { status: "pending" },
            })),
            {
                name: "完成后返回视频或带鉴权下载成品",
                input: { taskId: video.taskId || "task-1" },
                steps: [
                    { ...video.query, response: video.completed },
                    ...(video.downloads || []),
                ],
                result: { status: "completed", result: video.result || { url: videoUrl } },
            },
            {
                name: "生成失败是终态，且不返回服务错误正文",
                input: { taskId: video.taskId || "task-1" },
                steps: [{ ...video.query, response: video.failed }],
                result: { status: "failed" },
            },
            ...(video.invalid ? [{ name: "拒绝不支持的参考素材", input: video.invalid, steps: [], error: /SCRIPT_/ }] : []),
        ],
    });
}

const wan = fixtures.find((fixture) => fixture.id === "wan-video")!;
const wanModes = [
    {
        model: "wan2.6-i2v", images: [imageUrl], audios: [audioUrl], service: "video-generation",
        input: { prompt: "测试提示词", img_url: imageUrl, audio_url: audioUrl },
        parameters: { resolution: "720P", duration: 6 },
    },
    {
        model: "wan2.2-kf2v-flash", images: [imageUrl, lastImageUrl], service: "image2video",
        input: { prompt: "测试提示词", first_frame_url: imageUrl, last_frame_url: lastImageUrl },
        parameters: { resolution: "720P", duration: 6 },
    },
    {
        model: "wan2.2-s2v", images: [imageUrl], audios: [audioUrl], service: "image2video",
        input: { prompt: "测试提示词", image_url: imageUrl, audio_url: audioUrl },
        parameters: { resolution: "720P" },
    },
    {
        model: "wan3.0-video", images: [imageUrl], audios: [audioUrl], service: "video-generation",
        input: { prompt: "测试提示词", media: [{ type: "reference_image", url: imageUrl }, { type: "reference_audio", url: audioUrl }] },
        parameters: { resolution: "720P", ratio: "16:9", duration: 6, watermark: false, audio: true },
    },
    {
        model: "wan3.0-video", images: [imageUrl, lastImageUrl], service: "video-generation",
        input: { prompt: "测试提示词", media: [{ type: "first_frame", url: imageUrl }, { type: "last_frame", url: lastImageUrl }] },
        parameters: { resolution: "720P", ratio: "16:9", duration: 6, watermark: false, audio: true },
    },
    {
        model: "wan3.0-video", service: "video-generation", input: { prompt: "测试提示词" },
        parameters: { resolution: "720P", ratio: "16:9", duration: 6, watermark: false, audio: true },
    },
    {
        model: "wan2.7-i2v-2026-04-25", images: [imageUrl], audios: [audioUrl], service: "video-generation",
        input: { prompt: "测试提示词", media: [{ type: "first_frame", url: imageUrl }, { type: "driving_audio", url: audioUrl }] },
        parameters: { resolution: "720P", ratio: "16:9", duration: 6, watermark: false, audio: true },
    },
    {
        model: "wan2.7-r2v", images: [imageUrl], service: "video-generation",
        input: { prompt: "测试提示词", media: [{ type: "reference_image", url: imageUrl }] },
        parameters: { resolution: "720P", ratio: "16:9", duration: 6, watermark: false, audio: true },
    },
    {
        model: "wan2.7-t2v", audios: [audioUrl], service: "video-generation",
        input: { prompt: "测试提示词", audio_url: audioUrl },
        parameters: { resolution: "720P", ratio: "16:9", duration: 6 },
    },
];
for (const mode of wanModes) {
    wan.cases.push({
        name: mode.model + " 按模型自动选择请求格式",
        input: { model: mode.model, images: mode.images ?? [], audios: mode.audios ?? [] },
        steps: [{
            method: "post", url: root + "/api/v1/services/aigc/" + mode.service + "/video-synthesis",
            headers: { ...bearer, "X-DashScope-Async": "enable" },
            data: { model: mode.model, input: mode.input, parameters: mode.parameters },
            response: { output: { task_id: "task-1" } },
        }],
        result: { id: "task-1" },
    });
}
for (const input of [
    { model: "wan2.2-kf2v-flash", images: [] },
    { model: "wan2.2-s2v", images: [imageUrl], audios: [] },
]) {
    wan.cases.push({ name: "缺少模型要求的素材时阻止创建", input, steps: [], error: /SCRIPT_/ });
}

const kling = fixtures.find((fixture) => fixture.id === "kling-video")!;
for (const images of [[imageUrl], [imageUrl, lastImageUrl]]) {
    kling.cases.push({
        name: "可灵有图片时自动图生，支持首尾帧",
        input: { images },
        steps: [{
            method: "post", url: root + "/v1/videos/image2video", headers: bearer,
            data: { model_name: "test-model", prompt: "测试提示词", duration: "6", aspect_ratio: "16:9", image: imageUrl, ...(images.length === 2 ? { image_tail: lastImageUrl } : {}) },
            response: { code: 0, data: { task_id: "task-1" } },
        }],
        result: { id: "image2video/task-1" },
    });
}
for (const input of [{ audios: [audioUrl] }, { images: [imageUrl, lastImageUrl, imageUrl] }, { images: [imageUrl], options: { mode: "reference" } }]) {
    kling.cases.push({ name: "拒绝未支持的素材组合", input, steps: [], error: /SCRIPT_VIDEO_REFERENCES_UNSUPPORTED/ });
}

// chenyme/grok2api 的 JSON 请求与任务响应；字段全集与服务的严格校验保持一致。
const grok2api = fixtures.find((fixture) => fixture.id === "grok2api-video")!;
const grok2apiCreate = grok2api.cases[0];
const grok2apiCases = [
    { name: "公开链接首帧保持原值", input: { images: [imageUrl] }, data: { image: { url: imageUrl } } },
    { name: "本地首帧转 Base64", input: { images: ["blob:image"] }, data: { image: { url: imageData } } },
    { name: "data URL 首帧保持原值", input: { images: [imageData] }, data: { image: { url: imageData } } },
    { name: "单图参考不变成首帧", input: { images: [imageUrl], options: { mode: "reference" } }, data: { reference_images: [{ url: imageUrl }] } },
    { name: "多图参考保留顺序并转换本地素材", input: { images: [imageUrl, "blob:image"], options: { mode: "reference" } }, data: { reference_images: [{ url: imageUrl }, { url: imageData }] } },
    { name: "参考模式无素材时提交文生视频", input: { options: { mode: "reference" } }, data: {} },
    { name: "关闭声音及开启水印也不发送不支持字段", input: { options: { generateAudio: false, watermark: true } }, data: {} },
];
for (const sample of grok2apiCases) {
    grok2api.cases.push({
        name: sample.name,
        input: sample.input,
        steps: [{
            ...grok2apiCreate.steps[0],
            data: { model: "test-model", prompt: "测试提示词", duration: "6", aspect_ratio: "16:9", resolution: "720p", ...sample.data },
        }],
        result: { id: "task-1" },
    });
}
for (const input of [{ videos: [videoUrl] }, { audios: [audioUrl] }]) {
    grok2api.cases.push({ name: "拒绝视频或音频文件参考", input, steps: [], error: /SCRIPT_VIDEO_REFERENCES_UNSUPPORTED/ });
}
for (const response of [{ error: { message: "模拟服务错误" } }, { id: "unexpected-id" }]) {
    grok2api.cases.push({
        ...grok2apiCreate,
        name: "创建错误或缺少 request_id 不返回成功任务",
        steps: [{ ...grok2apiCreate.steps[0], response }],
        error: /video request failed/,
    });
}
for (const response of [
    { status: "expired" },
    { status: "done", video: { url: videoUrl, respect_moderation: false } },
    { status: "done", video: { respect_moderation: true } },
    { status: "pending", error: { message: "模拟服务错误" } },
]) {
    grok2api.cases.push({
        name: "过期、未通过审核、无成品及错误响应均结束任务",
        input: { taskId: "task/1" },
        steps: [{ method: "get", url: root + "/v1/videos/task%2F1", headers: bearer, response }],
        result: { status: "failed" },
    });
}

// xAI 官方 JSON 示例：本地素材使用 data URL；音频文件参考需渠道另行开通权限。
const grokVideoEndpoint = root + "/v1/videos/";
const grokGenerations = fixtures.find((fixture) => fixture.id === "grok-video-generations")!;
const grokVideoCases = [
    { name: "文生视频，不发送空参考列表", input: {}, data: {} },
    { name: "参考模式无素材时仍是文生视频", input: { options: { mode: "reference" } }, data: {} },
    { name: "本地图片转 Base64 首帧，无需对象存储", input: { images: ["blob:image"] }, data: { image: { url: imageData } } },
    { name: "data URL 首帧保持原值", input: { images: [imageData] }, data: { image: { url: imageData } } },
    { name: "多图参考", input: { images: [imageUrl, lastImageUrl], options: { mode: "reference" } }, data: { reference_images: [{ url: imageUrl }, { url: lastImageUrl }] } },
    { name: "静音视频", input: { options: { generateAudio: false } }, data: { generate_audio: false } },
    { name: "首尾帧加音频不改变图片用途", input: { images: [imageUrl, lastImageUrl], audios: ["blob:audio"] }, data: { image: { url: imageUrl }, last_frame: { url: lastImageUrl }, reference_audios: [{ url: audioData }] } },
    { name: "仅音频参考，不发送空图片列表", input: { audios: [audioUrl] }, data: { reference_audios: [{ url: audioUrl }] } },
];
for (const sample of grokVideoCases) {
    grokGenerations.cases.push({
        name: sample.name,
        input: { ...sample.input, model: "grok-imagine-video-1.5" },
        steps: [{
            method: "post", url: grokVideoEndpoint + "generations", headers: bearer,
            data: { model: "grok-imagine-video-1.5", prompt: "测试提示词", duration: 6, aspect_ratio: "16:9", resolution: "720p", generate_audio: true, ...sample.data },
            response: { request_id: "task-1" },
        }],
        result: { id: "task-1" },
    });
}
for (const response of [{ error: { message: "模拟服务错误" } }, {}]) {
    const create = grokGenerations.cases[0];
    grokGenerations.cases.push({
        ...create,
        name: "创建错误或缺少 request_id 不返回成功任务",
        steps: [{ ...create.steps[0], response }],
        error: /video request failed/,
    });
}
for (const response of [{ status: "expired" }, { status: "done", video: { url: videoUrl, respect_moderation: false } }, { status: "done", video: { respect_moderation: true } }]) {
    grokGenerations.cases.push({
        name: "任务过期、内容未通过审核或无成品均不返回视频",
        input: { taskId: "task-1" },
        steps: [{ method: "get", url: grokVideoEndpoint + "task-1", headers: bearer, response }],
        result: { status: "failed" },
    });
}

test("每个内置脚本都有独立输入输出样例，且 ID 不重复", () => {
    const actual = builtinCallScripts.map((script) => script.id).sort();
    const covered = fixtures.map((fixture) => fixture.id).sort();
    assert.equal(builtinCallScripts.some((script) => script.id.startsWith("newapi-")), false);
    for (const prefix of ["wan-", "kling-", "grok-video-"]) {
        assert.equal(builtinCallScripts.filter((script) => script.id.startsWith(prefix)).length, 1);
    }
    assert.equal(new Set(actual).size, actual.length);
    assert.equal(new Set(covered).size, covered.length);
    assert.deepEqual(covered, actual, "新增或移除内置脚本时，需要同步维护测试样例");
});

for (const fixture of fixtures) {
    const script = builtinCallScripts.find((item) => item.id === fixture.id)!;
    test(`${script.name} [${fixture.id}]`, async (context) => {
        for (const sample of fixture.cases) {
            await context.test(sample.name, () => checkCase(script, sample));
        }
        const create = fixture.cases[0];
        await context.test("请求失败时不返回成功结果", () => checkCase(script, {
            ...create,
            steps: [{ ...create.steps[0], response: new Error("模拟请求失败") }],
            error: /模拟请求失败/,
            deltas: undefined,
        }));
        if (script.capability === "image" || script.capability === "text" || fixture.id === "openai-chat-audio") {
            const error = { error: { message: "模拟服务错误" } };
            await context.test("业务错误响应被拒绝", () => checkCase(script, {
                ...create,
                steps: [{ ...create.steps[0], response: script.capability === "text" ? [error] : error }],
                error: /request failed/,
                deltas: undefined,
            }));
        }
    });
}
