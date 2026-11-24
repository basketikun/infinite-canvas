import type { CallScript } from "@infinite-canvas/shared/models";
import { createCallScriptSource } from "./template.js";

export const grok2apiScripts: CallScript[] = [
    {
        id: "grok2api-video",
        name: "Grok2API 协议视频",
        description: "POST /v1/videos/generations\n查询：GET /v1/videos/{request_id}\n支持文生、单张首帧、多图参考；不支持尾帧、视频或音频素材。声音与水印由服务决定。",
        logo: "/icons/grok.svg",
        invertInDark: true,
        capability: "video",
        source: createCallScriptSource("video", String.raw`const {
    model,
    prompt,
    images,
    videos,
    audios,
    taskId,
    options,
    utils,
} = params;
// chenyme/grok2api：创建返回 request_id，查询返回 pending / done / failed。
if (taskId) {
    const state = await utils.http.get("/videos/" + encodeURIComponent(taskId));
    if (state.error) {
        return { status: "failed" };
    }
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
}
// 尾帧和音视频文件参考不受支持，不丢弃素材或改为其他用途。
if (
    videos.length ||
    audios.length ||
    (options.mode === "frames" && images.length > 1)
) {
    throw new Error("SCRIPT_VIDEO_REFERENCES_UNSUPPORTED");
}
// duration 接受整数字符串；声音、水印、尾帧等未支持字段不能提交。
const data = {
    model,
    prompt,
    duration: options.seconds,
    aspect_ratio: options.ratio,
    resolution: options.resolution,
};
const references = [];
for (const source of images) {
    references.push({
        url: source.startsWith("blob:") ? await utils.toDataUrl(source) : source,
    });
}
if (references.length) {
    if (options.mode === "reference") {
        data.reference_images = references;
    } else {
        data.image = references[0];
    }
}
const created = await utils.http.post("/videos/generations", data);
if (created.error || !created.request_id) {
    throw new Error("video request failed");
}
return { id: created.request_id };`),
    },
];
