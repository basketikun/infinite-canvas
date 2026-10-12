import { nanoid } from "nanoid";

import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasWorkflowTemplate } from "@/types/canvas-workflow-template";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export function buildWorkflowTemplate(title: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasWorkflowTemplate {
    return {
        id: nanoid(),
        title: title.trim(),
        createdAt: new Date().toISOString(),
        nodes: nodes.map((node) => graphOnlyNode(node)),
        connections: structuredClone(connections),
    };
}

export function instantiateWorkflowTemplate(template: CanvasWorkflowTemplate): Partial<CanvasProject> {
    const nodeIds = new Map(template.nodes.map((node) => [node.id, nanoid()]));
    const nodes = template.nodes.map((source) => {
        const node = structuredClone(source);
        const textIds = new Map((node.metadata?.texts || []).map((item) => [item.id, nanoid()]));
        const imageIds = new Map((node.metadata?.images || []).map((item) => [item.id, nanoid()]));
        return {
            ...node,
            id: nodeIds.get(source.id) || nanoid(),
            metadata: node.metadata ? {
                ...node.metadata,
                ...(node.metadata.groupId && nodeIds.has(node.metadata.groupId) ? { groupId: nodeIds.get(node.metadata.groupId) } : {}),
                ...(node.metadata.texts ? { texts: node.metadata.texts.map((item) => ({ ...item, id: textIds.get(item.id) || nanoid() })) } : {}),
                ...(node.metadata.primaryTextId ? { primaryTextId: textIds.get(node.metadata.primaryTextId) || undefined } : {}),
                ...(node.metadata.images ? { images: node.metadata.images.map((item) => ({ ...item, id: imageIds.get(item.id) || nanoid() })) } : {}),
                ...(node.metadata.primaryImageId ? { primaryImageId: imageIds.get(node.metadata.primaryImageId) || undefined } : {}),
                videoTaskId: undefined,
            } : undefined,
        };
    });
    return {
        title: template.title,
        nodes,
        connections: template.connections.flatMap((connection) => {
            const fromNodeId = nodeIds.get(connection.fromNodeId);
            const toNodeId = nodeIds.get(connection.toNodeId);
            return fromNodeId && toNodeId ? [{ ...connection, id: nanoid(), fromNodeId, toNodeId }] : [];
        }),
        chatSessions: [],
        activeChatId: null,
    };
}

function graphOnlyNode(node: CanvasNodeData): CanvasNodeData {
    const cloned = structuredClone(node);
    const metadata = cloned.metadata;
    if (!metadata) return cloned;
    if (cloned.type === CanvasNodeType.Text || cloned.type === CanvasNodeType.Skill) {
        cloned.metadata = { ...metadata, content: "" };
        delete cloned.metadata.texts;
        delete cloned.metadata.primaryTextId;
        delete cloned.metadata.status;
        delete cloned.metadata.errorDetails;
        return cloned;
    }
    const mediaNode = cloned.type === CanvasNodeType.Image || cloned.type === CanvasNodeType.Video || cloned.type === CanvasNodeType.Audio;
    if (mediaNode && (metadata.storageKey || isTransientMediaUrl(metadata.content))) metadata.content = cloned.type === CanvasNodeType.Image ? "" : undefined;
    if (metadata.images) metadata.images = metadata.images.map((image) => ({ ...image, content: image.storageKey || isTransientMediaUrl(image.content) ? "" : image.content }));
    metadata.videoTaskId = undefined;
    return cloned;
}

function isTransientMediaUrl(value?: string) {
    return Boolean(value && (/^(?:data:|blob:)/i.test(value)));
}
