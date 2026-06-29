import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { getVisibleConnections, getVisibleNodes } from "./canvas-visible-graph";

function node(id: string, x: number, y = 0): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Text,
        title: id,
        position: { x, y },
        width: 100,
        height: 100,
        metadata: {},
    };
}

describe("canvas visible graph", () => {
    it("filters nodes by viewport bounds", () => {
        const result = getVisibleNodes([node("a", 0), node("b", 5000)], { x: 0, y: 0, k: 1 }, { width: 800, height: 600 }, 0);

        expect(result.map((item) => item.id)).toEqual(["a"]);
    });

    it("keeps nodes intersecting the padded viewport", () => {
        const result = getVisibleNodes([node("near-left", -120), node("far-left", -220), node("inside", 10)], { x: 0, y: 0, k: 1 }, { width: 800, height: 600 }, 24);

        expect(result.map((item) => item.id)).toEqual(["near-left", "inside"]);
    });

    it("keeps connections touching visible nodes", () => {
        const result = getVisibleConnections(
            [
                { id: "c1", fromNodeId: "a", toNodeId: "b" },
                { id: "c2", fromNodeId: "x", toNodeId: "y" },
            ],
            new Set(["a"]),
        );

        expect(result.map((item) => item.id)).toEqual(["c1"]);
    });
});
