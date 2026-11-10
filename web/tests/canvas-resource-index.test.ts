import { expect, test } from "bun:test";
import { createCanvasGraphIndex, getCanvasRelatedHighlight } from "../src/lib/canvas/canvas-graph-index";
import { createCanvasResourceIndex, getIndexedGenerationResourceNodes, getIndexedMentionResourceNodes } from "../src/lib/canvas/canvas-resource-index";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { createMatrix, makeEdge, makeNode, referenceOracle } from "./helpers/canvas-graph-fixtures";

const resource = (node: CanvasNodeData) => ["text", "image", "video", "audio"].includes(node.type) && Boolean(node.metadata?.content || node.metadata?.prompt);
const ids = (nodes: readonly CanvasNodeData[]) => nodes.map(node => node.id);

test("graph buckets preserve edge order, duplicates, missing endpoints, and node identity", () => {
    const nodes = Object.freeze([Object.freeze(makeNode("a")), Object.freeze(makeNode("b"))]);
    const edges = Object.freeze([makeEdge("b", "a", "first"), makeEdge("missing", "a"), makeEdge("b", "a", "last"), makeEdge("a", "missing")]);
    const graph = createCanvasGraphIndex(nodes, edges);
    expect(ids(graph.connectedNodes.get("a")!)).toEqual(["b", "b"]);
    expect(graph.nodeById.get("a")).toBe(nodes[0]);
    expect(graph.incoming.get("a")?.map(edge => edge.id)).toEqual(["first", "missing->a", "last"]);
    expect(ids(graph.connectedNodes.get("missing")!)).toEqual(["a"]);
});

test("group expansion is ordered and deduplicated, generation retains group containers", () => {
    const nodes = [makeNode("group", "group"), makeNode("b", "image", { metadata: { content: "image", groupId: "group" } }),
        makeNode("a", "text", { metadata: { content: "text", groupId: "group" } }), makeNode("empty", "video", { metadata: { groupId: "group" } }), makeNode("target")];
    const index = createCanvasResourceIndex(createCanvasGraphIndex(nodes, [makeEdge("a", "target"), makeEdge("group", "target"), makeEdge("a", "target", "duplicate")]), resource);
    expect(ids(getIndexedMentionResourceNodes(index, "target"))).toEqual(["a", "b"]);
    expect(ids(getIndexedGenerationResourceNodes(index, "target"))).toEqual(["a", "group", "a"]);
});

test("first connected config wins, excludes self, and empty peer inputs fall back to own inputs", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("own"), makeNode("config", "config"), makeNode("second", "config")];
    const edges = [makeEdge("own", "a"), makeEdge("a", "config"), makeEdge("a", "second"), makeEdge("b", "second")];
    const first = createCanvasResourceIndex(createCanvasGraphIndex(nodes, edges), resource);
    expect(ids(getIndexedMentionResourceNodes(first, "a"))).toEqual(["own"]);
    const withPeer = createCanvasResourceIndex(createCanvasGraphIndex(nodes, [...edges, makeEdge("b", "config")]), resource);
    expect(ids(getIndexedMentionResourceNodes(withPeer, "a"))).toEqual(["b"]);
    expect(ids(getIndexedGenerationResourceNodes(withPeer, "a"))).toEqual(["b"]);
});

test("mentions fall back to self but generation never implicitly consumes self", () => {
    const index = createCanvasResourceIndex(createCanvasGraphIndex([makeNode("text"), makeNode("empty", "text", { metadata: {} })], []), resource);
    expect(ids(getIndexedMentionResourceNodes(index, "text"))).toEqual(["text"]);
    expect(getIndexedGenerationResourceNodes(index, "text")).toHaveLength(0);
    expect(getIndexedMentionResourceNodes(index, "empty")).toHaveLength(0);
    expect(getIndexedMentionResourceNodes(index, "missing")).toHaveLength(0);
});

test("an empty resource-emitting group is not expanded into itself for mentions", () => {
    const nodes = [makeNode("group", "group"), makeNode("a"), makeNode("own"), makeNode("config", "config")];
    const graph = createCanvasGraphIndex(nodes, [makeEdge("group", "config"), makeEdge("a", "config"), makeEdge("own", "a")]);
    const index = createCanvasResourceIndex(graph, node => node.type !== "config");
    expect(ids(getIndexedGenerationResourceNodes(index, "a"))).toEqual(["group"]);
    expect(ids(getIndexedMentionResourceNodes(index, "a"))).toEqual(["own"]);
});

test("rebuilding respects content, geometry-dependent plugins, membership, type and edge changes", () => {
    const nodes = [makeNode("plugin", "plugin:test", { position: { x: 1, y: 0 } }), makeNode("target")];
    const edges = [makeEdge("plugin", "target")];
    const predicate = (node: CanvasNodeData) => node.type === "plugin:test" ? node.position.x > 0 : resource(node);
    const before = createCanvasResourceIndex(createCanvasGraphIndex(nodes, edges), predicate);
    const moved = [{ ...nodes[0], position: { x: -1, y: 0 } }, nodes[1]];
    const after = createCanvasResourceIndex(createCanvasGraphIndex(moved, edges), predicate);
    expect(ids(getIndexedMentionResourceNodes(before, "target"))).toEqual(["plugin"]);
    expect(ids(getIndexedMentionResourceNodes(after, "target"))).toEqual(["target"]);
    const deleted = createCanvasResourceIndex(createCanvasGraphIndex([nodes[1]], edges), predicate);
    expect(ids(getIndexedMentionResourceNodes(deleted, "target"))).toEqual(["target"]);
});

