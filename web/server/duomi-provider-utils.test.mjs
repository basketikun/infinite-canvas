import assert from "node:assert/strict";
import test from "node:test";

import { duomiPublicReferenceUrls, duomiRequestHeaders, duomiRequestUrl, isDuomiRequestTimeout } from "../src/services/api/duomi-provider-utils.mjs";

test("builds direct and proxy requests with raw authorization", () => {
    assert.equal(duomiRequestUrl("https://duomiapi.com/v1/", "/v1/videos/generations", false, ""), "https://duomiapi.com/v1/videos/generations");
    assert.equal(duomiRequestUrl("https://duomiapi.com/v1/", "/v1/videos/generations", true, "/api/ai-proxy/v1/videos/generations"), "/api/ai-proxy/v1/videos/generations");
    assert.deepEqual(duomiRequestHeaders("https://duomiapi.com/v1", "secret", true, { "x-existing": "kept" }), {
        "x-existing": "kept",
        Authorization: "secret",
        "Content-Type": "application/json",
        "x-ai-proxy-target-base-url": "https://duomiapi.com",
    });
});

test("accepts an empty reference list and preserves public URL order", () => {
    assert.deepEqual(duomiPublicReferenceUrls([], { min: 0, errorMessage: "多米 Grok 参考图仅支持公网图片 URL" }), []);

    const urls = ["https://assets.example.com/a.png", "http://cdn.example.org/b.jpg", "http://8.8.8.8/c.png", "https://[2001:4860:4860::8888]/d.png", "https://[::ffff:8.8.4.4]/e.png"];
    const result = duomiPublicReferenceUrls(urls, { min: 0 });

    assert.deepEqual(result, urls);
    assert.notEqual(result, urls);
});

test("allows IANA globally reachable IPv6 exceptions", () => {
    const urls = [
        "https://[2001:1::1]/a.png",
        "https://[2001:1::2]/b.png",
        "https://[2001:1::3]/c.png",
        "https://[2001:3::1]/d.png",
        "https://[2001:4:112::1]/e.png",
        "https://[2001:2f:ffff::1]/f.png",
        "https://[2001:3f:ffff::1]/g.png",
        "https://[64:ff9b::1]/h.png",
        "https://[2620:4f:8000::1]/i.png",
    ];

    assert.deepEqual(duomiPublicReferenceUrls(urls), urls);
});

test("rejects invalid and non-public reference URLs", () => {
    for (const url of [
        "data:image/png;base64,abc",
        "blob:https://example.com/id",
        "ftp://assets.example.com/a.png",
        "http://localhost/a.png",
        "http://preview.localhost/a.png",
        "http://intranet/a.png",
        "http://printer.local/a.png",
        "http://printer.local./a.png",
        "http://router.localdomain/a.png",
        "http://device.home.arpa/a.png",
        "http://reserved.test/a.png",
        "http://reserved.invalid/a.png",
        "http://127.0.0.1/a.png",
        "http://0.1.2.3/a.png",
        "http://100.64.0.1/a.png",
        "http://100.127.255.255/a.png",
        "http://169.254.1.1/a.png",
        "http://10.0.0.1/a.png",
        "http://172.16.0.1/a.png",
        "http://172.31.255.255/a.png",
        "http://192.168.1.1/a.png",
        "http://192.0.0.1/a.png",
        "http://192.0.0.170/a.png",
        "http://192.0.2.1/a.png",
        "http://198.18.0.1/a.png",
        "http://198.51.100.1/a.png",
        "http://203.0.113.1/a.png",
        "http://224.0.0.1/a.png",
        "http://239.255.255.255/a.png",
        "http://240.0.0.1/a.png",
        "http://255.255.255.255/a.png",
        "http://[::1]/a.png",
        "http://[::]/a.png",
        "http://[fc00::1]/a.png",
        "http://[fdff::1]/a.png",
        "http://[fe80::1]/a.png",
        "http://[febf::1]/a.png",
        "http://[ff02::1]/a.png",
        "http://[100::1]/a.png",
        "http://[100::ffff:ffff:ffff:ffff]/a.png",
        "http://[100:0:0:1::1]/a.png",
        "http://[100:0:0:1:ffff:ffff:ffff:ffff]/a.png",
        "http://[5f00::1]/a.png",
        "http://[5f00:ffff::1]/a.png",
        "http://[64:ff9b:1::1]/a.png",
        "http://[2001::1]/a.png",
        "http://[2001:1::4]/a.png",
        "http://[2001:2::1]/a.png",
        "http://[2001:4:113::1]/a.png",
        "http://[2001:40::1]/a.png",
        "http://[2001:db8::1]/a.png",
        "http://[2002::1]/a.png",
        "http://[3fff::1]/a.png",
        "http://[::ffff:127.0.0.1]/a.png",
        "http://[::ffff:0.1.2.3]/a.png",
        "http://[::ffff:100.64.0.1]/a.png",
        "http://[::ffff:169.254.1.1]/a.png",
        "http://[::ffff:10.0.0.1]/a.png",
        "http://[::ffff:172.16.0.1]/a.png",
        "http://[::ffff:192.168.1.1]/a.png",
        "http://[::ffff:224.0.0.1]/a.png",
        "http://[::ffff:255.255.255.255]/a.png",
        "not a URL",
    ]) {
        assert.throws(() => duomiPublicReferenceUrls([url], { min: 0 }), /参考图必须是公网图片 URL/);
    }
});

test("enforces configured reference URL counts", () => {
    assert.throws(() => duomiPublicReferenceUrls([], { min: 1, errorMessage: "至少一张公网图片 URL" }), /至少一张公网图片 URL/);
    assert.throws(() => duomiPublicReferenceUrls(["https://assets.example.com/a.png", "https://assets.example.com/b.png"], { max: 1 }), /参考图必须是公网图片 URL/);
});

test("recognizes request timeout errors", () => {
    assert.equal(isDuomiRequestTimeout({ code: "ECONNABORTED" }), true);
    assert.equal(isDuomiRequestTimeout({ code: "ETIMEDOUT" }), true);
    assert.equal(isDuomiRequestTimeout({ code: "ERR_CANCELED" }), false);
    assert.equal(isDuomiRequestTimeout(new Error("network")), false);
    assert.equal(isDuomiRequestTimeout(null), false);
});
