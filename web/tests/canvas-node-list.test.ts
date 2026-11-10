import { expect, test } from "bun:test";
import { buildCanvasNodeRows, chunkCanvasNodeRows } from "../src/lib/canvas/canvas-node-list";
import { makeNode } from "./helpers/canvas-graph-fixtures";

const child = (id: string, groupId: string) => makeNode(id, "video", { metadata: { groupId } });

test("rows keep root order, group member order, orphans and node identities", () => {
    const nodes = Object.freeze([child("child2", "group"), makeNode("root"), makeNode("group", "group"),
        child("child1", "group"), child("orphan", "missing")].map((node) => Object.freeze(node)));
    const rows = buildCanvasNodeRows({ nodes, filtered: nodes, collapsedGroups: new Set() });
    expect(rows.map(({ node, depth, hasChildren }) => [node.id, depth, hasChildren])).toEqual([
        ["root", 0, false], ["group", 0, true], ["child2", 1, false], ["child1", 1, false], ["orphan", 0, false],
    ]);
    expect(rows[2].node).toBe(nodes[0]);
});

test("matching children retain their parent even when the group fails the filter", () => {
    const nodes = [makeNode("group", "group"), child("match", "group"), child("other", "group")];
    const rows = buildCanvasNodeRows({ nodes, filtered: [nodes[1]], collapsedGroups: new Set() });
    expect(rows.map(({ node }) => node.id)).toEqual(["group", "match"]);
    const folded = buildCanvasNodeRows({ nodes, filtered: [nodes[1]], collapsedGroups: new Set(["group"]) });
    expect(folded.map(({ node, hasChildren }) => [node.id, hasChildren])).toEqual([["group", true]]);
    expect(buildCanvasNodeRows({ nodes, filtered: [], collapsedGroups: new Set() })).toEqual([]);
});

test("matching empty groups remain visible without a collapse arrow", () => {
    const nodes = [makeNode("group", "group"), child("other", "group")];
    expect(buildCanvasNodeRows({ nodes, filtered: [nodes[0]], collapsedGroups: new Set() })).toEqual([
        { node: nodes[0], depth: 0, hasChildren: false },
    ]);
});

test("large groups retain every node, without modifying the input", () => {
    const nodes = Object.freeze([makeNode("group", "group"), ...Array.from({ length: 4539 }, (_, i) => child(`child-${i}`, "group"))]);
    const rows = buildCanvasNodeRows({ nodes, filtered: nodes, collapsedGroups: new Set() });
    expect(rows.length).toBe(nodes.length);
    expect(rows.at(-1)?.node).toBe(nodes.at(-1));
    expect(rows.slice(1).every((row, i) => row.node === nodes[i + 1] && row.depth === 1)).toBe(true);
});

test("grid rows preserve all entries through different widths and incomplete last rows", () => {
    const nodes = Array.from({ length: 17 }, (_, i) => makeNode(String(i)));
    const rows = Object.freeze(buildCanvasNodeRows({ nodes, filtered: nodes, collapsedGroups: new Set() }));
    for (const columns of [1, 2, 3, 4, 5]) {
        const chunks = chunkCanvasNodeRows(rows, columns);
        expect(chunks.flat()).toEqual(rows);
        expect(chunks.at(-1)?.at(-1)).toBe(rows.at(-1));
        expect(chunks.every((chunk) => chunk.length <= columns)).toBe(true);
    }
    expect(chunkCanvasNodeRows([], 2)).toEqual([]);
    expect(() => chunkCanvasNodeRows(rows, 0)).toThrow();
});
