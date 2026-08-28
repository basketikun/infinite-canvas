import { describe, expect, it } from "vitest";

import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import { buildSeedanceVideoPayload, isSeedanceModel } from "./video";

function seedanceConfig(overrides: Partial<AiConfig> = {}): AiConfig {
    return {
        ...structuredClone(defaultConfig),
        model: "doubao-seedance-2-5-260628",
        videoModel: "doubao-seedance-2-5-260628",
        size: "1280x720",
        vquality: "720",
        videoSeconds: "6",
        videoGenerateAudio: "true",
        videoWatermark: "false",
        ...overrides,
    };
}

describe("Seedance video requests", () => {
    it("recognizes deployed Seedance models", () => {
        expect(isSeedanceModel("doubao-seedance-2-5-260628")).toBe(true);
        expect(isSeedanceModel("sora-2")).toBe(false);
    });

    it("builds a text-to-video JSON request", () => {
        expect(buildSeedanceVideoPayload(seedanceConfig(), "slow camera pan")).toEqual({
            model: "doubao-seedance-2-5-260628",
            prompt: "slow camera pan",
            seconds: "6",
            metadata: {
                resolution: "720p",
                ratio: "16:9",
                generate_audio: true,
                watermark: false,
            },
        });
    });

    it("adds data URLs for image-to-video", () => {
        const payload = buildSeedanceVideoPayload(seedanceConfig({ size: "720x1280", videoGenerateAudio: "false", videoWatermark: "true" }), "animate", ["data:image/png;base64,AAA"]);
        expect(payload.images).toEqual(["data:image/png;base64,AAA"]);
        expect(payload.metadata).toEqual({
            resolution: "720p",
            ratio: "9:16",
            generate_audio: false,
            watermark: true,
        });
    });

    it("normalizes custom duration and square output", () => {
        const payload = buildSeedanceVideoPayload(seedanceConfig({ size: "1024x1024", videoSeconds: "99", vquality: "480p" }), "loop");
        expect(payload.seconds).toBe("20");
        expect(payload.metadata.resolution).toBe("480p");
        expect(payload.metadata.ratio).toBe("1:1");
    });
});
