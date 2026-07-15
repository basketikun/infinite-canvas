import assert from "node:assert/strict";
import test from "node:test";

import { networkFailureMessage } from "../src/services/api/network-error.ts";

test("网络失败会提示 CORS 和后端渠道", () => {
    const message = networkFailureMessage({ fallback: "读取模型失败", code: "ERR_NETWORK", requestUrl: "https://api.example.com/v1/models", pageProtocol: "https:" });
    assert.match(message, /CORS\/OPTIONS/);
    assert.match(message, /后端渠道/);
});

test("HTTPS 页面直连 HTTP 接口会提示混合内容限制", () => {
    const message = networkFailureMessage({ fallback: "请求失败", code: "ERR_NETWORK", requestUrl: "http://api.example.com/v1/images/generations", pageProtocol: "https:" });
    assert.match(message, /HTTPS/);
    assert.match(message, /HTTP 接口/);
});

test("超时与主动取消会返回对应提示", () => {
    assert.match(networkFailureMessage({ fallback: "视频生成失败", code: "ETIMEDOUT" }), /请求超时/);
    assert.equal(networkFailureMessage({ fallback: "请求失败", code: "ERR_CANCELED" }), "请求已取消");
});
