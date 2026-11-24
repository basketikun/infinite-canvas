import type { NodeResourceContribution } from "@infinite-canvas/plugin-sdk";

export const panoramaResource: NodeResourceContribution = {
    resolve: (node, slotId) => slotId === undefined && node.type === "panorama:viewer" && (node.metadata?.storageKey || node.metadata?.content) ? { kind: "image", storageKey: node.metadata.storageKey, url: node.metadata.content } : null,
};
