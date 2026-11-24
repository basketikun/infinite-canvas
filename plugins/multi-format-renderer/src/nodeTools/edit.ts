import { createElement } from "react";
import { Eye, Pencil } from "lucide-react";
import type { NodeToolContribution } from "@infinite-canvas/plugin-sdk";
import { renderer } from "../nodes/document";
import { formats, formatOf } from "../nodes/format";

export const toggleEdit: NodeToolContribution = {
    resolve: (ctx) => {
        const { node } = ctx;
        if (node.type !== renderer.type) return null;
        const editing = Boolean(node.metadata?.editing);
        return {
            title: editing ? "预览渲染结果" : `编辑 ${formats[formatOf(node)]} 源码`,
            label: editing ? "预览" : "编辑", icon: editing ? createElement(Eye) : createElement(Pencil), active: editing,
            run: () => ctx.transact([{ type: "update_node", id: node.id, metadata: { editing: !editing } }]),
        };
    },
};
