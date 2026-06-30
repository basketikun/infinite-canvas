import { describe, expect, it } from "vitest";

import { CanvasNodeType } from "../types";
import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "./canvas-agent-ops";

const snapshot: CanvasAgentSnapshot = {
    projectId: "p1",
    title: "Test",
    nodes: [],
    connections: [],
    selectedNodeIds: [],
    viewport: { x: 0, y: 0, k: 1 },
};

describe("applyCanvasAgentOps", () => {
    it("adds a node and selects it", () => {
        const result = applyCanvasAgentOps(snapshot, [{ type: "add_node", id: "n1", nodeType: CanvasNodeType.Text, title: "Note", x: 10, y: 20 }]);

        expect(result.nodes).toHaveLength(1);
        expect(result.nodes[0].position).toEqual({ x: 10, y: 20 });
        expect(result.selectedNodeIds).toEqual(["n1"]);
    });

    it("connects existing nodes only once", () => {
        const withNodes = applyCanvasAgentOps(snapshot, [
            { type: "add_node", id: "a", nodeType: CanvasNodeType.Text },
            { type: "add_node", id: "b", nodeType: CanvasNodeType.Text },
        ]);

        const result = applyCanvasAgentOps(withNodes, [
            { type: "connect_nodes", fromNodeId: "a", toNodeId: "b" },
            { type: "connect_nodes", fromNodeId: "a", toNodeId: "b" },
        ]);

        expect(result.connections).toHaveLength(1);
    });

    it("deletes related connections when deleting a node", () => {
        const withGraph = applyCanvasAgentOps(snapshot, [
            { type: "add_node", id: "a", nodeType: CanvasNodeType.Text },
            { type: "add_node", id: "b", nodeType: CanvasNodeType.Text },
            { type: "connect_nodes", fromNodeId: "a", toNodeId: "b" },
        ]);

        const result = applyCanvasAgentOps(withGraph, [{ type: "delete_node", id: "a" }]);

        expect(result.nodes.map((node) => node.id)).toEqual(["b"]);
        expect(result.connections).toEqual([]);
    });
});
