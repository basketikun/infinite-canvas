import { describe, expect, it } from "vitest";

import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import { buildSeedreamImagePayload, isSeedreamModel } from "./image";

function seedreamConfig(model = "doubao-seedream-5-0-pro-260628"): AiConfig {
    return {
        ...structuredClone(defaultConfig),
        model,
        imageModel: model,
        quality: "auto",
        size: "1:1",
        background: "",
    };
}

describe("Seedream image requests", () => {
    it("recognizes deployed Seedream models", () => {
        expect(isSeedreamModel("doubao-seedream-5-0-pro-260628")).toBe(true);
        expect(isSeedreamModel("gpt-image-2")).toBe(false);
    });

    it("builds a text-to-image payload without a reference field", () => {
        expect(buildSeedreamImagePayload(seedreamConfig(), "draw a red cube")).toEqual({
            model: "doubao-seedream-5-0-pro-260628",
            prompt: "draw a red cube",
            size: "1024x1024",
            response_format: "b64_json",
            output_format: "png",
        });
    });

    it("builds the JSON image field used by Seedream reference editing", () => {
        const payload = buildSeedreamImagePayload(seedreamConfig(), "keep the subject", ["data:image/png;base64,AAA", "data:image/png;base64,BBB"]);
        expect(payload.image).toEqual(["data:image/png;base64,AAA", "data:image/png;base64,BBB"]);
    });

    it("adds normalized bbox instructions for mask editing", () => {
        const payload = buildSeedreamImagePayload(seedreamConfig(), "replace with polished metal", ["data:image/png;base64,AAA"], [{ x1: 120, y1: 180, x2: 640, y2: 760 }]);
        expect(payload.prompt).toContain("图 1");
        expect(payload.prompt).toContain("<bbox>120 180 640 760</bbox>");
        expect(payload.prompt).toContain("区域外保持不变");
    });

    it("rejects mask editing on Seedream models without interactive editing", () => {
        expect(() => buildSeedreamImagePayload(seedreamConfig("doubao-seedream-4-5-251128"), "replace", ["data:image/png;base64,AAA"], [{ x1: 1, y1: 2, x2: 3, y2: 4 }])).toThrow();
    });
});
