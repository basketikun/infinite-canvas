import { FileText, FolderPlus, Group, Image as ImageIcon, Minus, Music2, Plus, Video } from "lucide-react";

import { NODE_SPECS } from "@infinite-canvas/shared/canvas/schema/node-specs";
import { registerNodeDefinitions } from "@workbench/lib/canvas/node-registry";
import { CanvasNodeType } from "@infinite-canvas/shared/canvas/schema/canvas";
import type { CanvasNodeDefinition, CanvasNodeResource, ReadonlyCanvasNode } from "@infinite-canvas/plugin-sdk";
import { canvasApply, nodeResources, nodeTools } from "@infinite-canvas/plugin-sdk/builtin";
import { hostActions, runNodeCommand } from "@workbench/lib/canvas/host-actions";
import { builtinPlugin } from "@workbench/lib/plugins/registry";
import { TextContent } from "./text";
import { ImageContent } from "./image";
import { MediaContent } from "./media";
import { GroupContent } from "./group";
import { registerBuiltinImageTools } from "./builtin-image-tools";
import { registerBuiltinMediaTools } from "./builtin-media-tools";
import { registerBuiltinNodeTools } from "./builtin-node-tools";
import { hasNodeMedia } from "@workbench/lib/media-source";

const iconClass = "size-4";

const BUILTIN_DEFINITIONS: CanvasNodeDefinition[] = ([
    { type: CanvasNodeType.Text, title: "文本", description: "脚本、广告词、品牌文案", icon: <FileText className={iconClass} />, Content: TextContent, contentOverflow: "visible", useBuiltinPanel: { mode: "text" }, autoOpenPanel: true },
    { type: CanvasNodeType.Image, title: "图片", description: "海报、插画、产品图", icon: <ImageIcon className={iconClass} />, Content: ImageContent, contentOverflow: "visible", appearance: (node: ReadonlyCanvasNode) => node.metadata?.storageKey || node.metadata?.content ? { background: "transparent", border: "none", bottomGradient: false } : { background: "fill", border: "normal", bottomGradient: true }, minimapColor: "#10b981", keepAspectRatio: (node: ReadonlyCanvasNode) => !node.metadata?.freeResize, useBuiltinPanel: { mode: "image" } },
    { type: CanvasNodeType.Video, title: "视频", description: "短片、动态广告、动画", icon: <Video className={iconClass} />, Content: MediaContent, appearance: (node: ReadonlyCanvasNode) => ({ background: hasNodeMedia(node) ? "transparent" : "fill", border: "normal", bottomGradient: !hasNodeMedia(node) }), minimapColor: "#f97316", keepAspectRatio: () => true, useBuiltinPanel: { mode: "video" } },
    { type: CanvasNodeType.Audio, title: "音频", description: "配音、音乐、音效", icon: <Music2 className={iconClass} />, Content: MediaContent, appearance: (node: ReadonlyCanvasNode) => ({ background: "fill", border: "normal", bottomGradient: !hasNodeMedia(node) }), minimapColor: "#a855f7", useBuiltinPanel: { mode: "audio" } },
    { type: CanvasNodeType.Group, title: "组", description: "把多个节点归为一组", icon: <Group className={iconClass} />, Content: GroupContent, minimapColor: "#94a3b8" },
] satisfies Omit<CanvasNodeDefinition, "defaultSize">[]).map((def) => {
    const spec = NODE_SPECS[def.type];
    return { ...def, title: spec.title, defaultSize: { width: spec.width, height: spec.height }, defaultMetadata: spec.metadata };
});

let registered = false;
export function registerBuiltinNodes() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions(BUILTIN_DEFINITIONS);
    registerBuiltinImageTools();
    registerBuiltinMediaTools();
    registerBuiltinNodeTools();
    for (const kind of ["text", "image", "video", "audio"] as const) builtinPlugin.extensions.contribute(nodeResources, {
        id: `builtin:${kind}-resource`,
        value: { resolve: (node, slotId): CanvasNodeResource | null => {
            if (node.type !== kind) return null;
            if (slotId !== undefined) {
                if (kind !== "image") return null;
                const image = node.metadata?.images?.find((item) => item.id === slotId);
                return image?.storageKey || image?.content ? { kind, storageKey: image.storageKey, url: image.content } : null;
            }
            if (kind === "text") return node.metadata?.content || node.metadata?.prompt ? { kind, text: node.metadata.content || node.metadata.prompt } : null;
            return node.metadata?.storageKey || node.metadata?.content ? { kind, storageKey: node.metadata.storageKey, url: node.metadata.content } : null;
        } },
    });
    builtinPlugin.extensions.contribute(nodeTools, { id: "builtin:text-save-asset", value: { resolve: (ctx) => ctx.node.type === CanvasNodeType.Text ? { title: "加入我的资产", label: "存资产", icon: <FolderPlus className={iconClass} />, run: () => hostActions.nodeSaveAsset({ nodeId: ctx.node.id }) } : null } });
    for (const direction of ["decrease", "increase"] as const) builtinPlugin.extensions.contribute(nodeTools, { id: `builtin:text-${direction}-font`, value: { resolve: (ctx) => {
        if (ctx.node.type !== CanvasNodeType.Text) return null;
        const decrease = direction === "decrease";
        const size = ctx.node.metadata?.fontSize || 14;
        return { title: decrease ? "减小字号" : "增大字号", label: decrease ? "缩小" : "放大", icon: decrease ? <Minus className={iconClass} /> : <Plus className={iconClass} />, run: runNodeCommand(ctx, canvasApply, { ops: [{ type: "update_node", id: ctx.node.id, metadata: { fontSize: decrease ? Math.max(10, size - 2) : Math.min(32, size + 2) } }] }) };
    } } });
}
