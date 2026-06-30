import { describe, expect, it } from "vitest";

import { normalizeImageQuality, parseImageRatio, resolveImageRequestSize } from "./image-constraints";

describe("parseImageRatio", () => {
    it("accepts valid ratios", () => {
        expect(parseImageRatio("1:1")).toBe(1);
        expect(parseImageRatio("16:9")).toBeCloseTo(16 / 9);
    });

    it("rejects invalid ratios", () => {
        expect(parseImageRatio("auto")).toBeNull();
        expect(parseImageRatio("abc")).toBeNull();
        expect(parseImageRatio("99:1")).toBeNull();
        expect(parseImageRatio("1:0")).toBeNull();
    });
});

describe("image request constraints", () => {
    it("normalizes known quality aliases", () => {
        expect(normalizeImageQuality("2k")).toBe("medium");
        expect(normalizeImageQuality("HD")).toBe("hd");
        expect(normalizeImageQuality("unknown")).toBeUndefined();
    });

    it("resolves ratio sizes to valid pixel dimensions", () => {
        expect(resolveImageRequestSize("low", "16:9")).toBe("1360x768");
        expect(resolveImageRequestSize(undefined, "auto")).toBeUndefined();
        expect(resolveImageRequestSize("low", "1024x1024")).toBe("1024x1024");
    });
});
