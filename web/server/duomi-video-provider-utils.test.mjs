import assert from "node:assert/strict";
import test from "node:test";

import {
    DUOMI_VIDEO_MODELS,
    DUOMI_VIDEO_MODEL_SUGGESTIONS,
    DUOMI_VIDEO_POLL_INTERVAL_MS,
    DUOMI_VIDEO_POLL_MAX_ATTEMPTS,
    duomiVideoCreatePath,
    duomiVideoRequestBody,
    duomiVideoTaskErrorMessage,
    duomiVideoTaskIdFromPayload,
    duomiVideoTaskPath,
    duomiVideoTaskStatusFromPayload,
    duomiVideoUrlsFromPayload,
    isDuomiVideoModel,
    mergeFetchedVideoModels,
    normalizeVideoApiFormat,
} from "../src/services/api/duomi-video-provider-utils.mjs";

test("exports only the documented Duomi video model suggestions", () => {
    assert.deepEqual(DUOMI_VIDEO_MODELS, ["grok-video-1.5"]);
    assert.deepEqual(DUOMI_VIDEO_MODEL_SUGGESTIONS, ["grok-video-1.5"]);
    assert.notEqual(DUOMI_VIDEO_MODEL_SUGGESTIONS, DUOMI_VIDEO_MODELS);
    assert.equal(DUOMI_VIDEO_POLL_INTERVAL_MS, 2500);
    assert.equal(DUOMI_VIDEO_POLL_MAX_ATTEMPTS, 120);
});

test("recognizes only exact trimmed Duomi video model names", () => {
    assert.equal(isDuomiVideoModel("grok-video-1.5"), true);
    assert.equal(isDuomiVideoModel("  grok-video-1.5  "), true);
    assert.equal(isDuomiVideoModel("grok-imagine-video"), false);
    assert.equal(isDuomiVideoModel("GROK-VIDEO-1.5"), false);
    assert.equal(isDuomiVideoModel(null), false);
});

test("normalizes only the exact duomi video API format", () => {
    assert.equal(normalizeVideoApiFormat("duomi"), "duomi");
    assert.equal(normalizeVideoApiFormat("standard"), "standard");
    assert.equal(normalizeVideoApiFormat(" duomi "), "standard");
    assert.equal(normalizeVideoApiFormat(undefined), "standard");
});

test("merges Duomi current, fetched, and suggested models in first-seen order", () => {
    assert.deepEqual(mergeFetchedVideoModels("duomi", [" current-model ", "grok-video-1.5", "current-model", ""], [" fetched-model ", "current-model", "fetched-model"]), ["current-model", "grok-video-1.5", "fetched-model"]);
});

test("returns unique trimmed fetched models for standard video channels", () => {
    assert.deepEqual(mergeFetchedVideoModels("standard", ["current-model"], [" fetched-model ", "fetched-model", "", " second-model "]), ["fetched-model", "second-model"]);
});

test("builds the documented creation and encoded task paths", () => {
    assert.equal(duomiVideoCreatePath(), "/v1/videos/generations");
    assert.equal(duomiVideoTaskPath("  id/with space  "), "/v1/videos/tasks/id%2Fwith%20space");
});

test("builds the exact Duomi video request shape", () => {
    assert.deepEqual(
        duomiVideoRequestBody({
            model: "  grok-video-1.5  ",
            prompt: "海边灯塔",
            size: "1280x720",
            seconds: "6",
            referenceUrls: [],
        }),
        {
            model: "grok-video-1.5",
            prompt: "海边灯塔",
            aspect_ratio: "16:9",
            duration: 6,
            quality: "720p",
            image_urls: [],
            oversea: false,
        },
    );
});

test("normalizes portrait size and duration to the supported UI range", () => {
    const request = {
        model: "grok-video-1.5",
        prompt: "竖屏镜头",
        size: "720x1280",
        referenceUrls: [],
    };

    assert.equal(duomiVideoRequestBody({ ...request, seconds: "1.9" }).duration, 1);
    assert.equal(duomiVideoRequestBody({ ...request, seconds: "25" }).duration, 20);
    assert.equal(duomiVideoRequestBody({ ...request, seconds: "0" }).duration, 6);
    assert.equal(duomiVideoRequestBody({ ...request, seconds: undefined }).duration, 6);
    assert.equal(duomiVideoRequestBody({ ...request, seconds: "-3" }).duration, 1);
    assert.equal(duomiVideoRequestBody({ ...request, seconds: "6" }).aspect_ratio, "9:16");
});

