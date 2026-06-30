import { beforeEach, describe, expect, it, vi } from "vitest";

import { normalizePromptCoverUrl, recordPromptSourceFailure, resetPromptSourceDiagnostics, withPromptDiagnostics } from "./route";

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

describe("prompt source diagnostics", () => {
    beforeEach(() => {
        resetPromptSourceDiagnostics();
        vi.restoreAllMocks();
    });

    it("logs source failures and records debug diagnostics", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        recordPromptSourceFailure("source-a", new Error("boom"));

        expect(warn).toHaveBeenCalledWith("[prompts] failed to load source-a", "boom");
        expect(withPromptDiagnostics({ ok: true }, true)).toEqual({
            ok: true,
            diagnostics: {
                promptSources: [{ category: "source-a", failures: 1, lastError: "boom" }],
            },
        });
    });

    it("keeps normal responses unchanged without debug", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        recordPromptSourceFailure("source-a", "offline");

        expect(withPromptDiagnostics({ ok: true }, false)).toEqual({ ok: true });
    });
});
