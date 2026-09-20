import i18n from "@/i18n";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeMetadata } from "@/types/canvas";
import { getNodeSpec as getRegistryNodeSpec } from "@/lib/canvas/node-registry";

type CanvasNodeSpec = {
    width: number;
    height: number;
    title: string;
    metadata?: CanvasNodeMetadata;
};

function nodeSize(type: CanvasNodeType, width: number, height: number) {
    return { width, height, get title() { return i18n.t(`canvas.nodeTypes.${type}`); } };
}

function researchCardSpec(type: CanvasNodeType): CanvasNodeSpec {
    return {
        width: 300,
        height: 200,
        get title() { return NODE_DEFAULT_SIZE[type].title; },
        metadata: { status: "idle", summary: "" },
    };
}

export const NODE_DEFAULT_SIZE = {
    [CanvasNodeType.Image]: nodeSize(CanvasNodeType.Image, 340, 240),
    [CanvasNodeType.Text]: nodeSize(CanvasNodeType.Text, 340, 240),
    [CanvasNodeType.Config]: nodeSize(CanvasNodeType.Config, 340, 240),
    [CanvasNodeType.Video]: nodeSize(CanvasNodeType.Video, 420, 236),
    [CanvasNodeType.Audio]: nodeSize(CanvasNodeType.Audio, 340, 120),
    [CanvasNodeType.Group]: nodeSize(CanvasNodeType.Group, 760, 480),
    [CanvasNodeType.Seed]: nodeSize(CanvasNodeType.Seed, 300, 200),
    [CanvasNodeType.Direction]: nodeSize(CanvasNodeType.Direction, 300, 200),
    [CanvasNodeType.ResearchQuestion]: nodeSize(CanvasNodeType.ResearchQuestion, 300, 200),
    [CanvasNodeType.Problem]: nodeSize(CanvasNodeType.Problem, 300, 200),
    [CanvasNodeType.Hypothesis]: nodeSize(CanvasNodeType.Hypothesis, 300, 200),
    [CanvasNodeType.Approach]: nodeSize(CanvasNodeType.Approach, 300, 200),
    [CanvasNodeType.Method]: nodeSize(CanvasNodeType.Method, 300, 200),
    [CanvasNodeType.Evaluation]: nodeSize(CanvasNodeType.Evaluation, 300, 200),
    [CanvasNodeType.Idea]: nodeSize(CanvasNodeType.Idea, 300, 200),
    [CanvasNodeType.Frame]: nodeSize(CanvasNodeType.Frame, 640, 400),
    [CanvasNodeType.Note]: nodeSize(CanvasNodeType.Note, 280, 200),
    [CanvasNodeType.Question]: nodeSize(CanvasNodeType.Question, 300, 180),
    [CanvasNodeType.Pdf]: nodeSize(CanvasNodeType.Pdf, 300, 180),
    [CanvasNodeType.Web]: nodeSize(CanvasNodeType.Web, 300, 180),
} satisfies Record<CanvasNodeType, { width: number; height: number; title: string }>;

export const NODE_SPECS = {
    [CanvasNodeType.Image]: {
        width: 340, height: 240, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Image].title; },
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Text]: {
        width: 340, height: 240, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Text].title; },
        metadata: { content: "", status: "idle", fontSize: 14 },
    },
    [CanvasNodeType.Config]: {
        width: 340, height: 240, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Config].title; },
        metadata: { content: "", status: "idle", generationMode: "image" },
    },
    [CanvasNodeType.Video]: {
        width: 420, height: 236, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Video].title; },
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Audio]: {
        width: 340, height: 120, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Audio].title; },
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Group]: {
        width: 760, height: 480, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Group].title; },
        metadata: { status: "idle" },
    },
    [CanvasNodeType.Seed]: researchCardSpec(CanvasNodeType.Seed),
    [CanvasNodeType.Direction]: researchCardSpec(CanvasNodeType.Direction),
    [CanvasNodeType.ResearchQuestion]: researchCardSpec(CanvasNodeType.ResearchQuestion),
    [CanvasNodeType.Problem]: researchCardSpec(CanvasNodeType.Problem),
    [CanvasNodeType.Hypothesis]: researchCardSpec(CanvasNodeType.Hypothesis),
    [CanvasNodeType.Approach]: researchCardSpec(CanvasNodeType.Approach),
    [CanvasNodeType.Method]: researchCardSpec(CanvasNodeType.Method),
    [CanvasNodeType.Evaluation]: researchCardSpec(CanvasNodeType.Evaluation),
    [CanvasNodeType.Idea]: researchCardSpec(CanvasNodeType.Idea),
    [CanvasNodeType.Frame]: {
        width: 640, height: 400, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Frame].title; },
        metadata: { status: "idle" },
    },
    [CanvasNodeType.Note]: {
        width: 280, height: 200, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Note].title; },
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Question]: {
        width: 300, height: 180, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Question].title; },
        metadata: { status: "idle", summary: "" },
    },
    [CanvasNodeType.Pdf]: {
        width: 300, height: 180, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Pdf].title; },
        metadata: { status: "idle", sourceUrl: "" },
    },
    [CanvasNodeType.Web]: {
        width: 300, height: 180, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.Web].title; },
        metadata: { status: "idle", sourceUrl: "" },
    },
} satisfies Record<CanvasNodeType, CanvasNodeSpec>;

// Return built-in specs directly and resolve plugin types from the registry.
export function getNodeSpec(type: string) {
    if ((Object.values(CanvasNodeType) as string[]).includes(type)) return NODE_SPECS[type as CanvasNodeType];
    const spec = getRegistryNodeSpec(type);
    return { width: spec.width, height: spec.height, title: spec.title, metadata: spec.metadata };
}