test("related highlight visits adjacent edges and expands each related group once", () => {
    const nodes = [makeNode("g", "group"), makeNode("child", "text", { metadata: { groupId: "g" } }), makeNode("a"), makeNode("unrelated")];
    const graph = createCanvasGraphIndex(nodes, [makeEdge("g", "a"), makeEdge("a", "g"), makeEdge("a", "a"), makeEdge("unrelated", "child")]);
    const selected = getCanvasRelatedHighlight(graph, "a");
    expect([...selected.nodeIds].sort()).toEqual(["a", "child", "g"]);
    expect([...selected.connectionIds].sort()).toEqual(["a->a", "a->g", "g->a"]);
    expect(getCanvasRelatedHighlight(graph, null).nodeIds.size).toBe(0);
});

test("moving a resource between groups replaces the group input without stale membership", () => {
    const nodes = [makeNode("g1", "group"), makeNode("g2", "group"), makeNode("child", "text", { metadata: { content: "shared", groupId: "g1" } }), makeNode("target")];
    const edges = [makeEdge("g1", "target")];
    const before = createCanvasResourceIndex(createCanvasGraphIndex(nodes, edges), resource);
    const moved = nodes.map(node => node.id === "child" ? { ...node, metadata: { ...node.metadata, groupId: "g2" } } : node);
    const after = createCanvasResourceIndex(createCanvasGraphIndex(moved, edges), resource);
    expect(ids(getIndexedMentionResourceNodes(before, "target"))).toEqual(["child"]);
    expect(ids(getIndexedMentionResourceNodes(after, "target"))).toEqual(["target"]);
    expect(ids(after.groupResources.get("g2")!)).toEqual(["child"]);
});

test("reordering config edges and changing source content or config type rebuilds the selection", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c"), makeNode("cfg1", "config"), makeNode("cfg2", "config")];
    const first = makeEdge("a", "cfg1");
    const second = makeEdge("a", "cfg2");
    const inputs = [makeEdge("b", "cfg1"), makeEdge("c", "cfg2")];
    const before = createCanvasResourceIndex(createCanvasGraphIndex(nodes, [first, second, ...inputs]), resource);
    const reordered = createCanvasResourceIndex(createCanvasGraphIndex(nodes, [second, first, ...inputs]), resource);
    expect(ids(getIndexedMentionResourceNodes(before, "a"))).toEqual(["b"]);
    expect(ids(getIndexedMentionResourceNodes(reordered, "a"))).toEqual(["c"]);
    const retyped = nodes.map(node => node.id === "cfg1" ? { ...node, type: CanvasNodeType.Text } : node);
    const typeChanged = createCanvasResourceIndex(createCanvasGraphIndex(retyped, [first, second, ...inputs]), resource);
    expect(ids(getIndexedMentionResourceNodes(typeChanged, "a"))).toEqual(["c"]);
    const cleared = nodes.map(node => node.id === "b" ? { ...node, metadata: {} } : node);
    const contentChanged = createCanvasResourceIndex(createCanvasGraphIndex(cleared, [first, second, ...inputs]), resource);
    expect(ids(getIndexedMentionResourceNodes(contentChanged, "a"))).toEqual(["a"]);
});

test("449-node matrix evaluates eligibility once per node and shares graph objects", () => {
    const { nodes, connections } = createMatrix({ textCount: 28, videoCount: 15, populated: true });
    let calls = 0;
    const index = createCanvasResourceIndex(createCanvasGraphIndex(nodes, connections), node => { calls++; return resource(node); });
    for (const node of nodes) getIndexedMentionResourceNodes(index, node.id);
    expect(calls).toBe(nodes.length);
    expect(nodes.length).toBe(449);
    expect(getIndexedMentionResourceNodes(index, "text-12-video-9")[0]).toBe(nodes.find(node => node.id === "text-12"));
});

test("indexed selection matches prior rules over deterministic mixed graphs", () => {
    const CASES = 40;
    const NODE_COUNT = 24;
    const EDGE_COUNT = 80;
    const TYPES = Object.values(CanvasNodeType);
    for (let seed = 0; seed < CASES; seed++) {
        const nodes = Array.from({ length: NODE_COUNT }, (_, i) => makeNode(`n${i}`, TYPES[(i + seed) % TYPES.length],
            { metadata: { content: (i + seed) % 4 ? `text-${i}` : "", groupId: `n${(i * 7 + seed) % NODE_COUNT}` } }));
        const edges = Array.from({ length: EDGE_COUNT }, (_, i) => makeEdge(`n${(i * 17 + seed) % (NODE_COUNT + 1)}`, `n${(i * 11 + seed * 3) % NODE_COUNT}`, `e${i}`));
        const oracle = referenceOracle({ nodes, connections: edges, isResource: resource });
        const index = createCanvasResourceIndex(createCanvasGraphIndex(nodes, edges), resource);
        for (const node of nodes) {
            expect(ids(getIndexedMentionResourceNodes(index, node.id))).toEqual(ids(oracle.mentions(node.id)));
            expect(ids(getIndexedGenerationResourceNodes(index, node.id))).toEqual(ids(oracle.generation(node.id)));
        }
    }
});
