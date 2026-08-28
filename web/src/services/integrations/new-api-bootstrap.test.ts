import { describe, expect, it } from "vitest";

import { defaultConfig, modelOptionName } from "@/stores/use-config-store";
import { applyDirectLaunch, cleanDirectLaunchUrl, parseDirectLaunch } from "./new-api-bootstrap";

const location = (overrides: Partial<{ hash: string; hostname: string; pathname: string; search: string }> = {}) => ({
    hash: "",
    hostname: "study.chenxy.online",
    pathname: "/",
    search: "",
    ...overrides,
});

describe("New API launch bootstrap", () => {
    it("reads credentials from a same-host fragment", () => {
        const parsed = parseDirectLaunch(
            location({
                hash: "#source=newapi&baseUrl=https%3A%2F%2Fstudy.chenxy.online%3A10443&apiKey=sk-user_token",
            }),
        );

        expect(parsed).toEqual({
            launch: {
                source: "newapi",
                baseUrl: "https://study.chenxy.online:10443",
                apiKey: "sk-user_token",
            },
        });
    });

    it.each([
        "#source=newapi&baseUrl=http%3A%2F%2Fstudy.chenxy.online%3A10443&apiKey=sk-user_token",
        "#source=newapi&baseUrl=https%3A%2F%2Fevil.example%3A10443&apiKey=sk-user_token",
        "#source=newapi&baseUrl=https%3A%2F%2Fstudy.chenxy.online%3A443&apiKey=sk-user_token",
    ])("rejects an untrusted base URL: %s", (hash) => {
        expect(parseDirectLaunch(location({ hash }))).toEqual({ error: "invalidBaseUrl" });
    });

    it("rejects an invalid New API key", () => {
        const parsed = parseDirectLaunch(
            location({
                hash: "#source=newapi&baseUrl=https%3A%2F%2Fstudy.chenxy.online%3A10443&apiKey=not-a-key",
            }),
        );
        expect(parsed).toEqual({ error: "invalidApiKey" });
    });

    it("keeps legacy query support and removes credentials from the cleaned URL", () => {
        const current = location({
            pathname: "/canvas",
            search: "?baseUrl=https%3A%2F%2Fapi.example.com&apiKey=sk-legacy_token&view=grid",
            hash: "#section",
        });
        expect(parseDirectLaunch(current)).toEqual({
            launch: {
                source: "legacy",
                baseUrl: "https://api.example.com",
                apiKey: "sk-legacy_token",
            },
        });
        expect(cleanDirectLaunchUrl(current, "legacy")).toBe("/canvas?view=grid#section");
    });

    it("creates a New API channel and selects preferred available models", () => {
        const next = applyDirectLaunch(
            structuredClone(defaultConfig),
            {
                source: "newapi",
                baseUrl: "https://study.chenxy.online:10443",
                apiKey: "sk-user_token",
            },
            ["glm-5.3", "doubao-seedream-4-5-251128", "doubao-seedream-5-0-pro-260628", "doubao-seedance-2-0-fast-260128", "doubao-seedance-2-5-260628", "volcengine-tts-1"],
        );

        expect(next.channels[0]).toMatchObject({
            name: "New API",
            baseUrl: "https://study.chenxy.online:10443",
            apiKey: "sk-user_token",
        });
        expect(modelOptionName(next.imageModel)).toBe("doubao-seedream-5-0-pro-260628");
        expect(modelOptionName(next.videoModel)).toBe("doubao-seedance-2-5-260628");
        expect(modelOptionName(next.textModel)).toBe("glm-5.3");
        expect(modelOptionName(next.audioModel)).toBe("volcengine-tts-1");
    });

    it("updates credentials without replacing existing models or custom channels", () => {
        const initial = applyDirectLaunch(
            {
                ...structuredClone(defaultConfig),
                channels: [
                    {
                        id: "custom",
                        name: "Custom",
                        baseUrl: "https://provider.example",
                        apiKey: "sk-custom",
                        apiFormat: "openai",
                        models: [{ name: "custom-model", capability: "text" }],
                    },
                ],
            },
            {
                source: "newapi",
                baseUrl: "https://study.chenxy.online:10443",
                apiKey: "sk-first_token",
            },
            ["gpt-5.5", "doubao-seedream-5-0-pro-260628"],
        );
        const updated = applyDirectLaunch(initial, {
            source: "newapi",
            baseUrl: "https://study.chenxy.online:10443",
            apiKey: "sk-rotated_token",
        });

        expect(updated.channels).toHaveLength(2);
        expect(updated.channels[0].apiKey).toBe("sk-rotated_token");
        expect(updated.channels[0].models).toEqual(initial.channels[0].models);
        expect(updated.channels[1]).toEqual(initial.channels[1]);
    });

    it("parses and removes 1000 generated tokens without exposing them in the clean URL", () => {
        for (let index = 0; index < 1000; index += 1) {
            const apiKey = `sk-generated_${index.toString(36).padStart(6, "0")}`;
            const current = location({
                hash: `#source=newapi&baseUrl=https%3A%2F%2Fstudy.chenxy.online%3A10443&apiKey=${apiKey}`,
            });
            expect(parseDirectLaunch(current)).toEqual({
                launch: {
                    source: "newapi",
                    baseUrl: "https://study.chenxy.online:10443",
                    apiKey,
                },
            });
            expect(cleanDirectLaunchUrl(current, "newapi")).not.toContain(apiKey);
        }
    });
});
