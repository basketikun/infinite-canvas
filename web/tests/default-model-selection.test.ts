import { afterAll, expect, test } from "bun:test";
import type { AiConfig, ModelChannel } from "../src/stores/use-config-store";

// Config and i18n use browser storage during module initialization.
const values = new Map<string, string>();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    },
});
afterAll(() => {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
});

const { defaultConfig, pickDefaultModel, upsertChannelCredentials } = await import("../src/stores/use-config-store");

const builtIn: ModelChannel = {
    id: "default",
    name: "Default",
    baseUrl: "https://api.openai.com",
    apiKey: "",
    apiFormat: "openai",
    models: [
        { name: "gpt-image-2", capability: "image" },
        { name: "sora-2", capability: "video" },
    ],
};
const gateway = (apiKey: string): ModelChannel => ({
    id: "gateway",
    name: "Gateway",
    baseUrl: "https://gateway.example.com",
    apiKey,
    apiFormat: "openai",
    models: [
        { name: "image-x", capability: "image" },
        { name: "image-y", capability: "image" },
    ],
});
const configWith = (channels: ModelChannel[], imageModel = "default::gpt-image-2"): AiConfig => ({ ...defaultConfig, channels, imageModel });

test("a default on a channel without an API key moves to the first model of a configured channel", () => {
    const config = configWith([builtIn, gateway("gw-key")]);
    expect(pickDefaultModel(config, "image", config.imageModel)).toBe("gateway::image-x");
});

test("a usable default is kept even when another configured channel exists", () => {
    const config = configWith([{ ...builtIn, apiKey: "openai-key" }, gateway("gw-key")]);
    expect(pickDefaultModel(config, "image", config.imageModel)).toBe("default::gpt-image-2");
});

test("an explicitly chosen usable model on the second channel is kept", () => {
    const config = configWith([builtIn, gateway("gw-key")], "gateway::image-y");
    expect(pickDefaultModel(config, "image", config.imageModel)).toBe("gateway::image-y");
});

test("with no configured channel the current default is unchanged", () => {
    const config = configWith([builtIn, gateway("")]);
    expect(pickDefaultModel(config, "image", config.imageModel)).toBe("default::gpt-image-2");
});

test("only models of the requested capability are considered", () => {
    const config = configWith([builtIn, gateway("gw-key")]);
    // The gateway offers no video model, so the video default stays on the built-in channel.
    expect(pickDefaultModel(config, "video", "default::sora-2")).toBe("default::sora-2");
});

test("importing ?baseUrl= and then adding a key and models makes the imported channel the default", () => {
    const start = configWith([builtIn]);
    const imported = upsertChannelCredentials(start, { baseUrl: "https://gateway.example.com" });
    expect(imported.status).toBe("created");
    // The user then pastes the key and selects models in the channel editor.
    const channels = imported.config.channels.map((channel) => (channel.id === "default" ? channel : { ...channel, apiKey: "gw-key", models: [{ name: "image-x", capability: "image" as const }] }));
    const importedId = channels.find((channel) => channel.id !== "default")!.id;
    expect(pickDefaultModel({ ...imported.config, channels }, "image", start.imageModel)).toBe(`${importedId}::image-x`);
});
