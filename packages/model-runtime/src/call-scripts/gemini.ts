import type { CallScript } from "@infinite-canvas/shared/models";
import { createCallScriptSource } from "./template.js";

export const geminiScripts: CallScript[] = [
    {
        id: "gemini-image",
        name: "Gemini 协议生图",
        description: "POST /v1beta/models/{model}:generateContent",
        logo: "/icons/gemini.svg",
        capability: "image",
        source: createCallScriptSource("image", String.raw`const { model, prompt, images, baseUrl, apiKey, options, utils } = params;
const root = baseUrl.replace(/\/+$/, "").replace(/\/v1(?:beta)?$/, "") + "/v1beta";
const parts = [
    { text: prompt },
    ...(await Promise.all(
        images.map(async (image) => {
            const [header, data] = (await utils.toDataUrl(image)).split(",");
            return {
                inlineData: {
                    mimeType: header.slice(5, -7),
                    data,
                },
            };
        }),
    )),
];
const { count, ratio, resolution, size } = options;
const supportedRatios = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];
let aspectRatio;
if (ratio) {
    const [width, height] = ratio.split(":").map(Number);
    const target = width / height;
    aspectRatio = supportedRatios.reduce((best, item) => {
        const [currentWidth, currentHeight] = item.split(":").map(Number);
        const [bestWidth, bestHeight] = best.split(":").map(Number);
        return Math.abs(currentWidth / currentHeight - target) < Math.abs(bestWidth / bestHeight - target) ? item : best;
    });
}
let imageSize = resolution;
if (!imageSize && size) {
    const edge = Math.max(...size.split("x").map(Number));
    imageSize = edge <= 768 ? "512" : edge <= 1536 ? "1K" : edge <= 3072 ? "2K" : "4K";
}
const results = await Promise.all(
    Array.from({ length: count }, async () => {
        const data = await utils.request({
            method: "post",
            url:
                root +
                "/models/" +
                encodeURIComponent(model.replace(/^models\//, "")) +
                ":generateContent",
            headers: { "x-goog-api-key": apiKey },
            timeout: 600000,
            data: {
                contents: [
                    {
                        role: "user",
                        parts,
                    },
                ],
                generationConfig: {
                    responseModalities: ["TEXT", "IMAGE"],
                    imageConfig: {
                        ...(aspectRatio ? { aspectRatio } : {}),
                        ...(imageSize ? { imageSize: imageSize.toUpperCase() } : {}),
                    },
                },
            },
        });
        if (data.error || data.promptFeedback?.blockReason) {
            throw new Error("image request failed");
        }
        return data.candidates
            .flatMap((candidate) => candidate.content.parts)
            .flatMap((part) => {
                const inline = part.inlineData || part.inline_data;
                if (inline) {
                    return [
                        "data:" +
                            (inline.mimeType || inline.mime_type) +
                            ";base64," +
                            inline.data,
                    ];
                }
                return part.fileData?.fileUri ? [part.fileData.fileUri] : [];
            });
    }),
);
return results.flat();`),
    },
    {
        id: "gemini-text",
        name: "Gemini 协议文本",
        description: "POST /v1beta/models/{model}:streamGenerateContent?alt=sse",
        logo: "/icons/gemini.svg",
        capability: "text",
        source: createCallScriptSource("text", String.raw`if (params.tools) {
    if (params.reasoningEffort === "xhigh") {
        throw new Error("TEXT_REASONING_UNSUPPORTED");
    }
    return params.utils.runTextAgent("gemini", {
        providerOptions: params.reasoningEffort === "auto" ? undefined : {
            google: { thinkingConfig: { thinkingLevel: params.reasoningEffort } },
        },
    });
}

const { model, messages, baseUrl, apiKey, utils } = params;
const root = baseUrl.replace(/\/+$/, "").replace(/\/v1(?:beta)?$/, "") + "/v1beta";
const systems = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
const contents = messages
    .filter((message) => message.role !== "system")
    .map(({ role, content }) => ({
        role: role === "assistant" ? "model" : "user",
        parts:
            typeof content === "string"
                ? [{ text: content }]
                : content.map((part) => {
                      if (part.type === "text") {
                          return { text: part.text };
                      }
                      const url = part.image_url.url;
                      if (!url.startsWith("data:")) {
                          return {
                              fileData: {
                                  fileUri: url,
                                  mimeType: "image/png",
                              },
                          };
                      }
                      const [header, data] = url.split(",");
                      return {
                          inlineData: {
                              mimeType: header.slice(5, -7),
                              data,
                          },
                      };
                  }),
    }));
let text = "";
await utils.stream(
    {
        url:
            root +
            "/models/" +
            encodeURIComponent(model.replace(/^models\//, "")) +
            ":streamGenerateContent?alt=sse",
        headers: { "x-goog-api-key": apiKey },
        data: {
            contents,
            ...(systems ? { systemInstruction: { parts: [{ text: systems }] } } : {}),
        },
    },
    (event) => {
        if (event.error || event.promptFeedback?.blockReason) {
            throw new Error("text request failed");
        }
        for (const candidate of event.candidates || []) {
            for (const part of candidate.content?.parts || []) {
                if (part.text && !part.thought) {
                    text += part.text;
                }
            }
        }
        if (text) {
            utils.onDelta(text);
        }
    },
);
return text;`),
    },
    {
        id: "gemini-video",
        name: "Gemini 协议视频",
        description: "创建：POST /v1beta/models/{model}:predictLongRunning\n查询：GET /v1beta/{taskId}",
        logo: "/icons/gemini.svg",
        capability: "video",
        source: createCallScriptSource("video", String.raw`const { model, prompt, images, videos, audios, baseUrl, apiKey, taskId, options, utils } =
    params;
const root = baseUrl.replace(/\/+$/, "").replace(/\/v1(?:beta)?$/, "") + "/v1beta";
const headers = { "x-goog-api-key": apiKey };
function unwrap(payload) {
    if (payload.code !== undefined && payload.code !== 0 && payload.code !== "0") {
        throw new Error("video request failed");
    }
    return payload.code !== undefined ? payload.data : payload;
}
if (taskId) {
    const state = unwrap(
        await utils.request({
            method: "get",
            url: root + "/" + taskId,
            headers,
        }),
    );
    if (state.error) {
        return { status: "failed" };
    }
    if (!state.done) {
        return { status: "pending" };
    }
    const uri = state.response.generateVideoResponse.generatedSamples[0].video.uri;
    return {
        status: "completed",
        result: await utils.request({
            method: "get",
            url: uri,
            headers,
            responseType: "blob",
        }),
    };
}
async function inline(source) {
    const dataUrl = await utils.toDataUrl(source);
    const [header, data] = dataUrl.split(",");
    return {
        bytesBase64Encoded: data,
        mimeType: header.slice(5, -7),
    };
}
const { mode, ratio, seconds, resolution } = options;
const instance = { prompt };
if (mode === "frames") {
    if (images[0]) {
        instance.image = await inline(images[0]);
    }
    if (images[1]) {
        instance.lastFrame = await inline(images[1]);
    }
} else {
    instance.referenceImages = await Promise.all(
        images.map(async (image) => ({
            image: await inline(image),
            referenceType: "asset",
        })),
    );
}
if (videos[0]) {
    instance.video = await inline(videos[0]);
}
if (audios[0]) {
    instance.audio = await inline(audios[0]);
}
const created = unwrap(
    await utils.request({
        method: "post",
        url:
            root +
            "/models/" +
            encodeURIComponent(model.replace(/^models\//, "")) +
            ":predictLongRunning",
        headers,
        data: {
            instances: [instance],
            parameters: {
                aspectRatio: ratio,
                durationSeconds: Number(seconds),
                resolution,
            },
        },
    }),
);
if (created.error) {
    throw new Error("video request failed");
}
return { id: created.name };`),
    },
];
