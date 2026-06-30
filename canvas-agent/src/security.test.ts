import { describe, expect, test } from "bun:test";

import { tokenSummary } from "./security.js";

describe("tokenSummary", () => {
    test("masks short tokens completely", () => {
        expect(tokenSummary("short")).toBe("****");
        expect(tokenSummary("12345678")).toBe("****");
    });

    test("keeps only token edges for longer tokens", () => {
        expect(tokenSummary("abcd12345678wxyz")).toBe("abcd...wxyz");
    });
});
