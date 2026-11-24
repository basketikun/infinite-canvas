import type { CallScript } from "@infinite-canvas/shared/models";
import { createCallScriptSource } from "./template.js";
import { createVideoProtocolScript } from "./video-template.js";

// xAI 图片编辑使用 JSON；不能复用 Images 脚本的 multipart/form-data。
const imageScript: CallScript = {
    id: "grok-image",
    name: "Grok 协议生图",
    description: "生图：POST /v1/images/generations\n编辑：POST /v1/images/edits\n支持单图、多图参考；质量选自动、低或中。",
    logo: "/icons/grok.svg",
    invertInDark: true,
    capability: "image",
    source: createCallScriptSource("image", String.raw`const { model, prompt, images, options, utils } = params;
const data = {
    model,
    prompt,
    n: options.count,
    response_format: "url",
};
if (options.ratio) {
    data.aspect_ratio = options.ratio;
}
if (options.resolution) {
    data.resolution = options.resolution.toLowerCase();
}
if (options.quality) {
    data.quality = options.quality;
}
if (images.length) {
    const references = [];
    for (const source of images) {
        references.push({
            type: "image_url",
            url: source.startsWith("blob:") ? await utils.toDataUrl(source) : source,
        });
    }
    if (references.length === 1) {
        data.image = references[0];
    } else {
        data.images = references;
    }
}
const result = await utils.http.post(
    images.length ? "/images/edits" : "/images/generations",
    data,
);
if (result.error) {
    throw new Error("image request failed");
}
return result.data.map(({ url }) => ({ url }));`),
};

export const xaiScripts: CallScript[] = [imageScript, createVideoProtocolScript(
    "grok-video-generations",
    "Grok 协议视频",
    "/v1/videos",
    "POST {root}/generations\n支持文生、图生与多图参考；首尾帧需 1.5 模型，音频文件参考需额外权限。",
    { logo: "/icons/grok.svg", invertInDark: true },
    {
        query: String.raw`if (taskId) {
    const state = await utils.request({
        method: "get",
        url: root + "/" + encodeURIComponent(taskId),
        headers,
    });
    if (state.status === "done" && state.video?.url && state.video.respect_moderation === true) {
        return {
            status: "completed",
            result: { url: state.video.url },
        };
    }
    if (state.status === "pending") {
        return { status: "pending" };
    }
    return { status: "failed" };
}`,
        create: String.raw`const data = {
    model,
    prompt,
};
if (videos.length) {
    throw new Error("SCRIPT_VIDEO_REFERENCES_UNSUPPORTED");
}
data.duration = Number(options.seconds);
data.aspect_ratio = options.ratio;
data.resolution = options.resolution;
data.generate_audio = options.generateAudio;
const references = [];
for (const source of images) {
    references.push({
        url: source.startsWith("blob:") ? await utils.toDataUrl(source) : source,
    });
}
if (options.mode === "reference") {
    if (references.length) {
        data.reference_images = references;
    }
} else {
    if (images.length > 2) {
        throw new Error("SCRIPT_VIDEO_REFERENCES_UNSUPPORTED");
    }
    if (references[0]) {
        data.image = references[0];
    }
    if (references[1]) {
        data.last_frame = references[1];
    }
}
if (audios.length) {
    data.reference_audios = [];
    // 自有音频参考需服务单独开通权限；不改变首尾帧的用途。
    for (const source of audios) {
        data.reference_audios.push({
            url: source.startsWith("blob:") ? await utils.toDataUrl(source) : source,
        });
    }
}
const created = await utils.request({
    method: "post",
    url: root + "/generations",
    headers,
    data,
});
if (created.error || !created.request_id) {
    throw new Error("video request failed");
}
return { id: created.request_id };`,
    },
)];
