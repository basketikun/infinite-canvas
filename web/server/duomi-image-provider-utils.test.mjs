import assert from "node:assert/strict";
import test from "node:test";

import {
    DUOMI_IMAGE_MODELS,
    DUOMI_POLL_INTERVAL_MS,
    DUOMI_POLL_MAX_ATTEMPTS,
    duomiCreatePath,
    duomiImageRequestBody,
    duomiImageUrlsFromPayload,
    duomiReferenceUrls,
    duomiTaskErrorMessage,
    duomiTaskIdFromPayload,
    duomiTaskPath,
    duomiTaskStatusFromPayload,
    isDuomiImageModel,
    isDuomiNanoBananaModel,
} from "../src/services/api/duomi-image-provider-utils.mjs";

test("exports the documented Duomi image models and polling constants", () => {
    assert.deepEqual(DUOMI_IMAGE_MODELS, ["gpt-image-2", "gemini-2.5-flash-image", "gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"]);
    assert.equal(DUOMI_IMAGE_MODELS.includes("gemini-3.1-flash-lite-image"), false);
    assert.equal(DUOMI_POLL_INTERVAL_MS, 2000);
    assert.equal(DUOMI_POLL_MAX_ATTEMPTS, 150);
});

test("recognizes only documented Duomi image models", () => {
    assert.equal(isDuomiImageModel("gpt-image-2"), true);
    assert.equal(isDuomiImageModel(" gemini-2.5-flash-image "), true);
    assert.equal(isDuomiImageModel("gemini-3-pro-image-preview"), true);
    assert.equal(isDuomiImageModel("gemini-3.1-flash-image-preview"), true);
    assert.equal(isDuomiImageModel("gemini-3.1-flash-lite-image"), false);
    assert.equal(isDuomiImageModel("GPT-IMAGE-2"), false);
});

test("recognizes the three Nano Banana models without classifying gpt-image-2", () => {
    assert.equal(isDuomiNanoBananaModel("gemini-2.5-flash-image"), true);
    assert.equal(isDuomiNanoBananaModel("gemini-3-pro-image-preview"), true);
    assert.equal(isDuomiNanoBananaModel("gemini-3.1-flash-image-preview"), true);
    assert.equal(isDuomiNanoBananaModel("gpt-image-2"), false);
    assert.equal(isDuomiNanoBananaModel("gemini-3.1-flash-lite-image"), false);
});

test("selects documented create routes for gpt-image-2 and Nano Banana", () => {
    assert.equal(duomiCreatePath("gpt-image-2", []), "/v1/images/generations");
    assert.equal(duomiCreatePath("gemini-2.5-flash-image", []), "/api/gemini/nano-banana");
    assert.equal(duomiCreatePath("gemini-3-pro-image-preview", ["https://assets.example.com/a.png"]), "/api/gemini/nano-banana-edit");
});

test("encodes task ids in the model-specific task routes", () => {
    assert.equal(duomiTaskPath("gpt-image-2", "id/with space"), "/v1/tasks/id%2Fwith%20space");
    assert.equal(duomiTaskPath("gemini-3.1-flash-image-preview", "id/with space"), "/api/gemini/nano-banana/id%2Fwith%20space");
});

test("builds Nano Banana request bodies and maps image quality", () => {
    const qualities = {
        low: "1K",
        medium: "2K",
        high: "4K",
        standard: "2K",
        hd: "4K",
    };

    for (const [quality, imageSize] of Object.entries(qualities)) {
        assert.deepEqual(duomiImageRequestBody({ model: "gemini-3-pro-image-preview", prompt: "海边灯塔", size: "16:9", quality, referenceUrls: [] }), {
            model: "gemini-3-pro-image-preview",
            prompt: "海边灯塔",
            aspect_ratio: "16:9",
            image_size: imageSize,
        });
    }

    assert.deepEqual(duomiImageRequestBody({ model: "gemini-2.5-flash-image", prompt: "改成夜景", size: "4:3", quality: "medium", referenceUrls: ["https://assets.example.com/a.png", "https://assets.example.com/b.png"] }), {
        model: "gemini-2.5-flash-image",
        prompt: "改成夜景",
        aspect_ratio: "4:3",
        image_size: "2K",
        image_urls: ["https://assets.example.com/a.png", "https://assets.example.com/b.png"],
    });
});

test("omits Nano Banana aspect_ratio for one auto-sized reference image", () => {
    assert.deepEqual(duomiImageRequestBody({ model: "gemini-3.1-flash-image-preview", prompt: "增强细节", size: "auto", quality: "high", referenceUrls: ["https://assets.example.com/a.png"] }), {
        model: "gemini-3.1-flash-image-preview",
        prompt: "增强细节",
        image_size: "4K",
        image_urls: ["https://assets.example.com/a.png"],
    });
});

test("keeps gpt-image-2 request bodies limited to documented fields", () => {
    assert.deepEqual(
        duomiImageRequestBody({
            model: "gpt-image-2",
            prompt: "海边灯塔",
            size: "1024x1024",
            quality: "high",
            referenceUrls: [],
            n: 2,
            response_format: "b64_json",
            output_format: "png",
        }),
        { model: "gpt-image-2", prompt: "海边灯塔", size: "1024x1024", quality: "high" },
    );
    assert.deepEqual(duomiImageRequestBody({ model: "gpt-image-2", prompt: "海边灯塔", size: "auto", quality: "auto", referenceUrls: [] }), {
        model: "gpt-image-2",
        prompt: "海边灯塔",
    });
});

