import { DUOMI_POLL_INTERVAL_MS, DUOMI_POLL_MAX_ATTEMPTS, duomiImageUrlsFromPayload, duomiTaskErrorMessage, duomiTaskIdFromPayload, duomiTaskStatusFromPayload } from "./duomi-image-provider-utils.mjs";

const DUOMI_IMAGE_ERROR = "多米图片生成失败";
const DUOMI_TIMEOUT_ERROR = "多米图片生成超时，请稍后重试";

export async function runDuomiImageLifecycle({ model, create, poll, wait, now, makeId, signal, interval = DUOMI_POLL_INTERVAL_MS, maxAttempts = DUOMI_POLL_MAX_ATTEMPTS, timeout = DUOMI_POLL_INTERVAL_MS * DUOMI_POLL_MAX_ATTEMPTS }) {
    const deadline = now() + timeout;
    throwIfAborted(signal);
    const created = await create({ signal, timeout: remainingTimeout(deadline, now) });
    assertBeforeDeadline(deadline, now);
    const taskId = duomiTaskIdFromPayload(model, created);
    if (!taskId) throw new Error("多米图片协议错误：任务创建响应缺少任务 ID");

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        throwIfAborted(signal);
        const payload = await poll(taskId, { signal, timeout: remainingTimeout(deadline, now) });
        assertBeforeDeadline(deadline, now);
        const status = duomiTaskStatusFromPayload(model, payload);

        if (status === "completed") {
            const urls = duomiImageUrlsFromPayload(model, payload);
            if (!urls.length) throw new Error(`多米图片任务 ${taskId} 已完成但没有返回图片 URL`);
            return urls.map((url) => ({ id: makeId(), dataUrl: url }));
        }
        if (status === "failed") throw new Error(duomiTaskErrorMessage(model, payload) || DUOMI_IMAGE_ERROR);
        if (attempt + 1 < maxAttempts) {
            await wait(Math.min(interval, remainingTimeout(deadline, now)), signal);
            assertBeforeDeadline(deadline, now);
        }
    }

    throw new Error(DUOMI_TIMEOUT_ERROR);
}

function remainingTimeout(deadline, now) {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error(DUOMI_TIMEOUT_ERROR);
    return Math.max(1, Math.floor(remaining));
}

function assertBeforeDeadline(deadline, now) {
    if (now() >= deadline) throw new Error(DUOMI_TIMEOUT_ERROR);
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
