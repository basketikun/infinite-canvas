import { describe, expect, it } from "vitest";

import { isManagedCanvasSession } from "./canvas-session-presence";

describe("canvas session presence", () => {
    it("runs only on the managed HTTPS canvas port", () => {
        expect(isManagedCanvasSession({ protocol: "https:", port: "10444" } as Location)).toBe(true);
        expect(isManagedCanvasSession({ protocol: "http:", port: "10444" } as Location)).toBe(false);
        expect(isManagedCanvasSession({ protocol: "https:", port: "3000" } as Location)).toBe(false);
    });
});
