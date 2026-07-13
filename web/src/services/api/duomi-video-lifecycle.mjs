import { duomiVideoCreatePath, duomiVideoRequestBody, duomiVideoTaskErrorMessage, duomiVideoTaskIdFromPayload, duomiVideoTaskPath, duomiVideoTaskStatusFromPayload, duomiVideoUrlsFromPayload } from "./duomi-video-provider-utils.mjs";
import { duomiVideoDeadlineAt, duomiVideoRemainingTimeout } from "./duomi-video-http.mjs";

const DUOMI_VIDEO_ERROR = "多米视频生成失败";

export async function createDuomiVideoLifecycleTask({ model, request, create, signal, now = Date.now }) {
    const deadlineAt = duomiVideoDeadlineAt(now);
    throwIfAborted(signal);
    const body = duomiVideoRequestBody(request);
    const payload = await create({ path: duomiVideoCreatePath(), body, signal, deadlineAt, timeout: duomiVideoRemainingTimeout(deadlineAt, now) });
    throwIfAborted(signal);
    duomiVideoRemainingTimeout(deadlineAt, now);
    const id = duomiVideoTaskIdFromPayload(payload);
    if (!id) throw new Error("多米视频协议错误：任务创建响应缺少任务 ID");
    return { id, provider: "duomi", model, deadlineAt };
}

export async function pollDuomiVideoLifecycleTask({ task, poll, signal, now = Date.now }) {
    throwIfAborted(signal);
    const payload = await poll({ path: duomiVideoTaskPath(task.id), signal, deadlineAt: task.deadlineAt, timeout: duomiVideoRemainingTimeout(task.deadlineAt, now) });
    throwIfAborted(signal);
    duomiVideoRemainingTimeout(task.deadlineAt, now);
    const status = duomiVideoTaskStatusFromPayload(payload);

    if (status === "completed") {
        const url = duomiVideoUrlsFromPayload(payload)[0];
        if (!url) throw new Error(`多米视频任务 ${task.id} 已完成但没有返回视频 URL`);
        return { status: "completed", result: { url, mimeType: "video/mp4" } };
    }
    if (status === "failed") return { status: "failed", error: duomiVideoTaskErrorMessage(payload) || DUOMI_VIDEO_ERROR };
    return { status: "pending" };
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
