import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("../src/i18n", () => ({ default: { t: (key: string) => key } }));
const { buildApiUrl, useConfigStore } = await import("../src/stores/use-config-store");

afterEach(() => {
    useConfigStore.setState((state) => ({
        config: { ...state.config, proxyEnabled: false },
    }));
});

describe("buildApiUrl", () => {
    test("preserves explicit numeric versions and normalizes surrounding whitespace", () => {
        useConfigStore.setState((state) => ({
            config: { ...state.config, proxyEnabled: false },
        }));
        for (const base of [
            "https://ark.cn-beijing.volces.com/api/v3",
            " https://example.com/v2/// ",
            "https://example.com/V1",
        ]) {
            expect(buildApiUrl(base, "/chat/completions")).toBe(
                base.trim().replace(/\/+$/, "") + "/chat/completions",
            );
        }
    });

    test("keeps the default version for bare and unversioned bases", () => {
        useConfigStore.setState((state) => ({
            config: { ...state.config, proxyEnabled: false },
        }));
        for (const base of ["https://api.openai.com", "https://example.com/api"]) {
            expect(buildApiUrl(base, "/models")).toBe(base + "/v1/models");
        }
        expect(buildApiUrl("https://api.openai.com/v1", "/models")).toBe(
            "https://api.openai.com/v1/models",
        );
    });

    test("wraps versioned endpoints with the local proxy", () => {
        useConfigStore.setState((state) => ({
            config: { ...state.config, proxyEnabled: true, proxyUrl: "http://127.0.0.1:23210" },
        }));
        expect(buildApiUrl("https://ark.cn-beijing.volces.com/api/v3", "/models")).toBe(
            "http://127.0.0.1:23210/https://ark.cn-beijing.volces.com/api/v3/models",
        );
    });
});
