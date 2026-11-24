import { createVideoProtocolScript } from "./video-template.js";

export const hailuoScripts = [createVideoProtocolScript(
    "hailuo-video",
    "MiniMax 协议视频",
    "/v1",
    "POST {root}/video_generation\n海螺 01 / 02 / 2.3；文生、首尾帧。",
    { logo: "/icons/hailuo.svg" },
    {
        query: String.raw`if (taskId) {
    const state = await utils.request({
        method: "get",
        url: root + "/query/video_generation?task_id=" + encodeURIComponent(taskId),
        headers,
    });
    if (state.base_resp?.status_code !== 0) {
        return { status: "failed" };
    }
    if (state.status === "Success") {
        const file = await utils.request({
            method: "get",
            url: root + "/files/retrieve",
            headers,
            params: { file_id: state.file_id },
        });
        if (file.base_resp.status_code !== 0) {
            return { status: "failed" };
        }
        return {
            status: "completed",
            result: { url: file.file.download_url },
        };
    }
    if (["Preparing", "Queueing", "Processing"].includes(state.status)) {
        return { status: "pending" };
    }
    return { status: "failed" };
}`,
        create: String.raw`if (videos.length || audios.length || images.length > 2) {
    throw new Error("SCRIPT_VIDEO_REFERENCES_UNSUPPORTED");
}
const data = {
    model,
    prompt,
    duration: Number(options.seconds),
    resolution: options.resolution.toUpperCase(),
};
if (images[0]) {
    data.first_frame_image = await utils.toPublicUrl(images[0]);
}
if (images[1]) {
    data.last_frame_image = await utils.toPublicUrl(images[1]);
}
const created = await utils.request({
    method: "post",
    url: root + "/video_generation",
    headers,
    data,
});
if (created.base_resp.status_code !== 0) {
    throw new Error("video creation failed");
}
return { id: created.task_id };`,
    },
)];
