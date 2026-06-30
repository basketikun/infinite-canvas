import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../types";
import { buildNodeMentionReferences, getGenerationResourceNodes } from "./canvas-resource-references";

const nodes: CanvasNodeData[] = [
    { id: "image-1", type: CanvasNodeType.Image, title: "Image", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "blob:image" } },
    { id: "text-1", type: CanvasNodeType.Text, title: "Prompt", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "hello" } },
    { id: "config-1", type: CanvasNodeType.Config, title: "Config", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: {} },
];

const connections: CanvasConnection[] = [
    { id: "c1", fromNodeId: "image-1", toNodeId: "config-1" },
    { id: "c2", fromNodeId: "text-1", toNodeId: "config-1" },
];

describe("canvas resource references", () => {
    it("uses connected resources for generation", () => {
        expect(getGenerationResourceNodes("config-1", nodes, connections).map((node) => node.id)).toEqual(["image-1", "text-1"]);
    });

    it("labels mention references by kind", () => {
        const references = buildNodeMentionReferences(nodes[2], nodes, connections);

        expect(references.map((item) => item.kind)).toEqual(["image", "text"]);
        expect(references.every((item) => item.active)).toBe(true);
    });
});
