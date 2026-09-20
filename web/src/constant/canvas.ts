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

export const NODE_DEFAULT_SIZE = {
    [CanvasNodeType.Image]: { width: 340, height: 240, get title() { return i18n.t("canvas.nodeTypes.image"); } },
    [CanvasNodeType.Text]: { width: 340, height: 240, get title() { return i18n.t("canvas.nodeTypes.text"); } },
    [CanvasNodeType.Config]: { width: 340, height: 240, get title() { return i18n.t("canvas.nodeTypes.config"); } },
    [CanvasNodeType.Video]: { width: 420, height: 236, get title() { return i18n.t("canvas.nodeTypes.video"); } },
    [CanvasNodeType.Audio]: { width: 340, height: 120, get title() { return i18n.t("canvas.nodeTypes.audio"); } },
    [CanvasNodeType.Group]: { width: 760, height: 480, get title() { return i18n.t("canvas.nodeTypes.group"); } },
    [CanvasNodeType.CrEntity]: { width: 300, height: 200, get title() { return i18n.t("canvas.nodeTypes.crEntity"); } },
    [CanvasNodeType.Frame]: { width: 640, height: 400, get title() { return i18n.t("canvas.nodeTypes.frame"); } },
    [CanvasNodeType.Note]: { width: 280, height: 200, get title() { return i18n.t("canvas.nodeTypes.note"); } },
    [CanvasNodeType.Question]: { width: 300, height: 180, get title() { return i18n.t("canvas.nodeTypes.question"); } },
    [CanvasNodeType.Pdf]: { width: 300, height: 180, get title() { return i18n.t("canvas.nodeTypes.pdf"); } },
    [CanvasNodeType.Web]: { width: 300, height: 180, get title() { return i18n.t("canvas.nodeTypes.web"); } },
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
    [CanvasNodeType.CrEntity]: {
        width: 300, height: 200, get title() { return NODE_DEFAULT_SIZE[CanvasNodeType.CrEntity].title; },
        metadata: { status: "idle", entityKind: "seed", summary: "" },
    },
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
