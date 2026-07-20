import { expect, test } from "bun:test";

import { login } from "./auth";

test("login posts credentials to the control plane", async () => {
    await expect(login({ username: "admin", password: "secret" }, "https://control-plane.example.test", async (input, init) => {
        expect(input).toBe("https://control-plane.example.test/api/auth/login");
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(JSON.stringify({ username: "admin", password: "secret" }));
        return Response.json({ code: 0, data: { token: "session", user: { id: "1" } }, msg: "" });
    })).resolves.toEqual({ token: "session", user: { id: "1" } });
});