test("rejects video models outside the confirmed Duomi whitelist", () => {
    assert.throws(
        () =>
            duomiVideoRequestBody({
                model: "grok-imagine-video",
                prompt: "错误模型",
                size: "1280x720",
                seconds: "6",
                referenceUrls: [],
            }),
        /不是已确认的多米视频模型/,
    );
});

test("keeps every public reference URL without a count limit or truncation", () => {
    const referenceUrls = Array.from({ length: 12 }, (_, index) => `https://assets.example.com/${index}.png`);
    const body = duomiVideoRequestBody({
        model: "grok-video-1.5",
        prompt: "动起来",
        size: "720x1280",
        seconds: "20",
        referenceUrls,
    });

    assert.deepEqual(body.image_urls, referenceUrls);
    assert.notEqual(body.image_urls, referenceUrls);
    assert.equal(body.image_urls.length, 12);
});

test("accepts no references and rejects local references", () => {
    assert.deepEqual(
        duomiVideoRequestBody({
            model: "grok-video-1.5",
            prompt: "文生视频",
            size: "1280x720",
            seconds: "6",
            referenceUrls: [],
        }).image_urls,
        [],
    );
    assert.throws(
        () =>
            duomiVideoRequestBody({
                model: "grok-video-1.5",
                prompt: "本地图生视频",
                size: "1280x720",
                seconds: "6",
                referenceUrls: ["http://127.0.0.1/reference.png"],
            }),
        /多米 Grok 参考图仅支持公网图片 URL/,
    );
});

test("reads only valid top-level Duomi task ids", () => {
    assert.equal(duomiVideoTaskIdFromPayload({ id: "  task-1  ", data: { id: "wrong" } }), "task-1");
    assert.equal(duomiVideoTaskIdFromPayload({ id: 0 }), "0");
    assert.equal(duomiVideoTaskIdFromPayload({ id: 42 }), "42");
    assert.equal(duomiVideoTaskIdFromPayload({ data: { id: "nested" } }), "");
    assert.equal(duomiVideoTaskIdFromPayload({ id: {} }), "");
    assert.equal(duomiVideoTaskIdFromPayload({ id: Number.NaN }), "");
    assert.equal(duomiVideoTaskIdFromPayload({ id: Number.POSITIVE_INFINITY }), "");
    assert.equal(duomiVideoTaskIdFromPayload(null), "");
});

test("normalizes completed, failed, and unknown Duomi task statuses", () => {
    for (const status of ["succeeded", "completed", "success", "done"]) {
        assert.equal(duomiVideoTaskStatusFromPayload({ state: status.toUpperCase() }), "completed");
    }
    for (const status of ["failed", "error", "cancelled", "canceled", "expired"]) {
        assert.equal(duomiVideoTaskStatusFromPayload({ state: status.toUpperCase() }), "failed");
    }
    assert.equal(duomiVideoTaskStatusFromPayload({ state: "provider-new-running-state" }), "pending");
    assert.equal(duomiVideoTaskStatusFromPayload({}), "pending");
});

test("ignores undocumented status aliases outside top-level state", () => {
    assert.equal(duomiVideoTaskStatusFromPayload({ status: "succeeded" }), "pending");
    assert.equal(duomiVideoTaskStatusFromPayload({ data: { state: "succeeded" } }), "pending");
    assert.equal(duomiVideoTaskStatusFromPayload({ data: { status: "succeeded" } }), "pending");
    assert.equal(
        duomiVideoTaskStatusFromPayload({
            state: "provider-new-running-state",
            status: "succeeded",
            data: { state: "succeeded", status: "succeeded" },
        }),
        "pending",
    );
});

test("treats every explicit provider error message as a failed task", () => {
    assert.equal(duomiVideoTaskStatusFromPayload({ state: "running", message: "内容被拒绝" }), "failed");
    assert.equal(duomiVideoTaskStatusFromPayload({ state: "succeeded", data: { error: { message: "结果失效" } } }), "failed");
});

