import { expect, test } from "bun:test";

import { toServerChannel } from "./settings";

test("toServerChannel maps public models without a provider key", () => {
    const channel = toServerChannel({ modelChannel: { availableModels: ["gpt-5.5"], defaultModel: "gpt-5.5" } }, "https://control-plane.example.test");

    expect(channel.apiKey).toBe("");
    expect(channel.baseUrl).toBe("https://control-plane.example.test");
    expect(channel.models[0].name).toBe("gpt-5.5");
});
