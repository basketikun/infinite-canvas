import assert from "node:assert/strict";
import test from "node:test";

import { createDuomiVideoLifecycleTask, pollDuomiVideoLifecycleTask } from "../src/services/api/duomi-video-lifecycle.mjs";

const model = "grok-video-1.5";
const request = {
    model,
    prompt: "海边灯塔",
    size: "1280x720",
    seconds: "6",
    referenceUrls: ["https://assets.example.com/reference.png"],
};

test("creates a task with the documented path and request body", async () => {
    const task = await createDuomiVideoLifecycleTask({
        model,
        request,
        create: async (input) => {
            assert.deepEqual(input, {
                path: "/v1/videos/generations",
                body: {
                    model,
                    prompt: "海边灯塔",
                    aspect_ratio: "16:9",
                    duration: 6,
                    quality: "720p",
                    image_urls: ["https://assets.example.com/reference.png"],
                    oversea: false,
                },
                signal: undefined,
            });
            return { id: " task-1 " };
        },
    });

    assert.deepEqual(task, { id: "task-1", provider: "duomi", model });
});

test("rejects a creation response without a top-level task id", async () => {
    await assert.rejects(
        createDuomiVideoLifecycleTask({
            model,
            request,
            create: async () => ({ data: { id: "nested-id" } }),
        }),
        /多米视频协议错误：任务创建响应缺少任务 ID/,
    );
});

test("rejects local references before making a creation request", async () => {
    let creates = 0;

    await assert.rejects(
        createDuomiVideoLifecycleTask({
            model,
            request: { ...request, referenceUrls: ["data:image/png;base64,AAAA"] },
            create: async () => {
                creates += 1;
                return { id: "task-1" };
            },
        }),
        /多米 Grok 参考图仅支持公网图片 URL/,
    );

    assert.equal(creates, 0);
});

test("returns the first strict public URL for a completed task", async () => {
    const state = await pollDuomiVideoLifecycleTask({
        task: { id: "task-1", provider: "duomi", model },
        poll: async ({ path, signal }) => {
            assert.equal(path, "/v1/videos/tasks/task-1");
            assert.equal(signal, undefined);
            return {
                state: "completed",
                data: {
                    videos: [{ url: "http://127.0.0.1/private.mp4" }, { url: "https://cdn.example.com/result.mp4" }, { url: "https://cdn.example.com/second.mp4" }],
                },
            };
        },
    });

    assert.deepEqual(state, { status: "completed", result: { url: "https://cdn.example.com/result.mp4", mimeType: "video/mp4" } });
});

test("returns a provider failure message", async () => {
    const state = await pollDuomiVideoLifecycleTask({
        task: { id: "task-1", provider: "duomi", model },
        poll: async () => ({ state: "failed", message: "内容被拒绝" }),
    });

    assert.deepEqual(state, { status: "failed", error: "内容被拒绝" });
});

test("uses the default message for a failed task without provider detail", async () => {
    const state = await pollDuomiVideoLifecycleTask({
        task: { id: "task-1", provider: "duomi", model },
        poll: async () => ({ state: "failed" }),
    });

    assert.deepEqual(state, { status: "failed", error: "多米视频生成失败" });
});

test("keeps unknown provider states pending", async () => {
    const state = await pollDuomiVideoLifecycleTask({
        task: { id: "task-1", provider: "duomi", model },
        poll: async () => ({ state: "provider-new-running-state" }),
    });

    assert.deepEqual(state, { status: "pending" });
});

test("rejects completed tasks without a video URL", async () => {
    await assert.rejects(
        pollDuomiVideoLifecycleTask({
            task: { id: "task-1", provider: "duomi", model },
            poll: async () => ({ state: "completed", data: { videos: [] } }),
        }),
        /task-1.*没有返回视频 URL/,
    );
});

test("encodes the task id in the poll path", async () => {
    await pollDuomiVideoLifecycleTask({
        task: { id: " id/with space ", provider: "duomi", model },
        poll: async ({ path }) => {
            assert.equal(path, "/v1/videos/tasks/id%2Fwith%20space");
            return { state: "running" };
        },
    });
});

test("aborts before creating without calling the provider", async () => {
    const controller = new AbortController();
    controller.abort();
    let creates = 0;

    await assert.rejects(
        createDuomiVideoLifecycleTask({
            model,
            request,
            signal: controller.signal,
            create: async () => {
                creates += 1;
                return { id: "task-1" };
            },
        }),
        isAbortError,
    );

    assert.equal(creates, 0);
});

test("aborts after the injected creation request resolves", async () => {
    const controller = new AbortController();

    await assert.rejects(
        createDuomiVideoLifecycleTask({
            model,
            request,
            signal: controller.signal,
            create: async () => {
                controller.abort();
                return { id: "task-1" };
            },
        }),
        isAbortError,
    );
});

test("aborts before polling without calling the provider", async () => {
    const controller = new AbortController();
    controller.abort();
    let polls = 0;

    await assert.rejects(
        pollDuomiVideoLifecycleTask({
            task: { id: "task-1", provider: "duomi", model },
            signal: controller.signal,
            poll: async () => {
                polls += 1;
                return { state: "running" };
            },
        }),
        isAbortError,
    );

    assert.equal(polls, 0);
});

test("aborts after the injected poll request resolves", async () => {
    const controller = new AbortController();

    await assert.rejects(
        pollDuomiVideoLifecycleTask({
            task: { id: "task-1", provider: "duomi", model },
            signal: controller.signal,
            poll: async () => {
                controller.abort();
                return { state: "completed", data: { videos: [{ url: "https://cdn.example.com/result.mp4" }] } };
            },
        }),
        isAbortError,
    );
});

function isAbortError(error) {
    return error instanceof DOMException && error.name === "AbortError" && error.message === "Aborted";
}
