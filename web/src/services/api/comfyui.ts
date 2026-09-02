import { fetchAgentJson, syncRuntimeMedia } from "./canvas-agent";

type LocalReference = { name: string; dataUrl?: string; url?: string };
type ComfyMedia = { url: string; mimeType: string; storageKey?: string };
type ComfyTask = { id: string; status: "queued" | "running" | "succeeded" | "failed" | "cancelled"; progress: number; result?: { media?: ComfyMedia[]; segments?: Array<{ media?: ComfyMedia[] }> } | null; error?: string | null };

export function resolveComfyImageSize(value: string) {
    const size = value.trim();
    // `auto` means preserve the source workflow's natural dimensions. The
    // Flux workflow uses the first reference image for this case; returning
    // zeroes keeps the request shape stable while preventing the backend from
    // treating auto as an explicit 1024x1024 override.
    if (!size || size.toLowerCase() === "auto") return { width: 0, height: 0 };
    const dimensions = size.match(/^(\d+)x(\d+)$/i);
    if (dimensions) return { width: Number(dimensions[1]), height: Number(dimensions[2]) };
    const ratio = size.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (!ratio) return { width: 1024, height: 1024 };
    const ratioWidth = Number(ratio[1]);
    const ratioHeight = Number(ratio[2]);
    const shortSide = 1024;
    const landscape = ratioWidth >= ratioHeight;
    const longSide = Math.round((shortSide * Math.max(ratioWidth, ratioHeight) / Math.min(ratioWidth, ratioHeight)) / 16) * 16;
    return landscape ? { width: longSide, height: shortSide } : { width: shortSide, height: longSide };
}

