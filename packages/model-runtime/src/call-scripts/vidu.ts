import { createVideoProtocolScript } from "./video-template.js";

export const viduScripts = [createVideoProtocolScript(
    "vidu-video",
    "Vidu 协议视频",
    "/ent/v2",
    "POST {root}/{text2video|img2video|start-end2video|reference2video}\n按参考素材选择路径。",
    { logo: "/icons/vidu.svg" },
    {
        query: String.raw`if (taskId) {
    const state = await utils.request({
        method: "get",
        url: root + "/tasks/" + encodeURIComponent(taskId) + "/creations",
        headers,
    });
    if (state.state === "success") {
        return {
            status: "completed",
            result: { url: state.creations[0].url },
        };
    }
    if (["created", "queueing", "processing"].includes(state.state)) {
        return { status: "pending" };
    }
    return { status: "failed" };
}`,
        create: String.raw`if (videos.length || audios.length) {
    throw new Error("SCRIPT_VIDEO_REFERENCES_UNSUPPORTED");
}
const operation = !images.length
    ? "text2video"
    : options.mode === "reference"
        ? "reference2video"
        : images.length === 1 ? "img2video" : "start-end2video";
const data = {
    model,
    prompt,
    duration: Number(options.seconds),
    resolution: options.resolution,
};
if (images.length) {
    data.images = [];
    for (const image of images) {
        data.images.push(await utils.toPublicUrl(image));
    }
} else {
    data.aspect_ratio = options.ratio;
}
const created = await utils.request({
    method: "post",
    url: root + "/" + operation,
    headers,
    data,
});
return { id: created.task_id };`,
    },
    "Token",
)];
