import { createElement } from "react";
import { RefreshCw } from "lucide-react";
import type { NodeToolContribution } from "@infinite-canvas/plugin-sdk";

export const reset: NodeToolContribution = {
    resolve: (ctx) => ctx.node.type === "panorama:viewer" && (ctx.node.metadata?.storageKey || ctx.node.metadata?.content) ? {
        title: "清空当前全景图，重新上传", label: "换图", icon: createElement(RefreshCw),
        run: () => ctx.transact([{ type: "update_node", id: ctx.node.id, metadata: { content: "", storageKey: undefined } }]),
    } : null,
};
