import { describe, expect, test } from "bun:test";

import { AI_PROXY_TARGET_HEADER, buildAiProxyHeaders, buildApiTargetBaseUrl, buildApiUrl } from "../src/stores/use-config-store";

describe("API URL helpers", () => {
    test("keeps normal OpenAI-compatible requests on v1 by default", () => {
        expect(buildApiTargetBaseUrl("https://relay.example.com/token-api")).toBe("https://relay.example.com/token-api/v1");
        expect(buildApiUrl("https://relay.example.com/token-api", "/models")).toBe("https://relay.example.com/token-api/v1/models");
    });

    test("builds Seedance/MUX task requests against v3-compatible relay bases", () => {
        expect(buildApiTargetBaseUrl("https://relay.example.com/token-api", "v3")).toBe("https://relay.example.com/token-api/v3");
        expect(buildApiTargetBaseUrl("https://relay.example.com/token-api/v1", "v3")).toBe("https://relay.example.com/token-api/v3");
        expect(buildApiUrl("https://relay.example.com/token-api", "/contents/generations/tasks", false, "v3")).toBe("https://relay.example.com/token-api/v3/contents/generations/tasks");
        expect(buildAiProxyHeaders({ baseUrl: "https://relay.example.com/token-api/v1", apiFormat: "openai", useProxy: true }, "v3")[AI_PROXY_TARGET_HEADER]).toBe("https://relay.example.com/token-api/v3");
    });

    test("preserves provider-specific v3 API bases", () => {
        expect(buildApiTargetBaseUrl("https://ark.cn-beijing.volces.com/api/plan/v3", "v3")).toBe("https://ark.cn-beijing.volces.com/api/plan/v3");
        expect(buildApiTargetBaseUrl("https://relay.example.com/api/v3", "v3")).toBe("https://relay.example.com/api/v3");
    });
});
