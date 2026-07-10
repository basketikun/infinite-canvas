import assert from "node:assert/strict";
import test from "node:test";

import { AI_PROXY_TARGET_HEADER, createForwardHeaders, resolveProxyTargetUrl, validateTargetUrl } from "./ai-proxy.mjs";

test("resolveProxyTargetUrl preserves target base path and query string", () => {
    const target = resolveProxyTargetUrl("https://relay.example.com/v1", "/api/ai-proxy/models", "/api/ai-proxy", "limit=20");

    assert.equal(target.toString(), "https://relay.example.com/v1/models?limit=20");
});

test("resolveProxyTargetUrl keeps provider-specific API bases such as Seedance plan API", () => {
    const target = resolveProxyTargetUrl("https://ark.cn-beijing.volces.com/api/plan/v3", "/api/ai-proxy/contents/generations/tasks/task-1", "/api/ai-proxy", "");

    assert.equal(target.toString(), "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks/task-1");
});

test("validateTargetUrl rejects private and localhost targets unless explicitly allowed", async () => {
    await assert.rejects(() => validateTargetUrl(new URL("http://127.0.0.1:3000/v1/models"), { allowLocal: false }), /private|local/i);
    await assert.doesNotReject(() => validateTargetUrl(new URL("http://127.0.0.1:3000/v1/models"), { allowLocal: true }));
});

test("validateTargetUrl only accepts http and https targets", async () => {
    await assert.rejects(() => validateTargetUrl(new URL("file:///tmp/models"), { allowLocal: true }), /protocol/i);
});

test("createForwardHeaders drops browser and hop-by-hop headers while preserving API headers", () => {
    const headers = createForwardHeaders({
        host: "localhost:3000",
        origin: "http://localhost:3000",
        referer: "http://localhost:3000/",
        connection: "keep-alive",
        "content-length": "10",
        [AI_PROXY_TARGET_HEADER]: "https://relay.example.com/v1",
        authorization: "Bearer test-key",
        accept: "application/json",
        "content-type": "application/json",
        "x-custom-provider-header": "kept",
    });

    assert.deepEqual(headers, {
        authorization: "Bearer test-key",
        accept: "application/json",
        "content-type": "application/json",
        "x-custom-provider-header": "kept",
    });
});
