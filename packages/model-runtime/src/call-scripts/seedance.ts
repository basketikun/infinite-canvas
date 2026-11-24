import { createVideoProtocolScript } from "./video-template.js";

export const seedanceScripts = [createVideoProtocolScript(
    "seedance-video",
    "Seedance 协议视频",
    "/api/v3",
    "POST {root}/contents/generations/tasks\n豆包 / 火山方舟；支持首尾帧、多素材参考。",
    { logo: "/icons/doubao.svg" },
    {
        query: String.raw`if (taskId) {
    const endpoint = root + "/contents/generations/tasks";
    const state = await utils.request({
        method: "get",
        url: endpoint + "/" + encodeURIComponent(taskId),
        headers,
    });
    if (state.status === "succeeded" && state.content?.video_url) {
        return {
            status: "completed",
            result: { url: state.content.video_url },
        };
    }
    if (["queued", "running"].includes(state.status)) {
        return { status: "pending" };
    }
    return { status: "failed" };
}`,
        create: String.raw`const endpoint = root + "/contents/generations/tasks";
const referenceMode = options.mode === "reference" || videos.length > 0 || audios.length > 0;
const content = [{
    type: "text",
    text: prompt,
}];
for (const [index, image] of images.entries()) {
    content.push({
        type: "image_url",
        image_url: {
            url: image.startsWith("asset:") ? image
                : /^https?:/.test(image) ? await utils.toPublicUrl(image) : await utils.toDataUrl(image),
        },
        role: referenceMode ? "reference_image" : index === 0 ? "first_frame" : "last_frame",
    });
}
for (const video of videos) {
    content.push({
        type: "video_url",
        video_url: {
            url: video.startsWith("asset:") ? video : await utils.toPublicUrl(video),
        },
        role: "reference_video",
    });
}
for (const audio of audios) {
    content.push({
        type: "audio_url",
        audio_url: {
            url: audio.startsWith("asset:") ? audio
                : /^https?:/.test(audio) ? await utils.toPublicUrl(audio) : await utils.toDataUrl(audio),
        },
        role: "reference_audio",
    });
}
const created = await utils.request({
    method: "post",
    url: endpoint,
    headers,
    data: {
        model,
        content,
        duration: Number(options.seconds),
        resolution: options.resolution,
        ratio: images.length && !referenceMode ? "adaptive" : options.ratio,
        generate_audio: options.generateAudio,
        watermark: options.watermark,
    },
});
return { id: created.id };`,
    },
)];
