import { expect, test } from "bun:test";
import { createCanvasDragPositions, canvasDragPosition, findCanvasDragTarget, finishCanvasDrag, translateCanvasDrag } from "../src/lib/canvas/canvas-node-drag";
import { findContainingGroupId, findGroupDropTarget, snapNodesIntoGroup } from "../src/lib/canvas/canvas-node-geometry";
import { makeNode } from "./helpers/canvas-graph-fixtures";
import type { CanvasNodeData, Position } from "../src/types/canvas";

function previousDrop(nodes: CanvasNodeData[], positions: ReadonlyMap<string, Position>, offset: Position) {
    const movedIds = new Set(positions.keys());
    const moved = nodes.map((node) => {
        const initial = positions.get(node.id);
        return initial ? { ...node, position: { x: initial.x + offset.x, y: initial.y + offset.y } } : node;
    });
    const target = findGroupDropTarget(movedIds, moved);
    if (target) return snapNodesIntoGroup(movedIds, moved, target);
    return moved.map((node) => {
        if (!movedIds.has(node.id) || node.type === "group") return node;
        const groupId = findContainingGroupId(node, moved);
        return node.metadata?.groupId === groupId ? node : { ...node, metadata: { ...node.metadata, groupId } };
    });
}

test("selected groups include direct members exactly once in source order", () => {
    const nodes = Object.freeze([makeNode("a", "group"), makeNode("b", "group"),
        makeNode("a1", "video", { metadata: { groupId: "a" } }), makeNode("b1", "video", { metadata: { groupId: "b" } }), makeNode("fixed")]);
    const positions = createCanvasDragPositions(new Set(["a", "a1", "b"]), nodes);
    expect([...positions.keys()]).toEqual(["a", "b", "a1", "b1"]);
    expect(positions.get("a1")).toBe(nodes[2].position);
});

test("preview does not mutate committed geometry and preserves concurrent content on commit", () => {
    const node = Object.freeze(makeNode("moving"));
    const fixed = Object.freeze(makeNode("fixed"));
    const preview = { positions: createCanvasDragPositions(new Set([node.id]), [node, fixed]), offset: { x: 80, y: -30 } };
    expect(canvasDragPosition(node, preview)).toEqual({ x: 80, y: -30 });
    expect(node.position).toEqual({ x: 0, y: 0 });
    const changed = { ...node, metadata: { content: "new output" } };
    const next = finishCanvasDrag({ nodes: [changed, fixed], preview, resolveGroups: true });
    expect(next[0].metadata?.content).toBe("new output");
    expect(next[1]).toBe(fixed);
    expect(finishCanvasDrag({ nodes: [fixed], preview, resolveGroups: true })).toEqual([fixed]);
});

test("zero displacement retains objects and interrupted dragging retains membership", () => {
    const nodes = [makeNode("node", "text", { metadata: { groupId: "group" } })];
    const positions = createCanvasDragPositions(new Set(["node"]), nodes);
    expect(translateCanvasDrag(nodes, { positions, offset: { x: 0, y: 0 } })[0]).toBe(nodes[0]);
    const next = finishCanvasDrag({ nodes, preview: { positions, offset: { x: 300, y: 40 } }, resolveGroups: false });
    expect(next[0].position).toEqual({ x: 300, y: 40 });
    expect(next[0].metadata?.groupId).toBe("group");
});

test("drop result and target match existing geometry rules over mixed groups and overlapping bounds", () => {
    for (let scenario = 0; scenario < 80; scenario++) {
        const nodes = Array.from({ length: 80 }, (_, index) => makeNode(String(index), index < 8 ? "group" : "video", {
            position: { x: (index * 113 + scenario * 37) % 2000, y: (index * 61) % 1500 },
            width: index < 8 ? 900 : 100, height: index < 8 ? 700 : 80,
            metadata: index < 8 ? {} : { groupId: String(index % 8), content: `value-${index}` },
        }));
        const selected = new Set(nodes.filter((_, index) => (index + scenario) % 9 === 0).map((node) => node.id));
        const positions = createCanvasDragPositions(selected, nodes);
        const offset = { x: scenario * 19 - 500, y: scenario * 13 - 400 };
        const preview = { positions, offset };
        expect(findCanvasDragTarget(nodes, preview)?.id).toBe(findGroupDropTarget(new Set(positions.keys()), translateCanvasDrag(nodes, preview))?.id);
        expect(finishCanvasDrag({ nodes, preview, resolveGroups: true })).toEqual(previousDrop(nodes, positions, offset));
    }
});

test("batch movement keeps all group-relative positions and references", () => {
    const nodes = Array.from({ length: 28 }, (_, group) => [makeNode(`g${group}`, "group", { position: { x: 0, y: group * 10000 }, width: 9000, height: 5000 }),
        ...Array.from({ length: 161 }, (_, member) => makeNode(`g${group}-${member}`, "video", { position: { x: member * 30, y: group * 10000 + 50 }, metadata: { groupId: `g${group}` } }))]).flat();
    const preview = { positions: createCanvasDragPositions(new Set(nodes.filter((n) => n.type === "group").map((n) => n.id)), nodes), offset: { x: 600, y: 300 } };
    const next = finishCanvasDrag({ nodes, preview, resolveGroups: true });
    expect(next.length).toBe(4536);
    expect(next.every((node, index) => node.position.x === nodes[index].position.x + 600 && node.position.y === nodes[index].position.y + 300)).toBe(true);
    expect(next.every((node, index) => node.metadata === nodes[index].metadata)).toBe(true);
});
