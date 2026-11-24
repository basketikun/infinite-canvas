import { createVideoProtocolScript } from "./video-template.js";

export const wanScripts = [createVideoProtocolScript(
    "wan-video",
    "Wan 协议视频",
    "/api/v1",
    "POST {root}/services/aigc/{video-generation|image2video}/video-synthesis\n万相；按模型选择文生、图生、首尾帧、音频驱动或多素材参考。",
    { logo: "/icons/wan.png" },
    {
        query: String.raw`if (taskId) {
    const state = await utils.request({
        method: "get",
        url: root + "/tasks/" + encodeURIComponent(taskId),
        headers,
    });
    if (state.output?.task_status === "SUCCEEDED") {
        return {
            status: "completed",
            result: { url: state.output.video_url },
        };
    }
    if (["PENDING", "RUNNING"].includes(state.output?.task_status)) {
        return { status: "pending" };
    }
    return { status: "failed" };
}`,
        create: String.raw`const frames = model.includes("-kf2v");
const speech = model.includes("-s2v");
const media = model.startsWith("wan3.") || /^wan2\.7-(i2v|r2v)(-|$)/.test(model);
const service = frames || speech ? "image2video" : "video-generation";
const input = { prompt };
const parameters = {
    resolution: options.resolution.toUpperCase(),
};
if (frames) {
    if (!images.length) {
        throw new Error("SCRIPT_IMAGE_REQUIRED");
    }
    if (images.length > 2 || videos.length || audios.length) {
        throw new Error("SCRIPT_VIDEO_REFERENCES_UNSUPPORTED");
    }
    input.first_frame_url = await utils.toPublicUrl(images[0]);
    if (images[1]) {
        input.last_frame_url = await utils.toPublicUrl(images[1]);
    }
    parameters.duration = Number(options.seconds);
} else if (speech) {
    if (images.length !== 1 || audios.length !== 1 || videos.length) {
        throw new Error("SCRIPT_IMAGE_AUDIO_REQUIRED");
    }
    input.image_url = await utils.toPublicUrl(images[0]);
    input.audio_url = await utils.toPublicUrl(audios[0]);
} else if (media) {
    input.media = [];
    const referenceMode = model.includes("-r2v") || options.mode === "reference" ||
        (!model.includes("2.7-i2v") && (videos.length > 0 || audios.length > 0));
    for (const [index, image] of images.entries()) {
        input.media.push({
            type: referenceMode ? "reference_image" : index === 0 ? "first_frame" : "last_frame",
            url: await utils.toPublicUrl(image),
        });
    }
    for (const video of videos) {
        input.media.push({
            type: model.includes("2.7-i2v") ? "first_clip" : "reference_video",
            url: await utils.toPublicUrl(video),
        });
    }
    for (const audio of audios) {
        input.media.push({
            type: model.includes("2.7-i2v") ? "driving_audio" : "reference_audio",
            url: await utils.toPublicUrl(audio),
        });
    }
    if (!input.media.length) {
        delete input.media;
    }
    parameters.ratio = options.ratio;
    parameters.duration = Number(options.seconds);
    parameters.watermark = options.watermark;
    parameters.audio = options.generateAudio;
} else {
    if (videos.length || images.length > 1 || audios.length > 1) {
        throw new Error("SCRIPT_VIDEO_REFERENCES_UNSUPPORTED");
    }
    if (images.length) {
        input.img_url = await utils.toPublicUrl(images[0]);
    } else if (model.startsWith("wan2.7-t2v")) {
        parameters.ratio = options.ratio;
    } else {
        if (!options.size) {
            throw new Error("SCRIPT_IMAGE_SIZE_REQUIRED");
        }
        parameters.size = options.size.replace("x", "*");
        delete parameters.resolution;
    }
    if (audios.length) {
        input.audio_url = await utils.toPublicUrl(audios[0]);
    }
    parameters.duration = Number(options.seconds);
}
const created = await utils.request({
    method: "post",
    url: root + "/services/aigc/" + service + "/video-synthesis",
    headers: {
        ...headers,
        "X-DashScope-Async": "enable",
    },
    data: {
        model,
        input,
        parameters,
    },
});
return { id: created.output?.task_id };`,
    },
)];
