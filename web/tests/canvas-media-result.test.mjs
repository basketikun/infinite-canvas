import assert from "node:assert/strict";
import test from "node:test";

import { findCanvasMediaResultPosition } from "../src/lib/canvas/canvas-media-result.ts";

test("places a media result to the right of its source and centers it vertically", () => {
    const source = { id: "source", position: { x: 40, y: 50 }, width: 300, height: 180 };
    const position = findCanvasMediaResultPosition(source, { width: 240, height: 120 }, [source]);

    assert.deepEqual(position, { x: 436, y: 80 });
});

test("moves the result down when another node occupies the first position", () => {
    const source = { id: "source", position: { x: 0, y: 0 }, width: 300, height: 180 };
    const existing = { id: "existing", position: { x: 396, y: 30 }, width: 240, height: 120 };
    const position = findCanvasMediaResultPosition(source, { width: 240, height: 120 }, [source, existing]);

    assert.deepEqual(position, { x: 396, y: 174 });
});
