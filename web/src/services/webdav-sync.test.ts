import { afterEach, expect, test } from "bun:test";

import { uploadWebdavFile } from "./webdav-sync";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
});

test("WebDAV 上传保持独立的目录创建、Basic Auth 和 PUT 请求", async () => {
    const requests: Array<{ url: string; method: string; authorization: string | null }> = [];
    globalThis.window = { setTimeout, clearTimeout } as never;
    globalThis.fetch = async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({ url: String(input), method: init?.method || "GET", authorization: headers.get("Authorization") });
        return new Response(null, { status: 201 });
    };

    await uploadWebdavFile(
        { url: "https://dav.example.test/root/", username: "用户", password: "密码", directory: "infinite-canvas", lastSyncedAt: "" },
        "canvas/files/item.json",
        new Blob(["{}"], { type: "application/json" }),
        "application/json",
    );

    expect(requests.map((item) => [item.method, item.url])).toEqual([
        ["MKCOL", "https://dav.example.test/root/infinite-canvas"],
        ["MKCOL", "https://dav.example.test/root/infinite-canvas"],
        ["MKCOL", "https://dav.example.test/root/infinite-canvas/canvas"],
        ["MKCOL", "https://dav.example.test/root/infinite-canvas/canvas/files"],
        ["PUT", "https://dav.example.test/root/infinite-canvas/canvas/files/item.json"],
    ]);
    expect(requests.every((item) => item.authorization === "Basic 55So5oi3OuWvhueggQ==")).toBeTrue();
});
