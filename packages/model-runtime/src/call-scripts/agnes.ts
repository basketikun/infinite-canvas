import type { CallScript } from "@infinite-canvas/shared/models";
import { createCallScriptSource } from "./template.js";

export const agnesScripts: CallScript[] = [
    {
        id: "agnes-image",
        name: "Agnes 协议生图",
        description: "生图 / 参考图：POST /v1/images/generations",
        logo: "/icons/agnes.png",
        capability: "image",
        source: createCallScriptSource("image", String.raw`const { model, prompt, images, options, utils } = params;
if (!options.size) {
    throw new Error("SCRIPT_IMAGE_SIZE_REQUIRED");
}
const body = {
    model,
    prompt,
    size: ["1K", "2K", "3K", "4K"].includes(options.resolution)
        ? options.resolution
        : options.size,
    ...(options.ratio ? { ratio: options.ratio } : {}),
    ...(images.length
        ? {
              extra_body: {
                  image: await Promise.all(
                      images.map((image) =>
                          image.startsWith("blob:") ? utils.toDataUrl(image) : image,
                      ),
                  ),
                  response_format: "b64_json",
              },
          }
        : { return_base64: true }),
};
const results = await Promise.all(
    Array.from({ length: options.count }, async () => {
        const result = await utils.http.post("/images/generations", body);
        if (result.error) {
            throw new Error("image request failed");
        }
        return result.data;
    }),
);
return results.flat();`),
    },
    {
        id: "agnes-text",
        name: "Agnes 协议文本",
        description: "POST /v1/chat/completions",
        logo: "/icons/agnes.png",
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
const { model, messages, baseUrl, apiKey, utils } = params;
const root = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
let text = "";
await utils.stream(
    {
        url: root + "/v1/chat/completions",
        headers: { Authorization: "Bearer " + apiKey },
        data: {
            model,
            messages,
            stream: true,
        },
    },
    (event) => {
        if (event.error) {
            throw new Error("text request failed");
        }
        const choice = event.choices?.[0];
        if (choice?.delta?.content) {
            text += choice.delta.content;
        }
        if (choice?.message?.content) {
            text = choice.message.content;
        }
        if (text) {
            utils.onDelta(text);
        }
    },
);
return text;`),
    },
    {
        id: "agnes-video",
        name: "Agnes 协议视频",
        description: "创建：POST /v1/videos\n查询：GET /agnesapi?video_id={id}&model_name={model}\n参考素材需公开链接。",
        logo: "/icons/agnes.png",
        capability: "video",
        source: createCallScriptSource("video", String.raw`const { model, prompt, images: sourceImages, videos: sourceVideos, audios: sourceAudios, baseUrl, apiKey, taskId, options, utils } =
    params;
if (taskId) {
    const root = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
    const state = await utils.request({
        method: "get",
        url: root + "/agnesapi",
        headers: { Authorization: "Bearer " + apiKey },
        params: {
            video_id: taskId,
            model_name: model,
        },
    });
    if (state.status === "completed") {
        return {
            status: "completed",
            result: { url: state.url },
        };
    }
    if (state.status === "failed") {
        return { status: "failed" };
    }
    if (state.status === "queued" || state.status === "in_progress") {
        return { status: "pending" };
    }
    throw new Error("video status unavailable");
}
const images = [];
const videos = [];
const audios = [];
for (const [sources, destination] of [[sourceImages, images], [sourceVideos, videos], [sourceAudios, audios]]) {
    for (const source of sources) {
        destination.push(await utils.toPublicUrl(source));
    }
}
const mode =
    !images.length && !videos.length && !audios.length
        ? "text"
        : videos.length || audios.length || options.mode === "reference"
          ? "reference"
          : "keyframe";
const body = {
    model,
    prompt,
    mode,
    seconds: String(options.seconds),
    size: options.resolution.toUpperCase(),
    aspect_ratio: options.ratio,
};
if (mode === "keyframe") {
    body.first_frame = images[0];
    if (images[1]) {
        body.last_frame = images[1];
    }
}
if (mode === "reference") {
    body.images = images;
    body.videos = videos.map((url) => ({ url }));
    body.audios = audios;
}
const created = await utils.http.post("/videos", body);
return { id: created.video_id };`),
    },
];
