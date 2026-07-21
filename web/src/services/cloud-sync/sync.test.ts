import { expect, test } from "bun:test";

import { restoreCloudProject, syncCloudProject } from "./sync";

test("云同步把画布保存为包含媒体清单的快照", async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: unknown;
    globalThis.fetch = async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return Response.json({ code: 0, data: { id: "p1", currentRevision: 1 }, msg: "ok" });
    };

    try {
        const project = {
            id: "p1",
            title: "测试画布",
            nodes: [],
            connections: [],
            chatSessions: [],
            activeChatId: null,
            backgroundMode: "lines",
            showImageInfo: false,
            viewport: { x: 0, y: 0, k: 1 },
            createdAt: "2026-07-20T00:00:00Z",
            updatedAt: "2026-07-20T00:00:00Z",
        } as never;

        await syncCloudProject(project, { revision: 0 }, "token", "https://api.test");

        expect(requestBody).toEqual({
            title: "测试画布",
            payload: { project, media: [] },
        });
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("恢复云端画布前校验并写入媒体", async () => {
    const project = { id: "p1", title: "远端画布" } as never;
    const restored: Array<{ key: string; text: string }> = [];
    const result = await restoreCloudProject(
        { id: "p1", title: "远端画布", currentRevision: 4, payload: { project, media: [{ storageKey: "image:one", sha256: "sha", mimeType: "image/png", bytes: 3 }] } },
        "token",
        "https://api.test",
        async (key, sha256) => {
            expect(key).toBe("image:one");
            expect(sha256).toBe("sha");
            return new Blob(["abc"], { type: "image/png" });
        },
        async (key, blob) => {
            restored.push({ key, text: await blob.text() });
        },
    );
    expect(result).toEqual({ project, revision: 4 });
    expect(restored).toEqual([{ key: "image:one", text: "abc" }]);
});
