import { FileText } from "lucide-react";
import type { CanvasNodeDefinition } from "@infinite-canvas/plugin-sdk";
import { Textarea } from "@infinite-canvas/plugin-sdk/ui/textarea";

// 自定义节点；颜色沿用当前画布主题，面板只编辑本节点。
export const note: CanvasNodeDefinition = {
    type: "template:note",
    title: "模板笔记",
    icon: <FileText size={16} />,
    description: "编辑一段可连接到下游的文字",
    defaultSize: { width: 240, height: 120 },
    defaultMetadata: { content: "" },
    Content: ({ ctx }) => <p style={{ color: ctx.theme.node.text }}>{ctx.node.metadata?.content || "双击编辑笔记"}</p>,
    Panel: ({ ctx, onClose }) => <div data-canvas-no-zoom>
        <Textarea value={ctx.node.metadata?.content ?? ""} onChange={({ currentTarget }) => void ctx.updateMetadata({ content: currentTarget.value }).catch((error) => { if (!ctx.scope.signal.aborted) console.error("[template] save note", error); })} />
        <button type="button" onClick={onClose}>完成</button>
    </div>,
    onDoubleClick: (ctx) => { ctx.openPanel(); return true; },
};
