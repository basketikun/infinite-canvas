import { afterAll, expect, test } from "bun:test";
import axios from "axios";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
    },
});
const { createMiniMaxChannel, defaultConfig, encodeChannelModel, isMiniMaxBaseUrl, MINIMAX_CHANNEL_PRESETS, MINIMAX_TEXT_MODELS, modelOptionsFromChannels, normalizeModelOptionValue, selectableModelsByCapability, useConfigStore } =
    await import("../src/stores/use-config-store");
const { requestImageQuestion, requestGeneration, fetchChannelModels } = await import("../src/services/api/image");
const { buildGenerationConfig } = await import("../src/lib/canvas/canvas-generation-helpers");
const originalFetch = globalThis.fetch;
const originalAdapter = axios.defaults.adapter;
const requests: Array<{ url: string; body: any; signal?: AbortSignal | null }> = [];
let reply = () => Response.json({ choices: [{ message: { content: "Answer" } }] });
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body || "{}")), signal: init?.signal });
    return reply();
}) as typeof fetch;
afterAll(() => {
    globalThis.fetch = originalFetch;
    axios.defaults.adapter = originalAdapter;
    useConfigStore.setState({ config: defaultConfig });
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
});

const messages = [
    {
        role: "user" as const,
        content: [
            { type: "text" as const, text: "Describe" },
            { type: "image_url" as const, image_url: { url: "https://example.invalid/image.png" } },
        ],
    },
];
function configFor(preset: (typeof MINIMAX_CHANNEL_PRESETS)[number] = MINIMAX_CHANNEL_PRESETS[0], model: string = MINIMAX_TEXT_MODELS[0]) {
    const channel = createMiniMaxChannel(preset);
    channel.apiKey = "offline-fixture";
    if (!channel.models.some((item) => item.name === model)) channel.models.push({ name: model, capability: "text" });
    const selected = encodeChannelModel(channel.id, model);
    return { ...defaultConfig, channels: [channel], models: modelOptionsFromChannels([channel]), textModel: selected, systemPrompt: "System" };
}

for (const preset of MINIMAX_CHANNEL_PRESETS) {
    for (const model of [...MINIMAX_TEXT_MODELS, "MiniMax-M2.7", "custom-model"]) {
        for (const effort of ["auto", "low", "medium", "high", "xhigh"] as const) {
            test(`${preset.name}: ${model} / ${effort} serializes the selected text request`, async () => {
                const config = { ...configFor(preset, model), reasoningEffort: effort };
                const signal = new AbortController().signal;
                const deltas: string[] = [];
                const selected = buildGenerationConfig(config, undefined, "text");
                expect(await requestImageQuestion(selected, messages, (value) => deltas.push(value), { signal })).toBe("Answer");
                const sent = requests.at(-1)!;
                expect(sent.url).toBe(`${preset.baseUrl}/chat/completions`);
                expect(sent.signal).toBe(signal);
                expect(sent.body).toEqual({ model, messages: [{ role: "system", content: "System" }, ...messages], stream: false, ...(model === MINIMAX_TEXT_MODELS[0] && effort !== "auto" ? { reasoning_effort: effort } : {}) });
                expect(deltas).toEqual(["Answer"]);
            });
        }
    }
}

test("regional presets and discovery offer Flash first without changing existing defaults", async () => {
    const before = requests.length;
    for (const preset of MINIMAX_CHANNEL_PRESETS) {
        const channel = createMiniMaxChannel(preset);
        expect(channel.models).toEqual(MINIMAX_TEXT_MODELS.map((name) => ({ name, capability: "text" })));
        expect(await fetchChannelModels(channel)).toEqual([...MINIMAX_TEXT_MODELS]);
    }
    expect(defaultConfig.textModel).toBe("default::gpt-5.5");
    expect(requests.length).toBe(before);
});

test("ordinary options hide obsolete text entries but preserve saved IDs, scripts and media", () => {
    const config = configFor(MINIMAX_CHANNEL_PRESETS[0], "MiniMax-M2.7");
    const channel = config.channels[0];
    channel.models.push({ name: "MiniMax-M2.5", capability: "text", script: "return model;" }, { name: "MiniMax-H3", capability: "video" }, { name: "custom-text", capability: "text" });
    config.models = modelOptionsFromChannels(config.channels);
    const options = selectableModelsByCapability(config, "text");
    expect(options).not.toContain(config.textModel);
    expect(options).toContain(encodeChannelModel(channel.id, "MiniMax-M2.5"));
    expect(options).toContain(encodeChannelModel(channel.id, "custom-text"));
    expect(selectableModelsByCapability(config, "video")).toContain(encodeChannelModel(channel.id, "MiniMax-H3"));
    expect(normalizeModelOptionValue(config.textModel, config.channels)).toBe(config.textModel);
    expect(buildGenerationConfig(config, undefined, "text").model).toBe(config.textModel);
    expect(useConfigStore.getState().isAiConfigReady(config, config.textModel)).toBe(true);
    channel.baseUrl = "https://example.invalid/v1";
    expect(selectableModelsByCapability(config, "text")).toContain(config.textModel);
});

