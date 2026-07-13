import assert from "node:assert/strict";
import test from "node:test";

import { buildDuomiVideoHttpRequest, duomiVideoRequestFromInputs, translateDuomiVideoRequestError, withDuomiVideoTaskModel } from "../src/services/api/duomi-video-http.mjs";

test("builds direct request metadata with raw authorization and remaining timeout", () => {
    assert.deepEqual(
        buildDuomiVideoHttpRequest({
            baseUrl: "https://duomiapi.com/v1/",
            apiKey: "secret",
            useProxy: false,
            path: "/v1/videos/generations",
            deadlineAt: 301000,
            now: () => 101000,
            proxyUrl: "",
            proxyHeaders: {},
            proxyTargetHeader: "x-ai-proxy-target-base-url",
        }),
        {
            url: "https://duomiapi.com/v1/videos/generations",
            headers: { Authorization: "secret", "Content-Type": "application/json" },
            timeout: 200000,
        },
    );
});

test("builds proxy request metadata with the original target base", () => {
    assert.deepEqual(
        buildDuomiVideoHttpRequest({
            baseUrl: "https://duomiapi.com/v1/",
            apiKey: "secret",
            useProxy: true,
            path: "/v1/videos/tasks/task-1",
            deadlineAt: 301000,
            now: () => 1000,
            proxyUrl: "/api/ai-proxy/v1/videos/tasks/task-1",
            proxyHeaders: { "x-ai-proxy-target-base-url": "https://duomiapi.com/v1" },
            proxyTargetHeader: "x-ai-proxy-target-base-url",
        }),
        {
            url: "/api/ai-proxy/v1/videos/tasks/task-1",
            headers: {
                Authorization: "secret",
                "Content-Type": "application/json",
                "x-ai-proxy-target-base-url": "https://duomiapi.com",
            },
            timeout: 300000,
        },
    );
});

test("composes a decoded model request and restores the encoded task model", () => {
    const encodedModel = "channel-1::grok-video-1.5";
    const request = duomiVideoRequestFromInputs({
        modelName: "grok-video-1.5",
        prompt: "海边灯塔",
        references: [{ dataUrl: "data:image/png;base64,AAAA", url: "https://assets.example.com/reference.png" }, { dataUrl: "data:image/png;base64,BBBB" }],
        size: "1280x720",
        seconds: "6",
    });

    assert.deepEqual(request, {
        model: "grok-video-1.5",
        prompt: "海边灯塔",
        size: "1280x720",
        seconds: "6",
        referenceUrls: ["https://assets.example.com/reference.png", "data:image/png;base64,BBBB"],
    });
    assert.deepEqual(withDuomiVideoTaskModel({ id: "task-1", provider: "duomi", model: "grok-video-1.5", deadlineAt: 301000 }, encodedModel), {
        id: "task-1",
        provider: "duomi",
        model: encodedModel,
        deadlineAt: 301000,
    });
});

test("translates authentication and rate-limit responses with provider detail", () => {
    assert.equal(httpError(401, { message: "余额不足" }).message, "多米视频鉴权失败，请检查 API Key、账户余额或模型权限：余额不足");
    assert.equal(httpError(403, { message: "多米视频鉴权失败，请检查 API Key、账户余额或模型权限" }).message, "多米视频鉴权失败，请检查 API Key、账户余额或模型权限");
    assert.equal(httpError(429, { error: { message: "quota exhausted" } }).message, "多米视频请求被限流或额度不足，请稍后重试：quota exhausted");
});

test("uses provider messages before status-aware generic fallbacks", () => {
    assert.equal(httpError(500, { msg: "provider unavailable" }).message, "provider unavailable");
    assert.equal(httpError(404, {}).message, "多米视频生成失败（HTTP 404）");
    assert.equal(httpError(500, undefined).message, "多米视频生成失败（HTTP 500）");
});

test("translates timeouts and cancellation to stable errors", () => {
    assert.equal(translateDuomiVideoRequestError({ code: "ECONNABORTED" }).message, "多米视频生成超时，请稍后重试");

    const cancelled = translateDuomiVideoRequestError(new Error("canceled"), { isCancellation: true });
    assert.equal(cancelled.name, "AbortError");
    assert.equal(cancelled.message, "Aborted");

    const controller = new AbortController();
    controller.abort();
    const aborted = translateDuomiVideoRequestError(new Error("network"), { signal: controller.signal, isHttpError: true });
    assert.equal(aborted.name, "AbortError");
    assert.equal(aborted.message, "Aborted");

    const lifecycleAbort = translateDuomiVideoRequestError(new DOMException("custom message", "AbortError"));
    assert.equal(lifecycleAbort.name, "AbortError");
    assert.equal(lifecycleAbort.message, "Aborted");
});

test("preserves lifecycle protocol errors unchanged", () => {
    const protocolError = new Error("多米视频协议错误：任务创建响应缺少任务 ID");
    assert.equal(translateDuomiVideoRequestError(protocolError), protocolError);
});

function httpError(status, data) {
    return translateDuomiVideoRequestError(
        { response: { status, data } },
        {
            isHttpError: true,
        },
    );
}
