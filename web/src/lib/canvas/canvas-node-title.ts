import i18n from "@/i18n";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasConnection, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";

const MAX_TITLE_SUMMARY_LENGTH = 24;

const DEFAULT_NODE_TITLES = new Set([
    "audio",
    "config",
    "generation config",
    "group",
    "image",
    "text",
    "video",
    "生成配置",
    "图片",
    "文本",
    "视频",
    "音频",
    "组",
]);

const GENERATED_NODE_TITLE_KEYS: Record<CanvasGenerationMode, string> = {
    image: "canvas.generatedNodeTitles.image",
    text: "canvas.generatedNodeTitles.text",
    video: "canvas.generatedNodeTitles.video",
    audio: "canvas.generatedNodeTitles.audio",
};

export function buildGeneratedNodeTitle({ mode, prompt, nodes = [], connections = [], sourceNodeId, index = 0, count = 1 }: { mode: CanvasGenerationMode; prompt: string; nodes?: CanvasNodeData[]; connections?: CanvasConnection[]; sourceNodeId?: string; index?: number; count?: number }) {
    const summary = buildTaskSummary(prompt, findUpstreamText(nodes, connections, sourceNodeId));
    const fallback = i18n.t(`${GENERATED_NODE_TITLE_KEYS[mode]}.fallback`, { defaultValue: mode });
    const type = i18n.t(`${GENERATED_NODE_TITLE_KEYS[mode]}.type`, { defaultValue: mode });
    const suffix = count > 1 ? ` ${index + 1}` : "";
    return `${summary || fallback} · ${type}${suffix}`;
}

export function generatedTitlePatch(node: CanvasNodeData, title: string) {
    if (node.metadata?.titleSource === "user") return {};
    return { title, metadata: { ...node.metadata, titleSource: "auto" as const } };
}

function findUpstreamText(nodes: CanvasNodeData[], connections: CanvasConnection[], sourceNodeId?: string) {
    if (!sourceNodeId) return "";
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    return connections
        .filter((connection) => connection.toNodeId === sourceNodeId)
        .map((connection) => nodesById.get(connection.fromNodeId))
        .filter((node): node is CanvasNodeData => node?.type === CanvasNodeType.Text)
        .map((node) => (isUsefulNodeTitle(node.title, node) ? node.title : node.metadata?.content || node.metadata?.prompt || ""))
        .find(Boolean) || "";
}

function buildTaskSummary(prompt: string, upstreamText: string) {
    const candidate = cleanSummaryCandidate(upstreamText || prompt);
    if (!candidate) return "";
    const firstClause = candidate.split(/[。！？!?；;\n]/, 1)[0]?.trim() || candidate;
    return trimSummary(firstClause);
}

function cleanSummaryCandidate(value: string) {
    return value
        .replace(/@\[node:[^\]]+\]/g, " ")
        .replace(/[【\[]\s*(?:文本|图片|视频|音频|text|image|video|audio)\s*\d+\s*[】\]]/gi, " ")
        .replace(/\s*[·•]\s*(?:文本|图片|视频|音频|text|image|video|audio)(?:\s+\d+)?$/i, "")
        .replace(/\s+/g, " ")
        .replace(/^[\s:：,，。.!！?？;；-]+|[\s:：,，。.!！?？;；-]+$/g, "")
        .trim();
}

function trimSummary(value: string) {
    const chars = Array.from(value);
    if (chars.length <= MAX_TITLE_SUMMARY_LENGTH) return value;
    const shortened = chars.slice(0, MAX_TITLE_SUMMARY_LENGTH - 1).join("").trimEnd();
    return `${shortened}…`;
}

function isUsefulNodeTitle(title: string, node: CanvasNodeData) {
    const normalized = title.trim().toLowerCase();
    if (!normalized || DEFAULT_NODE_TITLES.has(normalized)) return false;
    return normalized !== getNodeDefinition(node.type)?.title.trim().toLowerCase();
}
