import axios from "axios";

export type ComfyOutputFile = { filename: string; subfolder?: string; type?: string };

type ComfyHistoryRun = {
    status?: { status_str?: string; completed?: boolean; messages?: Array<[unknown, { message?: string }?]> };
    outputs?: Record<string, { gifs?: ComfyOutputFile[]; videos?: ComfyOutputFile[]; images?: ComfyOutputFile[] }>;
};

export type ComfyUiRuntime = {
    normalizeBaseUrl: (value: string) => string;
    uploadDataUrls: (baseUrl: string, dataUrls: string[], prefix: string, maxFiles: number, label?: string) => Promise<string[]>;
    runWorkflow: (baseUrl: string, workflow: unknown) => Promise<ComfyOutputFile>;
    toVideoResult: (baseUrl: string, file: ComfyOutputFile) => { url: string; mimeType: string };
};

function abortableDelay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

export function normalizeComfyBaseUrl(value: string) {
    const normalized = value.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
    let parsed: URL;
    try {
        parsed = new URL(normalized);
    } catch {
        throw new Error("ComfyUI Base URL 无效，请填写例如 http://127.0.0.1:8188");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("ComfyUI Base URL 只支持 http:// 或 https://");
    return normalized;
}

function isRetryableRequestError(error: unknown) {
    if (axios.isCancel(error)) return false;
    if (!axios.isAxiosError(error)) return false;
    if (!error.response) return true;
    return error.response.status === 408 || error.response.status === 429 || error.response.status >= 500;
}

export function createComfyUiRuntime(signal?: AbortSignal): ComfyUiRuntime {
    const retry = async <T>(request: () => Promise<T>, tries = 3) => {
        let lastError: unknown;
        for (let attempt = 0; attempt < tries; attempt += 1) {
            try {
                return await request();
            } catch (error) {
                lastError = error;
                if (!isRetryableRequestError(error) || attempt === tries - 1) throw error;
                await abortableDelay(800 * (attempt + 1), signal);
            }
        }
        throw lastError;
    };

    const uploadDataUrls = async (baseUrl: string, dataUrls: string[], prefix: string, maxFiles: number, label = prefix) => {
        if (dataUrls.length > maxFiles) throw new Error(`${label}最多 ${maxFiles} 个文件`);
        const extensionByMime: Record<string, string> = {
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/webp": "webp",
            "video/mp4": "mp4",
            "video/webm": "webm",
            "video/quicktime": "mov",
            "audio/mpeg": "mp3",
            "audio/wav": "wav",
            "audio/x-wav": "wav",
            "audio/flac": "flac",
            "audio/aac": "aac",
            "audio/ogg": "ogg",
        };
        const names: string[] = [];
        for (let index = 0; index < dataUrls.length; index += 1) {
            const dataUrl = dataUrls[index];
            const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] || "";
            const blob = await (await fetch(dataUrl, { signal })).blob();
            const form = new FormData();
            form.set("image", blob, `${prefix}_${index}.${extensionByMime[mime] || "bin"}`);
            const response = await retry(() => axios.post<{ name?: string }>(`${baseUrl}/upload/image`, form, { signal }).then((item) => item.data));
            if (!response.name) throw new Error("ComfyUI 上传响应缺少文件名");
            names.push(response.name);
        }
        return names;
    };

    const runWorkflow = async (baseUrl: string, workflow: unknown) => {
        if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) throw new Error("ComfyUI workflow 必须是 API-format 节点对象，不能使用前端 workflow 格式");
        const clientId = `canvas-${Math.random().toString(36).slice(2)}`;
        // /prompt is not idempotent: replaying an ambiguous network failure can enqueue duplicate generations.
        const submitted = await axios.post<{ prompt_id?: string }>(`${baseUrl}/prompt`, { prompt: workflow, client_id: clientId }, { signal }).then((item) => item.data);
        if (!submitted.prompt_id) throw new Error(`ComfyUI 提交响应缺少 prompt_id: ${JSON.stringify(submitted)}`);
        const promptId = submitted.prompt_id;
        const deadline = performance.now() + 1200000;
        for (;;) {
            const history = await retry(() => axios.get<Record<string, ComfyHistoryRun>>(`${baseUrl}/history/${promptId}`, { signal }).then((item) => item.data));
            const run = history[promptId];
            if (run?.status?.status_str === "error") {
                const messages = run.status.messages || [];
                const last = messages[messages.length - 1];
                throw new Error(`ComfyUI: ${last?.[1]?.message || "execution error"}`);
            }
            if (run?.status?.completed) {
                const files = Object.values(run.outputs || {}).flatMap((output) => [...(output.gifs || []), ...(output.videos || []), ...(output.images || [])]);
                const video = files.find((file) => /\.(mp4|webm|mov|mkv)$/i.test(file.filename));
                if (!video) throw new Error("ComfyUI 已完成，但输出中没有找到 MP4、WebM、MOV 或 MKV 视频文件");
                return video;
            }
            if (performance.now() >= deadline) throw new Error("ComfyUI workflow 运行超时");
            await abortableDelay(5000, signal);
        }
    };

    return {
        normalizeBaseUrl: normalizeComfyBaseUrl,
        uploadDataUrls,
        runWorkflow,
        toVideoResult: (baseUrl, file) => ({
            url: `${baseUrl}/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder || "")}&type=${encodeURIComponent(file.type || "output")}`,
            mimeType: file.filename.toLowerCase().endsWith(".webm") ? "video/webm" : file.filename.toLowerCase().endsWith(".mov") ? "video/quicktime" : file.filename.toLowerCase().endsWith(".mkv") ? "video/x-matroska" : "video/mp4",
        }),
    };
}
