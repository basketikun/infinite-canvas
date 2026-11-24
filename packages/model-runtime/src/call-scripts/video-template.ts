import type { CallScript } from "@infinite-canvas/shared/models";
import { createCallScriptSource } from "./template.js";

/**
 * 生成可单独编辑和导出的完整视频协议源码。
 */
export function createVideoProtocolScript(id: string, name: string, path: string, description: string, brand: Pick<CallScript, "logo" | "invertInDark">, body: { query: string; create: string }, authorization = "Bearer"): CallScript {
    return {
        id,
        name,
        description: description.replaceAll("{root}", path),
        capability: "video",
        ...brand,
        source: createCallScriptSource("video", `const {
    model,
    prompt,
    images,
    videos,
    audios,
    taskId,
    options,
    baseUrl,
    apiKey,
    utils,
} = params;
// 渠道可填写服务根地址或下方完整路径；保留部署时的子目录。
const path = ${JSON.stringify(path)};
const base = baseUrl.replace(/\\/$/, "");
const root = base.endsWith(path) ? base : base.replace(/\\/v1$/, "") + path;
const headers = {
    Authorization: ${JSON.stringify(authorization + " ")} + apiKey,
};
${body.query}
${body.create}`),
    };
}
