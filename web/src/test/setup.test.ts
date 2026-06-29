import { describe, expect, it } from "vitest";

describe("vitest setup", () => {
    it("runs the web test environment", () => {
        expect(document.createElement("div")).toBeInstanceOf(HTMLDivElement);
    });
});
