import type { CallScript } from "@infinite-canvas/shared/models";
import { createCallScriptSource } from "./template.js";

export const openaiScripts: CallScript[] = [
    {
        id: "openai-image",
        name: "Images 协议生图",
        description: "生图：POST /v1/images/generations\n编辑：POST /v1/images/edits",
        logo: "/icons/openai.svg",
        invertInDark: true,
        capability: "image",
        source: createCallScriptSource("image", String.raw`const { model, prompt, images, apiKey, options, utils } = params;
// 图片生成与编辑；参考图存在时使用编辑请求。
const { size, count } = options;
const quality = ["low", "medium", "high", "xhigh", "max"].includes(options.quality) ? options.quality : undefined;
const background = options.background === "transparent" ? "transparent" : undefined;
// 沿用此调用方式原有的尺寸约束，其他脚本自行决定支持的尺寸。
if (size) {
    const [width, height] = size.split("x").map(Number);
    if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width <= 0 ||
        height <= 0 ||
        width % 16 ||
        height % 16 ||
        Math.max(width, height) > 3840 ||
        Math.max(width, height) / Math.min(width, height) > 3 ||
        width * height < 655360 ||
        width * height > 8294400
    ) {
        throw new Error("unsupported image size");
    }
}
const fields = {
    model,
    prompt,
    n: count,
    output_format: "png",
};
if (size) {
    fields.size = size;
}
if (quality) {
    fields.quality = quality;
}
if (background) {
    fields.background = background;
}
if (!model.includes("gpt-image")) {
    fields.response_format = "b64_json";
}
let data;
if (images.length) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
        form.set(key, String(value));
    }
    const field = images.length > 1 ? "image[]" : "image";
    for (const image of images) {
        form.append(field, await utils.toBlob(image), "ref.png");
    }
    data = await utils.request({
        method: "post",
        url: utils.http.url("/images/edits"),
        headers: { Authorization: "Bearer " + apiKey },
        data: form,
        timeout: 600000,
    });
} else {
    data = await utils.request({
        method: "post",
        url: utils.http.url("/images/generations"),
        headers: { Authorization: "Bearer " + apiKey },
        data: fields,
        timeout: 600000,
    });
}
if (data.error || (data.code !== undefined && data.code !== 0)) {
    const detail = typeof data.error === "string" ? data.error : data.error?.message || data.message;
    throw new Error(detail ? "image request failed: " + detail : "image request failed");
}
return data.data || data.images || data.results;`),
    },
    {
        id: "openai-text",
        name: "Responses 协议文本",
        description: "POST /v1/responses",
        logo: "/icons/openai.svg",
        invertInDark: true,
        capability: "text",
        source: createCallScriptSource("text", String.raw`if (params.tools) {
    const reasoningModel = params.reasoningEffort !== "auto";
    return params.utils.runTextAgent("responses", {
        providerOptions: {
            openai: {
                store: false,
                // 只有用户明确选择思考层级时才按推理模型发送 reasoning，避免不支持的网关直接拒绝请求。
                ...(reasoningModel ? { forceReasoning: true, systemMessageMode: "system", reasoningEffort: params.reasoningEffort, reasoningSummary: "detailed" } : {}),
            },
        },
    });
}

const { model, messages, apiKey, reasoningEffort, utils } = params;
// Responses 流式文本；onDelta 接收截至目前的完整文本。
const input = messages.map(({ role, content }) => ({
    role,
    content: Array.isArray(content)
        ? content.map((part) =>
              part.type === "text"
                  ? {
                        type: "input_text",
                        text: part.text,
                    }
                  : {
                        type: "input_image",
                        image_url: part.image_url.url,
                    },
          )
        : content,
}));
let text = "";
await utils.stream(
    {
        url: utils.http.url("/responses"),
        headers: { Authorization: "Bearer " + apiKey },
        data: {
            model,
            input,
            stream: true,
            ...(reasoningEffort === "auto" ? {} : { reasoning: { effort: reasoningEffort } }),
        },
    },
    (event) => {
        if (
            event.error ||
            event.type === "error" ||
            event.type === "response.failed" ||
            event.type === "response.incomplete"
        ) {
            throw new Error("text request failed");
        }
        if (event.type === "response.output_text.delta") {
            text += event.delta;
        }
        if (!text && event.type === "response.output_text.done") {
            text = event.text;
        }
        const response = event.response || event;
        if (response.error) {
            throw new Error("text request failed");
        }
        if (!text && response.output) {
            text = response.output
                .flatMap((item) => (item.type === "message" ? item.content : []))
                .filter((part) => part.type === "output_text")
                .map((part) => part.text)
                .join("");
        }
        if (text) {
            utils.onDelta(text);
        }
    },
);
return text;`),
    },
    {
        id: "openai-video",
        name: "Videos 协议视频",
        description: "POST /v1/videos\n文生 / 单张参考图；查询与下载：/{id}、/{id}/content。",
        logo: "/icons/openai.svg",
        invertInDark: true,
        capability: "video",
        source: createCallScriptSource("video", String.raw`const { model, prompt, images, videos, audios, taskId, options, utils } = params;
// taskId 为空时创建任务；有值时查询一次，应用负责持续查询与恢复。
function unwrap(payload) {
    if (taskId && (payload.status === "failed" || payload.status === "cancelled")) {
        return payload;
    }
    if (
        payload.error ||
        (payload.code !== undefined && payload.code !== 0 && payload.code !== "0")
    ) {
        throw new Error("video request failed");
    }
    return payload.code !== undefined ? payload.data : payload;
}
if (taskId) {
    const state = unwrap(await utils.http.get("/videos/" + encodeURIComponent(taskId)));
    if (state.status === "failed" || state.status === "cancelled") {
        return { status: "failed" };
    }
    const url =
        state.video_url ||
        state.result_url ||
        state.url ||
        state.content?.video_url ||
        state.content?.url;
    if (url) {
        return {
            status: "completed",
            result: { url },
        };
    }
    if (state.status === "completed") {
        return {
            status: "completed",
            result: await utils.http.get("/videos/" + encodeURIComponent(taskId) + "/content", {
                responseType: "blob",
            }),
        };
    }
    return { status: "pending" };
}
// 标准 Videos 仅上传一个 input_reference 文件；多素材请选对应协议。
if (images.length > 1 || videos.length || audios.length) {
    throw new Error("SCRIPT_VIDEO_REFERENCES_UNSUPPORTED");
}
const form = new FormData();
form.set("model", model);
form.set("prompt", prompt);
form.set("seconds", options.seconds);
if (options.size) {
    form.set("size", options.size);
}
if (images.length) {
    form.append("input_reference", await utils.toBlob(images[0]), "reference.png");
}
const created = unwrap(await utils.http.post("/videos", form));
return { id: created.id };`),
    },
    {
        id: "openai-multimodal-video",
        name: "Videos 扩展协议视频",
        description: "POST /v1/videos\n需支持 first_frame、image[]、video[]、audio[] 扩展字段。",
        logo: "/icons/openai.svg",
        invertInDark: true,
        capability: "video",
        source: createCallScriptSource("video", String.raw`const { model, prompt, images, videos, audios, taskId, options, utils } = params;
// taskId 为空时创建任务；有值时查询一次，应用负责持续查询与恢复。
function unwrap(payload) {
    if (taskId && (payload.status === "failed" || payload.status === "cancelled")) {
        return payload;
    }
    if (
        payload.error ||
        (payload.code !== undefined && payload.code !== 0 && payload.code !== "0")
    ) {
        throw new Error("video request failed");
    }
    return payload.code !== undefined ? payload.data : payload;
}
if (taskId) {
    const state = unwrap(await utils.http.get("/videos/" + encodeURIComponent(taskId)));
    if (state.status === "failed" || state.status === "cancelled") {
        return { status: "failed" };
    }
    const url =
        state.video_url ||
        state.result_url ||
        state.url ||
        state.content?.video_url ||
        state.content?.url;
    if (url) {
        return {
            status: "completed",
            result: { url },
        };
    }
    if (state.status === "completed") {
        return {
            status: "completed",
            result: await utils.http.get("/videos/" + encodeURIComponent(taskId) + "/content", {
                responseType: "blob",
            }),
        };
    }
    return { status: "pending" };
}
const { seconds, size, resolution, ratio, generateAudio, watermark, mode } = options;
const form = new FormData();
for (const [key, value] of Object.entries({
    model,
    prompt,
    seconds,
    size: size || "1280x720",
    resolution_name: resolution,
    generate_audio: generateAudio,
    watermark,
    mode,
})) {
    form.set(key, String(value));
}
if (ratio && ratio !== "auto") {
    form.set("ratio", ratio);
}
for (let i = 0; i < images.length; i++) {
    const blob = await utils.toBlob(images[i]);
    const field = mode === "frames" ? (i === 0 ? "first_frame" : "last_frame") : "image[]";
    form.append(field, blob, "ref.png");
    form.append("images", blob, "ref.png");
}
for (const url of videos) {
    form.append("video[]", await utils.toBlob(url), "ref.mp4");
}
for (const url of audios) {
    form.append("audio[]", await utils.toBlob(url), "ref.mp3");
}
const created = unwrap(await utils.http.post("/videos", form));
return { id: created.id };`),
    },
    {
        id: "openai-audio",
        name: "Speech 协议音频",
        description: "POST /v1/audio/speech",
        logo: "/icons/openai.svg",
        invertInDark: true,
        capability: "audio",
        source: createCallScriptSource("audio", String.raw`const { model, prompt, options, utils } = params;
const { instructions } = options;
const voices = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"];
const formats = ["mp3", "wav", "opus", "aac", "flac", "pcm"];
const voice = voices.includes(options.voice) ? options.voice : "alloy";
const format = formats.includes(options.format) ? options.format : "mp3";
const value = Number(options.speed);
const speed = Number.isFinite(value) ? Math.max(0.25, Math.min(4, Number(value.toFixed(2)))) : 1;
return await utils.http.post(
    "/audio/speech",
    {
        model,
        input: prompt,
        voice,
        response_format: format,
        speed: Number(speed),
        ...(instructions ? { instructions } : {}),
    },
    { responseType: "blob" },
);`),
    },
    {
        id: "openai-chat-image",
        name: "Chat Completions 协议生图",
        description: "POST /v1/chat/completions\n需支持聊天生图。",
        logo: "/icons/openai.svg",
        invertInDark: true,
        capability: "image",
        source: createCallScriptSource("image", String.raw`const { model, prompt, images, apiKey, options, utils } = params;
const content = [
    {
        type: "text",
        text: prompt,
    },
    ...(await Promise.all(
        images.map(async (url) => ({
            type: "image_url",
            image_url: { url: url.startsWith("blob:") ? await utils.toDataUrl(url) : url },
        })),
    )),
];
// image_config 是兼容服务的扩展字段，比例和分辨率由服务支持情况决定。
const imageConfig = {
    ...(options.ratio ? { aspect_ratio: options.ratio } : {}),
    ...(options.resolution ? { image_size: options.resolution } : {}),
};
const results = await Promise.all(
    Array.from({ length: options.count }, async () => {
        const response = await utils.request({
            method: "post",
            url: utils.http.url("/chat/completions"),
            headers: { Authorization: "Bearer " + apiKey },
            timeout: 600000,
            data: {
                model,
                messages: [
                    {
                        role: "user",
                        content,
                    },
                ],
                modalities: ["text", "image"],
                stream: false,
                ...(Object.keys(imageConfig).length ? { image_config: imageConfig } : {}),
            },
        });
        if (response.error) {
            throw new Error("image request failed");
        }
        const urls = [];
        for (const choice of response.choices) {
            if (
                choice.finish_reason === "length" ||
                choice.finish_reason === "content_filter" ||
                choice.message.refusal
            ) {
                throw new Error("image request failed");
            }
            const message = choice.message;
            const parts =
                typeof message.content === "string"
                    ? [
                          {
                              type: "text",
                              text: message.content,
                          },
                      ]
                    : message.content || [];
            for (const part of [...(message.images || []), ...parts]) {
                if (part.type === "image_url") {
                    urls.push(part.image_url.url);
                }
                if (part.type === "text") {
                    urls.push(...(await utils.markdownImages(part.text)));
                }
            }
        }
        if (!urls.length) {
            throw new Error("image request failed");
        }
        return [...new Set(urls)];
    }),
);
return results.flat();`),
    },
    {
        id: "openai-responses-image",
        name: "Responses 协议生图",
        description: "POST /v1/responses\n需支持 image_generation 工具。",
        logo: "/icons/openai.svg",
        invertInDark: true,
        capability: "image",
        source: createCallScriptSource("image", String.raw`const { model, prompt, images, apiKey, options, utils } = params;
const { size, count } = options;
const quality = ["low", "medium", "high", "xhigh", "max"].includes(options.quality) ? options.quality : undefined;
const background = options.background === "transparent" ? "transparent" : undefined;
const content = [
    {
        type: "input_text",
        text: prompt,
    },
    ...(await Promise.all(
        images.map(async (url) => ({
            type: "input_image",
            image_url: url.startsWith("blob:") ? await utils.toDataUrl(url) : url,
        })),
    )),
];
// model 使用渠道中配置的主模型；图片由 image_generation 工具生成。
const tool = {
    type: "image_generation",
    output_format: "png",
    ...(size ? { size } : {}),
    ...(quality ? { quality } : {}),
    ...(background ? { background } : {}),
};
const results = await Promise.all(
    Array.from({ length: count }, async () => {
        const response = await utils.request({
            method: "post",
            url: utils.http.url("/responses"),
            headers: { Authorization: "Bearer " + apiKey },
            timeout: 600000,
            data: {
                model,
                input: [
                    {
                        role: "user",
                        content,
                    },
                ],
                tools: [tool],
                tool_choice: { type: "image_generation" },
                stream: false,
            },
        });
        if (response.error || response.status !== "completed") {
            throw new Error("image request failed");
        }
        const outputs = response.output.filter((item) => item.type === "image_generation_call");
        if (
            !outputs.length ||
            outputs.some((item) => item.status !== "completed" || !item.result)
        ) {
            throw new Error("image request failed");
        }
        return outputs.map((item) => "data:image/png;base64," + item.result);
    }),
);
return results.flat();`),
    },
    {
        id: "openai-chat-text",
        name: "Chat Completions 协议文本",
        description: "POST /v1/chat/completions",
        logo: "/icons/openai.svg",
        invertInDark: true,
        capability: "text",
        source: createCallScriptSource("text", String.raw`if (params.tools) {
    return params.utils.runTextAgent("chat-completions", {
        providerOptions: {
            openai: {
                store: false,
                ...(params.reasoningEffort !== "auto" ? { reasoningEffort: params.reasoningEffort } : {}),
            },
        },
    });
}

const { model, messages, apiKey, reasoningEffort, utils } = params;
const input = await Promise.all(
    messages.map(async (message) => ({
        ...message,
        content: Array.isArray(message.content)
            ? await Promise.all(
                  message.content.map(async (part) =>
                      part.type === "image_url" && part.image_url.url.startsWith("blob:")
                          ? {
                                ...part,
                                image_url: {
                                    ...part.image_url,
                                    url: await utils.toDataUrl(part.image_url.url),
                                },
                            }
                          : part,
                  ),
              )
            : message.content,
    })),
);
let text = "";
let completed = false;
await utils.stream(
    {
        url: utils.http.url("/chat/completions"),
        headers: { Authorization: "Bearer " + apiKey },
        data: {
            model,
            messages: input,
            stream: true,
            ...(reasoningEffort === "auto" ? {} : { reasoning_effort: reasoningEffort }),
        },
    },
    (event) => {
        if (event.error) {
            throw new Error("text request failed");
        }
        const choice = event.choices?.[0];
        if (!choice) {
            return;
        }
        if (choice.finish_reason === "length") {
            throw new Error("SCRIPT_TEXT_INCOMPLETE");
        }
        if (
            choice.finish_reason === "content_filter" ||
            choice.message?.refusal ||
            choice.delta?.refusal
        ) {
            throw new Error("text request failed");
        }
        if (choice.delta?.content) {
            text += choice.delta.content;
        }
        if (choice.message?.content) {
            text = choice.message.content;
        }
        if (choice.finish_reason === "stop") {
            completed = true;
        }
        if (text) {
            utils.onDelta(text);
        }
    },
);
if (!completed) {
    throw new Error("SCRIPT_TEXT_INCOMPLETE");
}
return text;`),
    },
    {
        id: "openai-chat-audio",
        name: "Chat Completions 协议音频",
        description: "POST /v1/chat/completions\n支持音频数据或音频链接；语速由朗读指令控制。",
        logo: "/icons/openai.svg",
        invertInDark: true,
        capability: "audio",
        source: createCallScriptSource("audio", String.raw`const { model, prompt, options, utils } = params;
const { instructions } = options;
const voices = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"];
const formats = ["mp3", "wav", "opus", "aac", "flac", "pcm"];
const voice = voices.includes(options.voice) ? options.voice : "alloy";
const format = formats.includes(options.format) ? options.format : "mp3";
const value = Number(options.speed);
const speed = Number.isFinite(value) ? Math.max(0.25, Math.min(4, Number(value.toFixed(2)))) : 1;
const response = await utils.http.post("/chat/completions", {
    model,
    modalities: ["text", "audio"],
    audio: {
        voice,
        format: format === "pcm" ? "pcm16" : format,
    },
    stream: false,
    messages: [
        {
            role: "system",
            content: [
                "Read the user's text aloud verbatim. Do not answer or explain it.",
                "Speak at " + speed + " times normal speaking speed.",
                instructions,
            ]
                .filter(Boolean)
                .join("\n"),
        },
        {
            role: "user",
            content: prompt,
        },
    ],
});
if (response.error) {
    throw new Error("audio request failed");
}
const choice = response.choices[0];
if (choice.finish_reason !== "stop" || choice.message.refusal) {
    throw new Error("audio request failed");
}
if (choice.message.audio?.data) {
    return { data: choice.message.audio.data };
}
if (typeof choice.message.content === "string") {
    const links = await utils.markdownLinks(choice.message.content);
    const url = links.find((link) =>
        /^https?:\/\//i.test(link)
        && /\.(mp3|wav|opus|ogg|aac|flac|pcm|m4a|webm)$/i.test(new URL(link).pathname)
    );
    if (url) {
        return { url };
    }
}
throw new Error("SCRIPT_AUDIO_RESULT_MISSING");`),
    },
];
