import type { NodeResourceContribution } from "@infinite-canvas/plugin-sdk";
import { renderer } from "../nodes/document";
import { formatOf } from "../nodes/format";

export const markdownResource: NodeResourceContribution = {
    resolve: (node, slotId) => slotId === undefined && node.type === renderer.type && formatOf(node) === "markdown" ? { kind: "text", text: node.metadata?.content } : null,
};
