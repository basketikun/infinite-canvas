import assert from "node:assert/strict";
import test from "node:test";

import * as videoProviderUtils from "../src/services/api/video-provider-utils.mjs";
import {
    isUnsupportedXaiVideoModel,
    isXaiVideoModel,
    videoCreatePathForModel,
    videoResultUrlFromPayload,
    videoTaskIdFromPayload,
    videoTaskStatusFromPayload,
    xaiVideoAspectRatioFromSize,
    xaiVideoDuration,
    xaiVideoResolution,
} from "../src/services/api/video-provider-utils.mjs";

test("selects the dedicated video model unless config.model is already a video model", () => {
    assert.equal(typeof videoProviderUtils.videoModelOptionValue, "function");
    assert.equal(videoProviderUtils.videoModelOptionValue({ model: "default::gpt-image-2", videoModel: "channel-1::grok-video-1.5" }, false), "channel-1::grok-video-1.5");
    assert.equal(videoProviderUtils.videoModelOptionValue({ model: "channel-2::seedance-2.0", videoModel: "channel-1::grok-video-1.5" }, true), "channel-2::seedance-2.0");
});

test("recognizes xAI video models without treating ordinary Grok text models as video generators", () => {
    assert.equal(isXaiVideoModel("grok-imagine-video"), true);
    assert.equal(isXaiVideoModel("grok-imagine-video-1.5"), true);
    assert.equal(isXaiVideoModel("grok-4.3"), false);
    assert.equal(isXaiVideoModel("grok-4"), false);
    assert.equal(isXaiVideoModel("grok-4-latest"), false);
});

test("flags Grok text models as unsupported for video generation", () => {
    assert.equal(isUnsupportedXaiVideoModel("grok-4.3"), true);
    assert.equal(isUnsupportedXaiVideoModel("grok-4-latest"), true);
    assert.equal(isUnsupportedXaiVideoModel("grok-imagine-video"), false);
    assert.equal(isUnsupportedXaiVideoModel("sora-2"), false);
});

test("uses xAI video generation creation path for Grok Imagine video", () => {
    assert.equal(videoCreatePathForModel("grok-imagine-video"), "/videos/generations");
    assert.equal(videoCreatePathForModel("grok-imagine-video-1.5"), "/videos/generations");
    assert.equal(videoCreatePathForModel("sora-2"), "/videos");
});

test("normalizes xAI video generation parameters", () => {
    assert.equal(xaiVideoDuration("12"), 12);
    assert.equal(xaiVideoDuration("20"), 15);
    assert.equal(xaiVideoResolution("480"), "480p");
    assert.equal(xaiVideoResolution("1080p"), "720p");
    assert.equal(xaiVideoAspectRatioFromSize("720x1280"), "9:16");
    assert.equal(xaiVideoAspectRatioFromSize("1024x1024"), "1:1");
    assert.equal(xaiVideoAspectRatioFromSize("auto"), "16:9");
});

test("reads task ids from OpenAI-style id and xAI-style request_id payloads", () => {
    assert.equal(videoTaskIdFromPayload({ id: "task-openai" }), "task-openai");
    assert.equal(videoTaskIdFromPayload({ request_id: "task-xai" }), "task-xai");
    assert.equal(videoTaskIdFromPayload({ data: { request_id: "task-nested" } }), "task-nested");
    assert.equal(videoTaskIdFromPayload({ task_id: "task-mux" }), "task-mux");
    assert.equal(videoTaskIdFromPayload({ data: { task_id: "task-mux-nested" } }), "task-mux-nested");
});

test("reads generated video urls from common provider response shapes", () => {
    assert.equal(videoResultUrlFromPayload({ url: "https://cdn.example.com/video.mp4" }), "https://cdn.example.com/video.mp4");
    assert.equal(videoResultUrlFromPayload({ content: { video_url: "https://cdn.example.com/content.mp4" } }), "https://cdn.example.com/content.mp4");
    assert.equal(videoResultUrlFromPayload({ data: [{ url: "https://cdn.example.com/data.mp4" }] }), "https://cdn.example.com/data.mp4");
    assert.equal(videoResultUrlFromPayload({ data: { data: { url: "https://cdn.example.com/mux.mp4" } } }), "https://cdn.example.com/mux.mp4");
});

test("normalizes MUX-style nested video task statuses", () => {
    assert.equal(videoTaskStatusFromPayload({ code: "success", data: { status: "SUCCESS" } }), "completed");
    assert.equal(videoTaskStatusFromPayload({ code: "success", data: { status: "RUNNING" } }), "pending");
    assert.equal(videoTaskStatusFromPayload({ code: "success", data: { status: "FAILED" } }), "failed");
});
