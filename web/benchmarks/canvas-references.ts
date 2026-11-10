import { isDeepStrictEqual } from "node:util";
import { createCanvasGraphIndex } from "../src/lib/canvas/canvas-graph-index";
import { createMatrix, referenceOracle } from "../tests/helpers/canvas-graph-fixtures";

// i18n reads this one browser preference while modules initialize in Bun.
Object.defineProperty(globalThis, "localStorage", { value: { getItem: () => null }, configurable: true });
const { buildCanvasResourceReferences, buildIndexedCanvasMentionReferences, createCanvasReferenceIndex } =
    await import("../src/lib/canvas/canvas-resource-references");

const WARMUP_ROUNDS = 3;
const SAMPLE_ROUNDS = 9;
const VIDEO_MODELS = 15;
const TEXT_COUNTS = [28, 56, 112, 224];
type References = ReturnType<typeof buildIndexedCanvasMentionReferences>;

function measure(build: () => References) {
    const start = performance.now();
    const result = build();
    return { elapsed: performance.now() - start, result };
}

function median(values: number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    return Number(sorted[Math.floor(sorted.length / 2)].toFixed(3));
}

function structure(map: References) {
    return { entries: map.size, arrays: new Set(map.values()).size,
        objects: new Set([...map.values()].flat()).size };
}

function benchmark(textCount: number, populated: boolean) {
    const { nodes, connections } = createMatrix({ textCount, videoCount: VIDEO_MODELS, populated });
    const oracle = referenceOracle({ nodes, connections,
        isResource: node => Boolean(node.metadata?.content || node.metadata?.prompt) });
    const oldBuild = () => new Map(nodes.map(node => [node.id, buildCanvasResourceReferences(oracle.mentions(node.id))]));
    const newBuild = () => buildIndexedCanvasMentionReferences(createCanvasReferenceIndex(createCanvasGraphIndex(nodes, connections)));
    const before = oldBuild();
    const after = newBuild();
    for (const node of nodes) {
        if (!isDeepStrictEqual(before.get(node.id), after.get(node.id) || [])) throw new Error(`Different references: ${node.id}`);
    }
    for (let round = 0; round < WARMUP_ROUNDS; round++) { oldBuild(); newBuild(); }
    const oldSamples: number[] = [];
    const newSamples: number[] = [];
    for (let round = 0; round < SAMPLE_ROUNDS; round++) {
        const measurements = round % 2 ? [measure(newBuild), measure(oldBuild)].reverse() : [measure(oldBuild), measure(newBuild)];
        oldSamples.push(measurements[0].elapsed);
        newSamples.push(measurements[1].elapsed);
    }
    return { nodes: nodes.length, edges: connections.length, populated,
        oldMedianMs: median(oldSamples), indexedMedianMs: median(newSamples),
        oldStructure: structure(before), indexedStructure: structure(after) };
}

console.log(JSON.stringify({ runtime: process.versions.bun, warmupRounds: WARMUP_ROUNDS, sampleRounds: SAMPLE_ROUNDS,
    results: [...TEXT_COUNTS.map(count => benchmark(count, false)), benchmark(TEXT_COUNTS[0], true)] }, null, 2));
