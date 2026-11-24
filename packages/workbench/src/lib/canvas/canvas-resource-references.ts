import { imageReferenceLabel } from "@workbench/lib/image-reference-prompt";

import { readNodeResource } from "@workbench/lib/canvas/node-registry";
import { previewUrlFor } from "@workbench/services/image-storage";
import { CanvasNodeType } from "@infinite-canvas/shared/canvas/schema/canvas";
import type { ReadonlyCanvasNode, ReadonlyCanvasConnection } from "@infinite-canvas/plugin-sdk";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";

export type CanvasResourceKind = "image" | "video" | "audio" | "text";

export function getNodeMediaResource(node: ReadonlyCanvasNode, slotId: string | undefined, binding: ScopeBinding, mode: "render" | "execute") {
    if (binding.signal.aborted) {
        if (mode === "execute") binding.signal.throwIfAborted();
        return null;
    }
    const resource = readNodeResource(node, mode, binding, slotId);
    return resource && resource.kind !== "text" && (resource.storageKey || resource.url) ? { ...resource, kind: resource.kind } : null;
}

export type CanvasResourceReference = {
    id: string;
    nodeId: string;
    kind: CanvasResourceKind;
    label: string;
    title: string;
    previewUrl?: string;
    sourceUrl?: string;
    storageKey?: string;
    signal: AbortSignal;
    text?: string;
    active: boolean;
};

export function buildNodeMentionReferences(node: ReadonlyCanvasNode, nodes: readonly ReadonlyCanvasNode[], connections: readonly ReadonlyCanvasConnection[], binding?: ScopeBinding) {
    return labelResourceNodes(getMentionResourceNodes(node.id, nodes, connections, binding), true, binding);
}

export function getMentionResourceNodes<T extends ReadonlyCanvasNode>(nodeId: string, nodes: readonly T[], connections: readonly ReadonlyCanvasConnection[], binding?: ScopeBinding) {
    const ownInputs = expandGroupResourceNodes(getGenerationResourceNodes(nodeId, nodes, connections, "render", binding), nodes, binding);
    if (ownInputs.length) return ownInputs;
    const node = nodes.find((item) => item.id === nodeId);
    return node && isResourceNode(node, "render", binding) ? [node] : [];
}

export function getGenerationResourceNodes<T extends ReadonlyCanvasNode>(nodeId: string, nodes: readonly T[], connections: readonly ReadonlyCanvasConnection[], mode: "render" | "execute", binding?: ScopeBinding) {
    return connections
        .filter((connection) => connection.toNodeId === nodeId)
        .map((connection) => nodes.find((node) => node.id === connection.fromNodeId))
        .filter((node): node is T => Boolean(node && isCanvasReferenceNode(node, nodes, mode, binding)));
}

function hasGroupResources(node: ReadonlyCanvasNode, nodes: readonly ReadonlyCanvasNode[], mode: "render" | "execute", binding?: ScopeBinding) {
    return node.type === CanvasNodeType.Group && getGroupResourceNodes(node.id, nodes, mode, binding).length > 0;
}

export function isCanvasReferenceNode(node: ReadonlyCanvasNode, nodes: readonly ReadonlyCanvasNode[], mode: "render" | "execute" = "render", binding?: ScopeBinding) {
    return isResourceNode(node, mode, binding) || hasGroupResources(node, nodes, mode, binding);
}

function expandGroupResourceNodes<T extends ReadonlyCanvasNode>(inputNodes: T[], nodes: readonly T[], binding?: ScopeBinding) {
    const resources = inputNodes.flatMap((node) => (node.type === CanvasNodeType.Group ? getGroupResourceNodes(node.id, nodes, "render", binding) : [node]));
    return [...new Map(resources.map((node) => [node.id, node])).values()];
}

export function getGroupResourceNodes<T extends ReadonlyCanvasNode>(groupId: string, nodes: readonly T[], mode: "render" | "execute" = "render", binding?: ScopeBinding) {
    return nodes.filter((node) => node.metadata?.groupId === groupId && isResourceNode(node, mode, binding));
}

function labelResourceNodes(nodes: readonly ReadonlyCanvasNode[], active: boolean, binding?: ScopeBinding) {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
    return nodes.flatMap((node): CanvasResourceReference[] => {
        const resource = readNodeResource(node, "render", binding);
        if (!resource) return [];
        const kind = resource.kind;
        const index = counts[kind]++;
        const label = labelForKind(kind, index);
        return [
            {
                id: node.id,
                nodeId: node.id,
                kind,
                label,
                title: node.title || label,
                previewUrl: kind === "image" ? previewUrlFor(resource.storageKey) : undefined,
                sourceUrl: resource.url,
                storageKey: resource.storageKey,
                signal: resource.signal,
                text: resource.text,
                active,
            },
        ];
    });
}

function labelForKind(kind: CanvasResourceKind, index: number) {
    if (kind === "image") return imageReferenceLabel(index);
    if (kind === "video") return "参考视频" + ` ${index + 1}`;
    if (kind === "audio") return "参考音频" + ` ${index + 1}`;
    return `文本${index + 1}`;
}

function isResourceNode(node: ReadonlyCanvasNode, mode: "render" | "execute" = "render", binding?: ScopeBinding) {
    return Boolean(readNodeResource(node, mode, binding));
}
