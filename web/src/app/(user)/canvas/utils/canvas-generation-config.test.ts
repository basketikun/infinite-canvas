import { describe, expect, it } from "vitest";

import { defaultConfig } from "@/stores/use-config-store";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { buildCanvasGenerationConfig } from "./canvas-generation-config";

describe("buildCanvasGenerationConfig", () => {
    it("uses capability default model", () => {
        const config = { ...defaultConfig, imageModel: "default::gpt-image-2", videoModel: "default::video-model" };
        expect(buildCanvasGenerationConfig(config, undefined, "video").model).toBe("default::video-model");
    });

    it("lets node metadata override model and size", () => {
        const node: CanvasNodeData = {
            id: "n1",
            type: CanvasNodeType.Config,
            title: "Config",
            position: { x: 0, y: 0 },
            width: 100,
            height: 100,
            metadata: { model: "custom::model", size: "16:9", count: 2 },
        };

        const result = buildCanvasGenerationConfig(defaultConfig, node, "image");

        expect(result.model).toBe("custom::model");
        expect(result.size).toBe("16:9");
        expect(result.count).toBe("2");
    });
});