test("reads model-specific task ids", () => {
    assert.equal(duomiTaskIdFromPayload("gpt-image-2", { id: "openai-task", data: { task_id: "wrong" } }), "openai-task");
    assert.equal(duomiTaskIdFromPayload("gemini-2.5-flash-image", { id: "wrong", data: { task_id: "nano-task" } }), "nano-task");
    assert.equal(duomiTaskIdFromPayload("gpt-image-2", null), "");
});

test("normalizes completed, failed, and pending task statuses", () => {
    for (const status of ["succeeded", "completed", "success", "done"]) {
        assert.equal(duomiTaskStatusFromPayload("gpt-image-2", { state: status }), "completed");
        assert.equal(duomiTaskStatusFromPayload("gemini-2.5-flash-image", { data: { state: status.toUpperCase() } }), "completed");
    }
    for (const status of ["error", "failed", "cancelled", "canceled", "expired"]) {
        assert.equal(duomiTaskStatusFromPayload("gpt-image-2", { state: status }), "failed");
        assert.equal(duomiTaskStatusFromPayload("gemini-3-pro-image-preview", { data: { state: status.toUpperCase() } }), "failed");
    }
    assert.equal(duomiTaskStatusFromPayload("gpt-image-2", { state: "running" }), "pending");
    assert.equal(duomiTaskStatusFromPayload("gemini-2.5-flash-image", {}), "pending");
});

test("reads image URLs from model-specific response shapes", () => {
    assert.deepEqual(duomiImageUrlsFromPayload("gpt-image-2", { data: { images: [{ url: "https://cdn.example.com/gpt-a.png" }, {}, { url: "https://cdn.example.com/gpt-b.png" }] } }), [
        "https://cdn.example.com/gpt-a.png",
        "https://cdn.example.com/gpt-b.png",
    ]);
    assert.deepEqual(duomiImageUrlsFromPayload("gemini-2.5-flash-image", { data: { data: { images: [{ url: "https://cdn.example.com/nano.png" }] } } }), ["https://cdn.example.com/nano.png"]);
    assert.deepEqual(duomiImageUrlsFromPayload("gemini-2.5-flash-image", { data: { images: [{ url: "https://cdn.example.com/wrong-shape.png" }] } }), []);
});

test("prefers Nano task messages, then top-level messages, then error messages", () => {
    assert.equal(duomiTaskErrorMessage("gemini-2.5-flash-image", { data: { msg: "内容被拒绝" }, msg: "顶层错误", error: { message: "通用错误" } }), "内容被拒绝");
    assert.equal(duomiTaskErrorMessage("gemini-2.5-flash-image", { msg: "顶层错误", error: { message: "通用错误" } }), "顶层错误");
    assert.equal(duomiTaskErrorMessage("gpt-image-2", { data: { msg: "不应读取" }, error: { message: "余额不足" } }), "余额不足");
    assert.equal(duomiTaskErrorMessage("gpt-image-2", {}), "");
});

test("accepts one through ten public HTTP or HTTPS reference URLs", () => {
    const urls = ["https://assets.example.com/a.png", "http://8.8.8.8/b.png", "https://[2001:4860:4860::8888]/c.png", "https://[::ffff:8.8.4.4]/d.png"];
    assert.deepEqual(duomiReferenceUrls(urls), urls);
    assert.notEqual(duomiReferenceUrls(urls), urls);
    assert.deepEqual(duomiReferenceUrls(Array.from({ length: 10 }, (_, index) => `https://assets.example.com/${index}.png`)).length, 10);
});

test("rejects invalid, local, loopback, and private reference URLs", () => {
    for (const urls of [
        [],
        Array.from({ length: 11 }, (_, index) => `https://assets.example.com/${index}.png`),
        ["data:image/png;base64,abc"],
        ["blob:https://example.com/id"],
        ["ftp://assets.example.com/a.png"],
        ["http://localhost/a.png"],
        ["http://preview.localhost/a.png"],
        ["http://127.0.0.1/a.png"],
        ["http://0.1.2.3/a.png"],
        ["http://100.64.0.1/a.png"],
        ["http://100.127.255.255/a.png"],
        ["http://169.254.1.1/a.png"],
        ["http://[::1]/a.png"],
        ["http://[::]/a.png"],
        ["http://[fc00::1]/a.png"],
        ["http://[fdff::1]/a.png"],
        ["http://[fe80::1]/a.png"],
        ["http://[febf::1]/a.png"],
        ["http://[ff02::1]/a.png"],
        ["http://10.0.0.1/a.png"],
        ["http://172.16.0.1/a.png"],
        ["http://172.31.255.255/a.png"],
        ["http://192.168.1.1/a.png"],
        ["http://192.0.2.1/a.png"],
        ["http://198.18.0.1/a.png"],
        ["http://198.51.100.1/a.png"],
        ["http://203.0.113.1/a.png"],
        ["http://224.0.0.1/a.png"],
        ["http://239.255.255.255/a.png"],
        ["http://240.0.0.1/a.png"],
        ["http://255.255.255.255/a.png"],
        ["http://[::ffff:127.0.0.1]/a.png"],
        ["http://[::ffff:0.1.2.3]/a.png"],
        ["http://[::ffff:100.64.0.1]/a.png"],
        ["http://[::ffff:169.254.1.1]/a.png"],
        ["http://[::ffff:10.0.0.1]/a.png"],
        ["http://[::ffff:172.16.0.1]/a.png"],
        ["http://[::ffff:192.168.1.1]/a.png"],
        ["http://[::ffff:224.0.0.1]/a.png"],
        ["http://[::ffff:255.255.255.255]/a.png"],
        ["not a URL"],
    ]) {
        assert.throws(() => duomiReferenceUrls(urls), /公网图片 URL|1 至 10/);
    }
});