test("custom scripts take precedence over native MiniMax transport", async () => {
    const config = configFor();
    config.channels[0].models[0].script = "return model;";
    const before = requests.length;
    expect(await requestImageQuestion(buildGenerationConfig(config, undefined, "text"), messages, () => {})).toBe(MINIMAX_TEXT_MODELS[0]);
    expect(requests.length).toBe(before);
});

test("a saved legacy node overrides the Flash default without rewriting its model", async () => {
    const config = configFor(MINIMAX_CHANNEL_PRESETS[0], "MiniMax-M2.7");
    const saved = config.textModel;
    config.textModel = encodeChannelModel(config.channels[0].id, MINIMAX_TEXT_MODELS[0]);
    const selected = buildGenerationConfig(config, { id: "saved", type: "text", title: "Saved", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { model: saved } } as Parameters<typeof buildGenerationConfig>[1], "text");
    await requestImageQuestion(selected, messages, () => {});
    expect(requests.at(-1)?.body.model).toBe("MiniMax-M2.7");
    expect(config.textModel).toBe(encodeChannelModel(config.channels[0].id, MINIMAX_TEXT_MODELS[0]));
});

test("native text calls honor the existing local proxy", async () => {
    useConfigStore.setState({ config: { ...defaultConfig, proxyEnabled: true, proxyUrl: "http://127.0.0.1:23210" } });
    try {
        await requestImageQuestion(buildGenerationConfig(configFor(), undefined, "text"), messages, () => {});
        expect(requests.at(-1)?.url).toBe("http://127.0.0.1:23210/https://api.minimax.io/v1/chat/completions");
    } finally {
        useConfigStore.setState({ config: defaultConfig });
    }
});

test("other endpoints retain Responses transport and endpoint lookalikes are not MiniMax", async () => {
    for (const url of ["https://api.minimax.io.example.invalid/v1", "https://example.invalid/minimax", "https://api.minimax.io/custom", "http://api.minimax.io/v1"]) expect(isMiniMaxBaseUrl(url)).toBe(false);
    reply = () => new Response('data: {"type":"response.output_text.delta","delta":"Answer"}\n\ndata: [DONE]\n\n');
    try {
        const config = configFor();
        config.channels[0].baseUrl = "https://example.invalid/v1";
        await requestImageQuestion(buildGenerationConfig(config, undefined, "text"), messages, () => {});
        expect(requests.at(-1)?.url).toBe("https://example.invalid/v1/responses");
        expect(requests.at(-1)?.body.input).toBeDefined();
        expect(requests.at(-1)?.body.messages).toBeUndefined();
    } finally {
        reply = () => Response.json({ choices: [{ message: { content: "Answer" } }] });
    }
});

test("HTTP errors and empty completions do not become successful text", async () => {
    const config = buildGenerationConfig(configFor(), undefined, "text");
    try {
        reply = () => Response.json({ error: { message: "Invalid request" } }, { status: 400 });
        await expect(requestImageQuestion(config, messages, () => {})).rejects.toThrow("Invalid request");
        reply = () => Response.json({ choices: [{ message: { content: "" }, finish_reason: "length" }] });
        await expect(requestImageQuestion(config, messages, () => {})).rejects.toThrow();
    } finally {
        reply = () => Response.json({ choices: [{ message: { content: "Answer" } }] });
    }
});

test("media generation still serializes its existing request on the same host", async () => {
    let outgoing: any;
    axios.defaults.adapter = async (config) => {
        outgoing = { url: config.url, body: JSON.parse(config.data) };
        return { data: { data: [{ b64_json: "aW1hZ2U=" }] }, status: 200, statusText: "OK", headers: {}, config };
    };
    try {
        const config = configFor();
        config.channels[0].models.push({ name: "custom-image", capability: "image" });
        await requestGeneration({ ...config, model: encodeChannelModel(config.channels[0].id, "custom-image") }, "Image prompt");
        expect(outgoing.url).toBe("https://api.minimax.io/v1/images/generations");
        expect(outgoing.body.model).toBe("custom-image");
        expect(outgoing.body.prompt).toBe("System\n\nImage prompt");
        expect(outgoing.body.messages).toBeUndefined();
    } finally {
        axios.defaults.adapter = originalAdapter;
    }
});
