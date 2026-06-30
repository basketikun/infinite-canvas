import { describe, expect, it } from "vitest";

import { readAxiosApiError, readFetchApiError } from "./api-error";

describe("readFetchApiError", () => {
    it("reads json error messages", async () => {
        const response = new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 });

        await expect(readFetchApiError(response, "请求失败")).resolves.toBe("bad request");
    });

    it("falls back to status and text", async () => {
        const response = new Response("plain error", { status: 502 });

        await expect(readFetchApiError(response, "请求失败")).resolves.toBe("请求失败：502 plain error");
    });
});

describe("readAxiosApiError", () => {
    it("adds request context to axios response messages", () => {
        const error = {
            isAxiosError: true,
            message: "Request failed",
            response: { status: 400, data: { msg: "bad request" } },
        };

        expect(readAxiosApiError(error, "请求失败")).toBe("请求失败：bad request");
    });

    it("keeps friendly status messages", () => {
        const error = {
            isAxiosError: true,
            message: "",
            response: { status: 429, data: {} },
        };

        expect(readAxiosApiError(error, "请求失败")).toBe("请求被限流或额度不足，请稍后重试");
    });
});
