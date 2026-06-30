import { describe, expect, it } from "vitest";

import { normalizePromptCoverUrl } from "./route";

describe("normalizePromptCoverUrl", () => {
    it("cleans empty prompt cover urls", () => {
        expect(normalizePromptCoverUrl("")).toBeUndefined();
        expect(normalizePromptCoverUrl("   ")).toBeUndefined();
        expect(normalizePromptCoverUrl(undefined)).toBeUndefined();
    });

    it("keeps trimmed prompt cover urls", () => {
        expect(normalizePromptCoverUrl(" https://example.test/cover.png ")).toBe("https://example.test/cover.png");
    });
});
