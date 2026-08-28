import { describe, expect, it } from "vitest";

import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import { buildOpenAiAudioPayload } from "./audio";

function audioConfig(overrides: Partial<AiConfig> = {}): AiConfig {
    return {
        ...structuredClone(defaultConfig),
        model: "volcengine-tts-1",
        audioModel: "volcengine-tts-1",
        audioVoice: "alloy",
        audioFormat: "mp3",
        audioSpeed: "1",
        audioInstructions: "",
        ...overrides,
    };
}

describe("OpenAI-compatible audio requests", () => {
    it("builds the payload expected by the New API speech route", () => {
        expect(buildOpenAiAudioPayload(audioConfig(), "volcengine-tts-1", "你好，世界")).toEqual({
            model: "volcengine-tts-1",
            input: "你好，世界",
            voice: "alloy",
            response_format: "mp3",
            speed: 1,
        });
    });

    it("normalizes speed and includes optional instructions", () => {
        expect(buildOpenAiAudioPayload(audioConfig({ audioSpeed: "1.5", audioFormat: "wav", audioInstructions: "自然、温暖" }), "volcengine-tts-1", "测试")).toEqual({
            model: "volcengine-tts-1",
            input: "测试",
            voice: "alloy",
            response_format: "wav",
            speed: 1.5,
            instructions: "自然、温暖",
        });
    });
});
