import { createVideoProtocolScript } from "./video-template.js";

export const klingScripts = [createVideoProtocolScript(
    "kling-video",
    "Kling 协议视频",
    "/v1/videos",
    "POST {root}/{text2video|image2video}\n可灵；无图文生，有图图生；需填写已签发的 JWT。",
    { logo: "/icons/kling.svg" },
    {
        query: String.raw`if (taskId) {
    const state = await utils.request({
        method: "get",
        url: root + "/" + taskId,
        headers,
    });
    if (state.code !== 0) {
        return { status: "failed" };
    }
    if (state.data.task_status === "succeed") {
        return {
            status: "completed",
            result: { url: state.data.task_result.videos[0].url },
        };
    }
    if (["submitted", "processing"].includes(state.data.task_status)) {
        return { status: "pending" };
    }
    return { status: "failed" };
}`,
        create: String.raw`const operation = images.length ? "image2video" : "text2video";
if (videos.length || audios.length) {
    throw new Error("SCRIPT_VIDEO_REFERENCES_UNSUPPORTED");
}
const data = {
    model_name: model,
    prompt,
    duration: options.seconds,
    aspect_ratio: options.ratio,
};
if (images.length) {
    if (images.length > 2 || options.mode === "reference") {
        throw new Error("SCRIPT_VIDEO_REFERENCES_UNSUPPORTED");
    }
    data.image = await utils.toPublicUrl(images[0]);
    if (images[1]) {
        data.image_tail = await utils.toPublicUrl(images[1]);
    }
}
const created = await utils.request({
    method: "post",
    url: root + "/" + operation,
    headers,
    data,
});
if (created.code !== 0) {
    throw new Error("video creation failed");
}
// 将创建类型一并保存，查询时不依赖图片或当前生成设置。
return { id: operation + "/" + encodeURIComponent(created.data.task_id) };`,
    },
)];