test("treats trimmed top-level and nested error strings as provider failures", () => {
    const topLevelError = { state: "running", error: "  quota exceeded  " };
    const nestedError = { state: "running", data: { error: "  content rejected  " } };

    assert.equal(duomiVideoTaskErrorMessage(topLevelError), "quota exceeded");
    assert.equal(duomiVideoTaskStatusFromPayload(topLevelError), "failed");
    assert.equal(duomiVideoTaskErrorMessage(nestedError), "content rejected");
    assert.equal(duomiVideoTaskStatusFromPayload(nestedError), "failed");
    assert.equal(duomiVideoTaskErrorMessage({ error: "   ", data: { error: "  " } }), "");
    assert.equal(duomiVideoTaskStatusFromPayload({ state: "running", error: "   ", data: { error: "  " } }), "pending");
});

test("extracts provider errors with deterministic top-level then data precedence", () => {
    const payload = {
        msg: "  top msg  ",
        message: "top message",
        error: { message: "top error" },
        data: {
            msg: "data msg",
            message: "data message",
            error: { message: "data error" },
        },
    };

    assert.equal(duomiVideoTaskErrorMessage(payload), "top msg");
    assert.equal(duomiVideoTaskErrorMessage({ ...payload, msg: "   " }), "top message");
    assert.equal(duomiVideoTaskErrorMessage({ ...payload, msg: null, message: "", error: { message: " top error " } }), "top error");
    assert.equal(duomiVideoTaskErrorMessage({ data: payload.data }), "data msg");
    assert.equal(duomiVideoTaskErrorMessage({ data: { ...payload.data, msg: "", message: " data message " } }), "data message");
    assert.equal(duomiVideoTaskErrorMessage({ data: { error: { message: " data error " } } }), "data error");
    assert.equal(duomiVideoTaskErrorMessage({}), "");
});

test("reads and trims only data.videos URL results", () => {
    assert.deepEqual(
        duomiVideoUrlsFromPayload({
            url: "https://cdn.example.com/wrong-top.mp4",
            data: {
                videos: [{ url: " https://cdn.example.com/a.mp4 " }, {}, null, "https://cdn.example.com/not-a-record.mp4", { url: "   " }, { url: "https://cdn.example.com/b.mp4" }],
                url: "https://cdn.example.com/wrong-data.mp4",
            },
        }),
        ["https://cdn.example.com/a.mp4", "https://cdn.example.com/b.mp4"],
    );
});

test("keeps only public HTTP or HTTPS video result URLs in provider order", () => {
    const signedUrl = "https://cdn.example.com/video.mp4?X-Amz-Signature=a%2Fb&response-content-type=video%2Fmp4";
    const publicIpv4Url = "http://8.8.8.8/video.mp4?token=public";
    const payload = {
        data: {
            videos: [
                { url: `  ${signedUrl}  ` },
                { url: "not a url" },
                { url: "javascript:alert(1)" },
                { url: "file:///C:/video.mp4" },
                { url: "http://localhost/video.mp4" },
                { url: "http://127.0.0.1/video.mp4" },
                { url: "http://10.0.0.1/video.mp4" },
                { url: "http://172.16.0.1/video.mp4" },
                { url: "http://192.168.0.1/video.mp4" },
                { url: "http://169.254.1.1/video.mp4" },
                { url: "http://203.0.113.1/video.mp4" },
                { url: "http://[::1]/video.mp4" },
                { url: "http://[fe80::1]/video.mp4" },
                { url: publicIpv4Url },
            ],
        },
    };

    assert.deepEqual(duomiVideoUrlsFromPayload(payload), [signedUrl, publicIpv4Url]);
});

test("returns empty results for unrelated or empty response shapes", () => {
    assert.deepEqual(duomiVideoUrlsFromPayload({ videos: [{ url: "https://cdn.example.com/top.mp4" }] }), []);
    assert.deepEqual(duomiVideoUrlsFromPayload({ data: [{ url: "https://cdn.example.com/array.mp4" }] }), []);
    assert.deepEqual(duomiVideoUrlsFromPayload({ data: { videos: [] } }), []);
    assert.deepEqual(duomiVideoUrlsFromPayload(null), []);
});
