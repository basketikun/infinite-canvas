import assert from "node:assert/strict";
import test from "node:test";

import { runDuomiImageLifecycle } from "../src/services/api/duomi-image-lifecycle.mjs";

const model = "gpt-image-2";

function lifecycleOptions(overrides = {}) {
    return {
        model,
        create: async () => ({ id: "task-1" }),
        poll: async () => ({ state: "completed", data: { images: [{ url: "https://cdn.example.com/result.png" }] } }),
        wait: async () => {},
        now: () => 0,
        makeId: () => "image-1",
        ...overrides,
    };
}

test("returns every completed image URL and polls immediately", async () => {
    let polls = 0;
    let waits = 0;
    const ids = ["image-1", "image-2"];
    const images = await runDuomiImageLifecycle(
        lifecycleOptions({
            create: async ({ timeout }) => {
                assert.equal(timeout, 300000);
                return { id: "task-1" };
            },
            poll: async (_taskId, { timeout }) => {
                polls += 1;
                assert.equal(timeout, 300000);
                return { state: "completed", data: { images: [{ url: "https://cdn.example.com/a.png" }, { url: "https://cdn.example.com/b.png" }] } };
            },
            wait: async () => {
                waits += 1;
            },
            makeId: () => ids.shift(),
        }),
    );

    assert.deepEqual(images, [
        { id: "image-1", dataUrl: "https://cdn.example.com/a.png" },
        { id: "image-2", dataUrl: "https://cdn.example.com/b.png" },
    ]);
    assert.equal(polls, 1);
    assert.equal(waits, 0);
});

test("throws the provider message when a task reports an error", async () => {
    await assert.rejects(
        runDuomiImageLifecycle(
            lifecycleOptions({
                poll: async () => ({ state: "running", msg: "内容被拒绝" }),
            }),
        ),
        /内容被拒绝/,
    );
});

test("rejects completed tasks without image URLs", async () => {
    await assert.rejects(
        runDuomiImageLifecycle(
            lifecycleOptions({
                poll: async () => ({ state: "completed", data: { images: [] } }),
            }),
        ),
        /task-1.*已完成但没有返回图片 URL/,
    );
});

test("enforces one hard deadline across create and poll", async () => {
    let currentTime = 1000;
    let polls = 0;
    let waits = 0;

    await assert.rejects(
        runDuomiImageLifecycle(
            lifecycleOptions({
                timeout: 100,
                interval: 20,
                now: () => currentTime,
                create: async ({ timeout }) => {
                    assert.equal(timeout, 100);
                    currentTime += 30;
                    return { id: "task-1" };
                },
                poll: async (_taskId, { timeout }) => {
                    polls += 1;
                    assert.equal(timeout, 70);
                    currentTime = 1100;
                    return { state: "running" };
                },
                wait: async () => {
                    waits += 1;
                },
            }),
        ),
        /多米图片生成超时，请稍后重试/,
    );

    assert.equal(polls, 1);
    assert.equal(waits, 0);
});

test("stops after at most 150 polls", async () => {
    let polls = 0;
    let waits = 0;

    await assert.rejects(
        runDuomiImageLifecycle(
            lifecycleOptions({
                interval: 0,
                poll: async () => {
                    polls += 1;
                    return { state: "running" };
                },
                wait: async () => {
                    waits += 1;
                },
            }),
        ),
        /多米图片生成超时，请稍后重试/,
    );

    assert.equal(polls, 150);
    assert.equal(waits, 149);
});

test("does not poll again after cancellation while waiting", async () => {
    const controller = new AbortController();
    let polls = 0;

    await assert.rejects(
        runDuomiImageLifecycle(
            lifecycleOptions({
                signal: controller.signal,
                poll: async () => {
                    polls += 1;
                    return { state: "running" };
                },
                wait: async () => {
                    controller.abort();
                    throw new DOMException("Aborted", "AbortError");
                },
            }),
        ),
        (error) => error instanceof DOMException && error.name === "AbortError",
    );

    assert.equal(polls, 1);
});
