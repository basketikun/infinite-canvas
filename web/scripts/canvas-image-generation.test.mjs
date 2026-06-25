import assert from "node:assert/strict";

import { CANVAS_IMAGE_GENERATION_COUNT, buildCanvasImageGenerationConfig, resolveCanvasGenerationNodeModel } from "../src/app/(user)/canvas/utils/canvas-image-generation.ts";

const baseConfig = {
    model: "default::fallback",
    imageModel: "default::image-model",
    quality: "high",
    size: "2048x2048",
};

assert.equal(CANVAS_IMAGE_GENERATION_COUNT, 1);

const config = buildCanvasImageGenerationConfig(baseConfig, {
    id: "node-1",
    type: "image",
    title: "Image",
    position: { x: 0, y: 0 },
    width: 1,
    height: 1,
    metadata: {
        model: "node::override",
        quality: "medium",
        size: "1024x1024",
        count: 9,
    },
});

assert.equal(config.model, "node::override");
assert.equal(config.quality, "medium");
assert.equal(config.size, "1024x1024");
assert.equal(config.count, "1");

const imageSourceNode = {
    id: "image-source",
    type: "image",
    title: "Image",
    position: { x: 0, y: 0 },
    width: 1,
    height: 1,
    metadata: {
        model: "apimart::gemini-3-pro-image-preview",
    },
};

assert.equal(resolveCanvasGenerationNodeModel(imageSourceNode, "image"), "apimart::gemini-3-pro-image-preview");
assert.equal(resolveCanvasGenerationNodeModel(imageSourceNode, "video"), "");

assert.equal(
    resolveCanvasGenerationNodeModel(
        {
            ...imageSourceNode,
            type: "video",
            metadata: {
                model: "apimart::seedance-2-pro",
            },
        },
        "video",
    ),
    "apimart::seedance-2-pro",
);

assert.equal(
    resolveCanvasGenerationNodeModel(
        {
            ...imageSourceNode,
            type: "config",
            metadata: {
                model: "apimart::seedance-2-pro",
            },
        },
        "video",
    ),
    "apimart::seedance-2-pro",
);
