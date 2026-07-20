import { expect, test } from "bun:test";
import { saveCloudProject } from "./client";

test("保存云端项目携带会话和 If-Match 修订", async () => {
    await saveCloudProject("p1", 2, { title: "画布", payload: { nodes: [] } }, "token", "https://api.test", async (input, init) => {
        expect(input).toBe("https://api.test/api/v1/canvas/projects/p1");
        expect(new Headers(init?.headers).get("If-Match")).toBe("2");
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token");
        return Response.json({ code: 0, data: { id: "p1", currentRevision: 3 }, msg: "ok" });
    });
});
