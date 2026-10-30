import { afterAll, beforeEach, expect, spyOn, test } from "bun:test";
import axios from "axios";
import type { AiConfig } from "../src/stores/use-config-store";

// Match the existing config tests: browser storage is only needed during import.
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    },
});
const { defaultConfig, useConfigStore } = await import("../src/stores/use-config-store");
const nativeModule = await import("../src/services/api/codex-image");
const { requestGeneration, requestEdit } = await import("../src/services/api/image");
const native = spyOn(nativeModule, "requestCodexImage");
const post = spyOn(axios, "post");
const previousConfig = useConfigStore.getState().config;
const config: AiConfig = {
    ...defaultConfig,
    model: "test::gpt-image-2",
    imageModel: "test::gpt-image-2",
    apiKey: "dummy",
    count: "1",
    channels: [{ id: "test", name: "Test", baseUrl: "https://example.invalid", apiKey: "dummy", apiFormat: "openai", models: [{ name: "gpt-image-2", capability: "image" }] }],
};
beforeEach(() => {
    useConfigStore.setState({ config: { ...config, codexImageGen: true } });
    native.mockReset().mockResolvedValue([{ id: "native", dataUrl: "native-image" }]);
    post.mockReset().mockResolvedValue({ data: { data: [{ b64_json: "AA==" }] } });
});
afterAll(() => {
    native.mockRestore();
    post.mockRestore();
    useConfigStore.setState({ config: previousConfig });
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
});
test("enabled generation never calls image API", async () => {
    expect((await requestGeneration(config, "circle"))[0].id).toBe("native");
    expect(post).not.toHaveBeenCalled();
});
test("enabled editing forwards references and cancellation", async () => {
    const refs = [{ id: "r", name: "r.png", type: "image/png", dataUrl: "ref" }];
    const signal = new AbortController().signal;
    await requestEdit(config, "edit", refs, { signal });
    expect(native).toHaveBeenCalledWith(config, "edit", refs, signal);
    expect(post).not.toHaveBeenCalled();
});
test("native failure is propagated without external fallback", async () => {
    native.mockImplementation(async () => {
        throw new Error("Codex unavailable");
    });
    await expect(requestGeneration(config, "circle")).rejects.toThrow("Codex unavailable");
    expect(post).not.toHaveBeenCalled();
});
test("switching off restores the original API with unchanged config", async () => {
    useConfigStore.setState({ config: { ...config, codexImageGen: false } });
    await requestGeneration(config, "circle");
    expect(native).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
    expect(config.apiKey).toBe("dummy");
});