export async function runComfyTask(endpoint: string, token: string, comfyUrl: string, preset: string, prompt: string, references: LocalReference[], params: Record<string, unknown>, signal?: AbortSignal) {
    const synced = await Promise.all(references.map(async (reference) => {
        const source = reference.dataUrl || reference.url || "";
        const dataUrl = source.startsWith("data:") ? source : await fetchAsDataUrl(source, signal);
        return (await syncRuntimeMedia(endpoint, token, reference.name, dataUrl)).media?.path;
    }));
    const input: Record<string, unknown> = { prompt };
    if (preset === "flux2-klein") input.references = synced.filter(Boolean);
    if (preset === "flashvsr-1.1" && synced[0]) input.video = synced[0];
    const created = await fetchAgentJson<{ task: ComfyTask }>(endpoint, token, "/comfy/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ preset, input, params, comfyUrl }) });
    for (;;) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const response = await fetchAgentJson<{ task: ComfyTask }>(endpoint, token, `/comfy/tasks/${created.task.id}`);
        if (["succeeded", "failed", "cancelled"].includes(response.task.status)) {
            if (response.task.status !== "succeeded") throw new Error(response.task.error || "ComfyUI 任务失败");
            const media = response.task.result?.media?.[0];
            if (!media) throw new Error("ComfyUI 任务完成但没有返回媒体");
            const parsed = new URL(media.url);
            return { ...media, url: `${endpoint}/comfy/media${parsed.search}${parsed.search ? "&" : "?"}token=${encodeURIComponent(token)}` };
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
    }
}

export type LocalH3Input = {
    video?: LocalReference;
    references?: LocalReference[];
    audios?: LocalReference[];
    previousVideo?: LocalReference;
};

/** Run the packaged MiniMax H3 workflow through the Agent runtime. The plugin never talks to ComfyUI directly. */
export async function runLocalH3Task(endpoint: string, token: string, comfyUrl: string, prompt: string, input: LocalH3Input, params: Record<string, unknown>, signal?: AbortSignal, onTaskId?: (taskId: string) => void) {
    const refs = [...(input.references || []), ...(input.audios || []), ...(input.video ? [input.video] : []), ...(input.previousVideo ? [input.previousVideo] : [])];
    const synced = await Promise.all(refs.map(async (reference) => {
        const source = reference.dataUrl || reference.url || "";
        const dataUrl = source.startsWith("data:") ? source : await fetchAsDataUrl(source, signal);
        return { reference, path: (await syncRuntimeMedia(endpoint, token, reference.name, dataUrl)).media?.path };
    }));
    const pathFor = (reference?: LocalReference) => synced.find((item) => item.reference === reference)?.path;
    const created = await fetchAgentJson<{ task: ComfyTask }>(endpoint, token, "/comfy/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ preset: "minimax-h3", input: { prompt, references: (input.references || []).map(pathFor).filter(Boolean), audios: (input.audios || []).map(pathFor).filter(Boolean), video: pathFor(input.video), previousVideo: pathFor(input.previousVideo) }, params, comfyUrl }) });
    onTaskId?.(created.task.id);
    for (;;) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const response = await fetchAgentJson<{ task: ComfyTask }>(endpoint, token, `/comfy/tasks/${created.task.id}`);
        if (["succeeded", "failed", "cancelled"].includes(response.task.status)) {
            if (response.task.status !== "succeeded") throw new Error(response.task.error || "MiniMax H3 任务失败");
            const media = response.task.result?.media?.find((item) => String(item.mimeType || "video/mp4").startsWith("video/")) || response.task.result?.media?.[0];
            if (!media) throw new Error("MiniMax H3 完成但没有返回视频");
            const proxy = (item: ComfyMedia) => {
                if (item.url.startsWith("runtime-file:")) return { ...item, url: `${endpoint}/runtime/media-file?file=${encodeURIComponent(item.url.slice("runtime-file:".length))}&token=${encodeURIComponent(token)}` };
                const parsed = new URL(item.url);
                return { ...item, url: `${endpoint}/comfy/media${parsed.search}${parsed.search ? "&" : "?"}token=${encodeURIComponent(token)}` };
            };
            return { ...proxy(media), segments: (response.task.result?.segments || []).map((segment) => ({ media: (segment.media || []).map(proxy) })), taskId: created.task.id };
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
    }
}

export async function getLocalH3Task(endpoint: string, token: string, taskId: string) {
    const response = await fetchAgentJson<{ task: ComfyTask }>(endpoint, token, `/comfy/tasks/${encodeURIComponent(taskId)}`);
    const proxy = (item: ComfyMedia) => {
        if (item.url.startsWith("runtime-file:")) return { ...item, url: `${endpoint}/runtime/media-file?file=${encodeURIComponent(item.url.slice("runtime-file:".length))}&token=${encodeURIComponent(token)}` };
        const parsed = new URL(item.url);
        return { ...item, url: `${endpoint}/comfy/media${parsed.search}${parsed.search ? "&" : "?"}token=${encodeURIComponent(token)}` };
    };
    if (!response.task.result) return { ...response.task, result: null };
    const media = (response.task.result.media || []).map(proxy);
    return { ...response.task, result: { url: media.find((item) => item.mimeType.startsWith("video/"))?.url || media[0]?.url || "", mimeType: media.find((item) => item.mimeType.startsWith("video/"))?.mimeType || media[0]?.mimeType || "video/mp4", taskId: response.task.id, segments: (response.task.result.segments || []).map((segment) => ({ media: (segment.media || []).map(proxy) })) } };
}

/** Legacy H3 execution path for nodes migrated from the old RunningHub-backed canvas. */
export async function runRunningHubH3Task(endpoint: string, token: string, prompt: string, input: LocalH3Input, params: Record<string, unknown>, signal?: AbortSignal, onTaskId?: (taskId: string) => void) {
    const refs = [...(input.references || []), ...(input.audios || []), ...(input.video ? [input.video] : []), ...(input.previousVideo ? [input.previousVideo] : [])];
    const synced = await Promise.all(refs.map(async (reference) => {
        const source = reference.dataUrl || reference.url || "";
        const dataUrl = source.startsWith("data:") ? source : await fetchAsDataUrl(source, signal);
        return { reference, path: (await syncRuntimeMedia(endpoint, token, reference.name, dataUrl)).media?.path };
    }));
    const pathFor = (reference?: LocalReference) => synced.find((item) => item.reference === reference)?.path;
    const created = await fetchAgentJson<{ task: ComfyTask }>(endpoint, token, "/runninghub/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: { prompt, references: (input.references || []).map(pathFor).filter(Boolean), audios: (input.audios || []).map(pathFor).filter(Boolean), video: pathFor(input.video), previousVideo: pathFor(input.previousVideo) }, params }) });
    onTaskId?.(created.task.id);
    for (;;) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const response = await fetchAgentJson<{ task: ComfyTask }>(endpoint, token, `/runninghub/tasks/${created.task.id}`);
        if (["succeeded", "failed", "cancelled"].includes(response.task.status)) {
            if (response.task.status !== "succeeded") throw new Error(response.task.error || "RunningHub H3 任务失败");
            const media = response.task.result?.media?.find((item) => item.mimeType.startsWith("video/")) || response.task.result?.media?.[0];
            if (!media) throw new Error("RunningHub H3 完成但没有返回媒体");
            return { ...media, mimeType: media.mimeType || "video/mp4", taskId: created.task.id };
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
    }
}

export async function getRunningHubH3Task(endpoint: string, token: string, taskId: string) {
    const task = (await fetchAgentJson<{ task: ComfyTask }>(endpoint, token, `/runninghub/tasks/${encodeURIComponent(taskId)}`)).task;
    if (!task.result) return { ...task, result: null };
    const media = task.result.media || [];
    const output = media.find((item) => String(item.mimeType || "video/mp4").startsWith("video/")) || media[0];
    return { ...task, result: output ? { url: output.url, mimeType: output.mimeType || "video/mp4", taskId: task.id } : null };
}

async function fetchAsDataUrl(url: string, signal?: AbortSignal) {
    if (!url) throw new Error("本地媒体缺少可读取地址");
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`读取本地媒体失败：HTTP ${response.status}`);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error || new Error("读取媒体失败")); reader.readAsDataURL(blob); });
}
