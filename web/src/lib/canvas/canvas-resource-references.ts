import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import i18n from "@/i18n";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { imageToDataUrl } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { CanvasGraphIndex } from "./canvas-graph-index";
import { createCanvasResourceIndex, getIndexedMentionResourceNodes, type CanvasResourceIndex } from "./canvas-resource-index";

export type CanvasResourceKind = "image" | "video" | "audio" | "text";

export type CanvasResourceReference = {
    id: string;
    nodeId: string;
    kind: CanvasResourceKind;
    label: string;
    title: string;
    previewUrl?: string;
    text?: string;
    active: boolean;
};

export function createCanvasReferenceIndex(graph: CanvasGraphIndex) {
    return createCanvasResourceIndex(graph, isResourceNode);
}

// Build once per graph, not once per node. R includes the resources expanded from groups.
export function buildIndexedCanvasMentionReferences(index: CanvasResourceIndex) {
    const references = new Map<string, CanvasResourceReference[]>();
    const singleResourceReferences = new Map<string, CanvasResourceReference[]>();
    for (const nodeId of index.graph.nodeById.keys()) {
        const resources = getIndexedMentionResourceNodes(index, nodeId);
        if (!resources.length) continue;
        const shared = resources.length === 1 ? singleResourceReferences.get(resources[0].id) : undefined;
        const labeled = shared || labelResourceNodes(resources, true);
        references.set(nodeId, labeled);
        if (resources.length === 1 && !shared) singleResourceReferences.set(resources[0].id, labeled);
    }
    return references;
}

export function buildCanvasResourceReferences(nodes: CanvasNodeData[]) {
    return labelResourceNodes(nodes, true);
}

export async function resolveCanvasReferenceImages(references: CanvasResourceReference[], nodes: CanvasNodeData[]) {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    return Promise.all(references.filter((reference) => reference.kind === "image").map(async (reference) => {
        const node = nodesById.get(reference.nodeId);
        if (!node) throw new Error(i18n.t("agent.composer.mentions.resourceMissing", { title: reference.title }));
        const metadata = node.metadata;
        const dataUrl = await imageToDataUrl({ storageKey: metadata?.storageKey, url: reference.previewUrl });
        if (!dataUrl.startsWith("data:image/")) throw new Error(i18n.t("agent.composer.mentions.imageReadFailed", { title: reference.title }));
        const meta = metadata?.naturalWidth && metadata.naturalHeight
            ? { width: metadata.naturalWidth, height: metadata.naturalHeight, mimeType: metadata.mimeType || dataUrl.match(/^data:([^;]+)/)?.[1] || "image/png" }
            : await readImageMeta(dataUrl);
        return {
            id: `canvas:${node.id}`,
            name: reference.title,
            type: metadata?.mimeType || meta.mimeType,
            size: metadata?.bytes || getDataUrlByteSize(dataUrl),
            width: meta.width,
            height: meta.height,
            url: reference.previewUrl || dataUrl,
            dataUrl,
        };
    }));
}

function hasGroupResources(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    return node.type === CanvasNodeType.Group && getGroupResourceNodes(node.id, nodes).length > 0;
}

export function isCanvasReferenceNode(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    return isResourceNode(node) || hasGroupResources(node, nodes);
}

export function getGroupResourceNodes(groupId: string, nodes: CanvasNodeData[]) {
    return nodes.filter((node) => node.metadata?.groupId === groupId && isResourceNode(node));
}

function labelResourceNodes(nodes: readonly CanvasNodeData[], active: boolean) {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
    return nodes.flatMap((node): CanvasResourceReference[] => {
        const kind = resourceKind(node);
        if (!kind) return [];
        const resource = getNodeDefinition(node.type)?.resource?.(node);
        const index = counts[kind]++;
        const label = labelForKind(kind, index);
        return [
            {
                id: node.id,
                nodeId: node.id,
                kind,
                label,
                title: node.title || label,
                previewUrl: node.metadata?.content || resource?.url,
                text: resourceText(node),
                active,
            },
        ];
    });
}

function labelForKind(kind: CanvasResourceKind, index: number) {
    if (kind === "image") return imageReferenceLabel(index);
    if (kind === "video") return i18n.t("canvas.configNode.videoReferences") + ` ${index + 1}`;
    if (kind === "audio") return i18n.t("canvas.configNode.audioReferences") + ` ${index + 1}`;
    return i18n.t("canvas.composer.resources.text", { index: index + 1 });
}

function isResourceNode(node: CanvasNodeData) {
    return Boolean(resourceKind(node));
}

function resourceText(node: CanvasNodeData): string | undefined {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt;
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    return resource?.kind === "text" ? resource.text : undefined;
}

function resourceKind(node: CanvasNodeData): CanvasResourceKind | null {
    if (node.type === CanvasNodeType.Image && node.metadata?.content) return "image";
    if (node.type === CanvasNodeType.Video && node.metadata?.content) return "video";
    if (node.type === CanvasNodeType.Audio && node.metadata?.content) return "audio";
    if (node.type === CanvasNodeType.Text && (node.metadata?.content || node.metadata?.prompt)) return "text";
    // Plugin nodes declare their input eligibility through definition.resource.
    return getNodeDefinition(node.type)?.resource?.(node)?.kind || null;
}
