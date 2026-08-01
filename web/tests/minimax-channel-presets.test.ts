import { describe, expect, test } from "bun:test";

import { buildApiUrl, createMiniMaxChannel, MINIMAX_CHANNEL_PRESETS, MINIMAX_REGIONS, MINIMAX_TEXT_MODELS } from "../src/stores/use-config-store";

describe("MiniMax channel presets", () => {
    for (const region of MINIMAX_REGIONS) {
        test(`creates the ${region} text channel`, () => {
            const preset = MINIMAX_CHANNEL_PRESETS[region];
            const channel = createMiniMaxChannel(region);

            expect(channel.name).toBe(preset.name);
            expect(channel.baseUrl).toBe(preset.baseUrl);
            expect(channel.apiFormat).toBe("openai");
            expect(channel.models).toEqual(MINIMAX_TEXT_MODELS.map((name) => ({ name, capability: "text" })));
            expect(buildApiUrl(channel.baseUrl, "/responses")).toBe(`${preset.baseUrl}/responses`);
        });
    }
});
