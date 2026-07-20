import { expect, test } from "bun:test";

import { requestControlPlane } from "./client";

test("requestControlPlane adds bearer token and unwraps successful data", async () => {
    let request: Request | undefined;
    const result = await requestControlPlane<{ id: string }>("/api/auth/me", { baseUrl: "https://control-plane.example.test", token: "session-token" }, async (input, init) => {
        request = new Request(input, init);
        return Response.json({ code: 0, data: { id: "user-1" }, msg: "" });
    });

    expect(result).toEqual({ id: "user-1" });
    expect(request?.headers.get("Authorization")).toBe("Bearer session-token");
});

test("requestControlPlane exposes API error messages", async () => {
    await expect(requestControlPlane("/api/auth/me", { baseUrl: "https://control-plane.example.test" }, async () => Response.json({ code: 1, data: null, msg: "登录已过期" }))).rejects.toThrow("登录已过期");
});
