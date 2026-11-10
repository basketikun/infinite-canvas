import { afterAll, expect, test } from "bun:test";
import { createCanvasGraphIndex } from "../src/lib/canvas/canvas-graph-index";
import { createMatrix, makeNode, makeEdge } from "./helpers/canvas-graph-fixtures";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key),
} });
afterAll(() => {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
});

const { createCanvasReferenceIndex, buildIndexedCanvasMentionReferences } = await import("../src/lib/canvas/canvas-resource-references");
const { buildIndexedNodeGenerationInputs } = await import("../src/components/canvas/canvas-node-generation");
const { registerNodeDefinitions, unregisterPluginNodes } = await import("../src/lib/canvas/node-registry");
const { default: i18n } = await import("../src/i18n");

test("matrix shares single-source reference arrays and stores no empty entries", () => {
    const { nodes, connections } = createMatrix({ textCount: 28, videoCount: 15, populated: false });
    const map = buildIndexedCanvasMentionReferences(createCanvasReferenceIndex(createCanvasGraphIndex(nodes, connections)));
    expect(map.size).toBe(29);
    expect(new Set(map.values()).size).toBe(1);
    expect(map.get("text-0")).toBe(map.get("text-27"));
    expect(map.get("text-0-video-0")).toBeUndefined();
});

test("populated matrix allocates one reference array per distinct prompt", () => {
    const { nodes, connections } = createMatrix({ textCount: 28, videoCount: 15, populated: true });
    const map = buildIndexedCanvasMentionReferences(createCanvasReferenceIndex(createCanvasGraphIndex(nodes, connections)));
    expect(map.size).toBe(449);
    expect(new Set(map.values()).size).toBe(29);
    expect(map.get("text-12-video-0")).toBe(map.get("text-12-video-14"));
    expect(map.get("text-12-video-0")![0].text).toBe("prompt-12");
});

test("mixed reference numbering, group order and generation payloads stay intact", () => {
    const nodes = [makeNode("g", "group"), makeNode("text", "text", { metadata: { content: "prompt", groupId: "g" } }),
        makeNode("image", "image", { metadata: { content: "image-url", storageKey: "stored-image", groupId: "g" } }),
        makeNode("video", "video"), makeNode("config", "config")];
    const index = createCanvasReferenceIndex(createCanvasGraphIndex(nodes, [makeEdge("g", "config"), makeEdge("video", "config")]));
    const references = buildIndexedCanvasMentionReferences(index).get("config")!;
    expect(references.map(ref => ref.nodeId)).toEqual(["text", "image", "video"]);
    expect(references.map(ref => ref.kind)).toEqual(["text", "image", "video"]);
    expect(references.every(ref => ref.active)).toBe(true);
    const inputs = buildIndexedNodeGenerationInputs("config", index);
    expect(inputs[0].type).toBe("group");
    if (inputs[0].type !== "group") throw new Error("Expected group input");
    expect(inputs[0].children.map(child => child.nodeId)).toEqual(["text", "image"]);
    expect(inputs[0].children[1].image?.storageKey).toBe("stored-image");
    expect(inputs[1].type).toBe("video");
});

test("plugin resources refresh on geometry and registry changes without retained old snapshots", () => {
    const type = "test:resource";
    const nodes = [makeNode("p", type), makeNode("target")];
    const edges = [makeEdge("p", "target")];
    registerNodeDefinitions([{ type, title: type, icon: null, defaultSize: { width: 100, height: 100 },
        resource: node => ({ kind: "text", text: String(node.position.x) }) }], "reference-test");
    try {
        const before = buildIndexedCanvasMentionReferences(createCanvasReferenceIndex(createCanvasGraphIndex(nodes, edges)));
        const moved = [{ ...nodes[0], position: { x: 42, y: 0 } }, nodes[1]];
        const after = buildIndexedCanvasMentionReferences(createCanvasReferenceIndex(createCanvasGraphIndex(moved, edges)));
        expect(before.get("target")![0].text).toBe("0");
        expect(after.get("target")![0].text).toBe("42");
        unregisterPluginNodes("reference-test");
        const unloaded = buildIndexedCanvasMentionReferences(createCanvasReferenceIndex(createCanvasGraphIndex(nodes, edges)));
        expect(unloaded.get("target")![0].nodeId).toBe("target");
    } finally { unregisterPluginNodes("reference-test"); }
});

test("reference labels refresh when locale changes", async () => {
    const index = createCanvasReferenceIndex(createCanvasGraphIndex([makeNode("text")], []));
    const previousLanguage = i18n.language;
    try {
        await i18n.changeLanguage("zh-CN");
        const chinese = buildIndexedCanvasMentionReferences(index).get("text")![0].label;
        await i18n.changeLanguage("en-US");
        expect(buildIndexedCanvasMentionReferences(index).get("text")![0].label).not.toBe(chinese);
    } finally { await i18n.changeLanguage(previousLanguage); }
});
