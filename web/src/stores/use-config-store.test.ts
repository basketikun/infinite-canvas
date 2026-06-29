import { describe, expect, it } from "vitest";

import { createModelChannel, decodeChannelModel, defaultConfig, encodeChannelModel, modelOptionName, normalizeModelOptionValue, resolveModelRequestConfig, type AiConfig } from "./use-config-store";

describe("model channel helpers", () => {
    it("encodes and decodes channel model values", () => {
        const value = encodeChannelModel("default", "gpt-image-2");

        expect(value).toBe("default::gpt-image-2");
        expect(decodeChannelModel(value)).toEqual({ channelId: "default", model: "gpt-image-2" });
        expect(modelOptionName(value)).toBe("gpt-image-2");
    });

    it("normalizes raw model names to the first matching channel", () => {
        const channels = [createModelChannel({ id: "a", models: ["gpt-image-2"] }), createModelChannel({ id: "b", models: ["gpt-5.5"] })];

        expect(normalizeModelOptionValue("gpt-5.5", channels)).toBe("b::gpt-5.5");
    });

    it("resolves request config from the selected channel", () => {
        const config: AiConfig = {
            ...defaultConfig,
            channels: [createModelChannel({ id: "remote", baseUrl: "https://example.com", apiKey: "key", models: ["gpt-5.5"] })],
        };

        const resolved = resolveModelRequestConfig(config, "remote::gpt-5.5");

        expect(resolved.model).toBe("gpt-5.5");
        expect(resolved.baseUrl).toBe("https://example.com");
        expect(resolved.apiKey).toBe("key");
    });
});
