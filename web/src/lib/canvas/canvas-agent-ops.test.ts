import { describe, expect, it } from "vitest";

import { applyCanvasAgentOps, assertCanvasWrite, CanvasRevisionError, canvasOpsTouches, canvasSnapshotChanges, type CanvasAgentSnapshot, type CanvasRevisionEntry } from "./canvas-agent-ops";
import { CanvasNodeType } from "@/types/canvas";

function snapshot(revision: number, content = "a"): CanvasAgentSnapshot {
    return {
        projectId: "project-1",
        title: "test",
        revision,
        nodes: [{ id: "node-1", type: CanvasNodeType.Text, title: "Text", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content } }],
        connections: [],
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, k: 1 },
    };
}

describe("canvas agent optimistic concurrency", () => {
    it("allows writes to a different node after the base revision", () => {
        expect(() => assertCanvasWrite(
            { projectId: "project-1", baseRevision: 1, ops: [{ type: "add_node", id: "node-2" }] },
            snapshot(2, "changed"),
            [{ revision: 2, nodeIds: ["node-1"], connectionIds: [], selection: false, viewport: false }],
        )).not.toThrow();
    });

    it("rejects writes to a node changed since the base revision", () => {
        expect(() => assertCanvasWrite(
            { projectId: "project-1", baseRevision: 1, ops: [{ type: "update_node", id: "node-1", metadata: { content: "agent" } }] },
            snapshot(2, "user"),
            [{ revision: 2, nodeIds: ["node-1"], connectionIds: [], selection: false, viewport: false }],
        )).toThrowError(CanvasRevisionError);
    });

    it("tracks connection endpoints and manual snapshot changes", () => {
        expect(canvasOpsTouches([{ type: "connect_nodes", id: "connection-1", fromNodeId: "node-1", toNodeId: "node-2" }])).toMatchObject({
            nodeIds: ["node-1", "node-2"],
            connectionIds: ["connection-1"],
        });
        expect(canvasSnapshotChanges(snapshot(1), snapshot(1, "changed")).nodeIds).toEqual(["node-1"]);
    });

    it("rejects a stale project", () => {
        expect(() => assertCanvasWrite({ projectId: "other", baseRevision: 1, ops: [] }, snapshot(1), [])).toThrowError(/画布已切换/);
    });

    it("rejects revisions from a previous page lifecycle", () => {
        expect(() => assertCanvasWrite(
            { projectId: "project-1", baseRevision: 2, ops: [{ type: "update_node", id: "node-1", metadata: { content: "stale" } }] },
            snapshot(Date.now()),
            [],
        )).toThrowError(/版本已过期/);
    });

    it("rejects duplicate ids and missing mutation targets", () => {
        expect(() => assertCanvasWrite({ projectId: "project-1", baseRevision: 1, ops: [{ type: "add_node", id: "node-1" }] }, snapshot(1), [])).toThrowError(CanvasRevisionError);
        expect(() => assertCanvasWrite({ projectId: "project-1", baseRevision: 1, ops: [{ type: "update_node", id: "missing" }] }, snapshot(1), [])).toThrowError(CanvasRevisionError);
        expect(() => assertCanvasWrite({
            projectId: "project-1",
            baseRevision: 1,
            ops: [
                { type: "add_node", id: "node-2" },
                { type: "connect_nodes", id: "connection-1", fromNodeId: "node-1", toNodeId: "node-2" },
                { type: "connect_nodes", id: "connection-1", fromNodeId: "node-2", toNodeId: "node-1" },
            ],
        }, snapshot(1), [])).toThrowError(CanvasRevisionError);
    });

    it("handles 1000 deterministic mixed writes without silent conflicts", () => {
        let current = snapshot(1);
        let journal: CanvasRevisionEntry[] = [];
        let successes = 0;
        let expectedConflicts = 0;
        for (let index = 0; index < 1000; index += 1) {
            const baseRevision = current.revision;
            if (index % 5 === 0) {
                current = { ...current, revision: current.revision + 1, nodes: current.nodes.map((node) => node.id === "node-1" ? { ...node, metadata: { content: `user-${index}` } } : node) };
                journal = [...journal, { revision: current.revision, nodeIds: ["node-1"], connectionIds: [], selection: false, viewport: false }].slice(-200);
                expect(() => assertCanvasWrite({ projectId: current.projectId, baseRevision, ops: [{ type: "update_node", id: "node-1", metadata: { content: `agent-${index}` } }] }, current, journal)).toThrowError(CanvasRevisionError);
                expectedConflicts += 1;
                continue;
            }
            const op = { type: "add_node" as const, id: `node-${index + 2}`, metadata: { content: String(index) } };
            expect(() => assertCanvasWrite({ projectId: current.projectId, baseRevision, ops: [op] }, current, journal)).not.toThrow();
            current = { ...applyCanvasAgentOps(current, [op]), revision: current.revision + 1 };
            journal = [...journal, { revision: current.revision, ...canvasOpsTouches([op]) }].slice(-200);
            successes += 1;
        }
        expect({ successes, expectedConflicts, unexpectedFailures: 0 }).toEqual({ successes: 800, expectedConflicts: 200, unexpectedFailures: 0 });
    });
});
