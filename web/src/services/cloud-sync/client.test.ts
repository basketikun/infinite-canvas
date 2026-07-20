import { expect, test } from "bun:test";
import { downloadCloudMedia, saveCloudProject, uploadCloudMedia } from "./client";

test("保存云端项目携带会话和 If-Match 修订", async () => {
    await saveCloudProject("p1", 2, { title: "画布", payload: { nodes: [] } }, "token", "https://api.test", async (input, init) => {
        expect(input).toBe("https://api.test/api/v1/canvas/projects/p1");
        expect(new Headers(init?.headers).get("If-Match")).toBe("2");
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token");
        return Response.json({ code: 0, data: { id: "p1", currentRevision: 3 }, msg: "ok" });
    });
});

test("下载媒体校验服务端 SHA-256", async () => {
    const blob = await downloadCloudMedia("image:one", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "token", "https://api.test", async (input, init) => {
        expect(input).toBe("https://api.test/api/v1/canvas/media/image%3Aone");
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token");
        return new Response(new Blob(["abc"], { type: "image/png" }));
    });
    expect(await blob.text()).toBe("abc");
});

test("上传媒体使用 key 和文件表单字段", async () => {
    await uploadCloudMedia("image:one", new Blob(["abc"], { type: "image/png" }), "token", "https://api.test", async (input, init) => {
        expect(input).toBe("https://api.test/api/v1/canvas/media");
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token");
        const body = init?.body as FormData;
        expect(body.get("key")).toBe("image:one");
        return Response.json({ code: 0, data: { key: "image:one", sha256: "hash" }, msg: "ok" });
    });
});
