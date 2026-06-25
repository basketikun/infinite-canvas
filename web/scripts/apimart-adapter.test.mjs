import assert from "node:assert/strict";

import { apimartImageUploadPath, directApimartReferenceImageUrl } from "../src/services/apimart-reference-url.ts";

const videoModelNames = ["seedance", "happyhorse", "video", "sora", "veo", "kling", "wan", "hailuo"];
const isApimartImageModel = (model) => ["gemini-3-pro-image", "gemini-3-pro-image-preview"].includes(model.toLowerCase());
const isHappyHorseModel = (model) => ["happyhorse-1.0", "happyhorse-1.1"].includes(model.toLowerCase());
const isApimartBaseUrl = (baseUrl) => baseUrl.toLowerCase().includes("api.apimart.ai") || baseUrl.toLowerCase().includes("api.apib.ai");
const isApimartSeedance2Config = (baseUrl, model) => isApimartBaseUrl(baseUrl) && ["doubao-seedance-2.0", "doubao-seedance-2.0-fast", "doubao-seedance-2.0-face", "doubao-seedance-2.0-fast-face"].includes(model.toLowerCase());
const normalizeApimartImageResolution = (value) => {
    const normalized = value.trim().toLowerCase();
    if (normalized === "high" || normalized === "4k") return "4K";
    if (normalized === "medium" || normalized === "2k") return "2K";
    return "1K";
};
const normalizeHappyHorseResolution = (value) => {
    const normalized = value.trim().toLowerCase().replace(/p$/, "");
    return normalized === "1080" || normalized === "high" ? "1080P" : "720P";
};
const normalizeHappyHorseDuration = (value) => Math.max(3, Math.min(15, Math.floor(Number(value) || 5)));
const normalizeRatio = (value, fallback) => {
    const normalized = value.trim();
    if (!normalized || normalized === "auto" || normalized === "adaptive") return fallback;
    if (/^\d+:\d+$/.test(normalized)) return normalized;
    const match = normalized.match(/^(\d+)x(\d+)$/);
    if (!match) return fallback;
    const ratio = Number(match[1]) / Number(match[2]);
    return [
        ["16:9", 16 / 9],
        ["9:16", 9 / 16],
        ["1:1", 1],
        ["4:3", 4 / 3],
        ["3:4", 3 / 4],
        ["21:9", 21 / 9],
    ].reduce((best, item) => (Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best))[0];
};
const isSuccessCode = (code) => code === undefined || code === 0 || code === 200;
const extractTaskId = (payload) => {
    const data = payload?.data;
    const first = Array.isArray(data) ? data[0] : data;
    return first?.task_id || first?.id || payload?.task_id || payload?.id || "";
};
const extractUrls = (payload, key) => (payload.data.result[key] || []).flatMap((item) => (Array.isArray(item.url) ? item.url : [item.url])).filter(Boolean);

assert.equal(isApimartImageModel("gemini-3-pro-image-preview"), true);
assert.equal(isApimartImageModel("gemini-3-pro-image"), true);
assert.equal(isHappyHorseModel("happyhorse-1.0"), true);
assert.equal(isHappyHorseModel("happyhorse-1.1"), true);
assert.equal(isApimartSeedance2Config("https://api.apimart.ai", "doubao-seedance-2.0"), true);
assert.equal(isApimartSeedance2Config("https://ark.cn-beijing.volces.com/api/plan/v3", "doubao-seedance-2.0"), false);
assert.equal(videoModelNames.some((name) => "happyhorse-1.1".includes(name)), true);

assert.equal(normalizeApimartImageResolution("auto"), "1K");
assert.equal(normalizeApimartImageResolution("medium"), "2K");
assert.equal(normalizeApimartImageResolution("high"), "4K");
assert.equal(normalizeRatio("3840x2160", "1:1"), "16:9");
assert.equal(normalizeRatio("1152x2048", "1:1"), "9:16");
assert.equal(normalizeRatio("auto", "1:1"), "1:1");

assert.equal(normalizeHappyHorseResolution("low"), "720P");
assert.equal(normalizeHappyHorseResolution("1080"), "1080P");
assert.equal(normalizeHappyHorseResolution("high"), "1080P");
assert.equal(normalizeHappyHorseDuration("1"), 3);
assert.equal(normalizeHappyHorseDuration("20"), 15);
assert.equal(normalizeRatio("1280x720", "16:9"), "16:9");
assert.equal(directApimartReferenceImageUrl({ sourceUrl: "https://cdn.example.com/image.png", url: "blob:http://localhost/image" }), "https://cdn.example.com/image.png");
assert.equal(directApimartReferenceImageUrl({ url: "asset://private/image" }), "asset://private/image");
assert.equal(directApimartReferenceImageUrl({ dataUrl: "data:image/png;base64,abc" }), "");
assert.equal(apimartImageUploadPath, "/uploads/images");
assert.equal(isSuccessCode(0), true);
assert.equal(isSuccessCode(200), true);
assert.equal(isSuccessCode(400), false);

assert.equal(extractTaskId({ data: [{ task_id: "task_array" }] }), "task_array");
assert.equal(extractTaskId({ data: { task_id: "task_object" } }), "task_object");
assert.equal(extractTaskId({ task_id: "task_root" }), "task_root");
assert.equal(extractTaskId({ id: "task_id" }), "task_id");

const completed = {
    data: {
        status: "completed",
        result: {
            images: [{ url: ["https://example.com/a.png"] }, { url: "https://example.com/b.png" }],
            videos: [{ url: ["https://example.com/a.mp4"] }, { url: "https://example.com/b.mp4" }],
        },
    },
};
assert.deepEqual(extractUrls(completed, "images"), ["https://example.com/a.png", "https://example.com/b.png"]);
assert.deepEqual(extractUrls(completed, "videos"), ["https://example.com/a.mp4", "https://example.com/b.mp4"]);
