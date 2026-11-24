import { Brush, Camera, Upload, Copy, Download, FileText, FolderPlus, Grid2x2, Info, Lock, LockOpen, Maximize2, RefreshCw, Scissors, Trash2, ZoomIn } from "lucide-react";
import type { NodeToolContribution } from "@infinite-canvas/plugin-sdk";
import { canvasApply, nodePreviewImage, nodeRetry, nodeTools } from "@infinite-canvas/plugin-sdk/builtin";
import { CanvasNodeType } from "@infinite-canvas/shared/canvas/schema/canvas";
import { builtinPlugin } from "@workbench/lib/plugins/registry";
import { hasNodeMedia } from "@workbench/lib/media-source";
import { readNodeResource } from "@workbench/lib/canvas/node-registry";
import { hostActions, runNodeCommand } from "@workbench/lib/canvas/host-actions";

export function registerBuiltinImageTools() {
    const tools: Array<[string, NodeToolContribution["resolve"]]> = [
        ["info", (ctx) => ({ title: "查看节点信息", label: "信息", icon: <Info className="size-4" />, run: () => hostActions.nodeOpenInfo({ nodeId: ctx.node.id }) })],
        ["delete", (ctx) => ({ title: "移除节点", label: "删除", icon: <Trash2 className="size-4" />, danger: true, run: runNodeCommand(ctx, canvasApply, { ops: [{ type: "delete_node", ids: [ctx.node.id] }] }) })],
        ["retry", (ctx) => ctx.node.metadata?.status === "error" ? { title: "重新生成", label: "重试", icon: <RefreshCw className="size-4" />, run: runNodeCommand(ctx, nodeRetry, { nodeId: ctx.node.id }) } : null],
        ["save-asset", (ctx) => readNodeResource(ctx.node, "render", ctx.scope)?.kind === "image" ? { title: "加入我的资产", label: "存资产", icon: <FolderPlus className="size-4" />, run: () => hostActions.nodeSaveAsset({ nodeId: ctx.node.id }) } : null],
        ["download", (ctx) => readNodeResource(ctx.node, "render", ctx.scope)?.kind === "image" ? { title: "下载图片", label: "下载", icon: <Download className="size-4" />, run: () => hostActions.nodeDownloadResource({ nodeId: ctx.node.id }) } : null],
        ["copy-prompt", (ctx) => readNodeResource(ctx.node, "render", ctx.scope)?.kind === "image" ? { title: "复制生成该图片的提示词", label: "复制提示词", icon: <Copy className="size-4" />, run: () => hostActions.nodeCopyPrompt({ nodeId: ctx.node.id }) } : null],
        ["reverse-prompt", (ctx) => readNodeResource(ctx.node, "render", ctx.scope)?.kind === "image" ? { title: "创建反推提示词的文本节点", label: "反推提示词", icon: <FileText className="size-4" />, run: () => hostActions.nodeCreateImageReversePrompt({ nodeId: ctx.node.id }) } : null],
        ["replace", (ctx) => ({ title: `${hasNodeMedia(ctx.node) ? "替换" : "上传"}图片`, label: `${hasNodeMedia(ctx.node) ? "替换" : "上传"}图片`, icon: <Upload className="size-4" />, run: () => hostActions.canvasOpenMediaPicker({ nodeId: ctx.node.id }) })],
        ["resize", (ctx) => readNodeResource(ctx.node, "render", ctx.scope)?.kind === "image" ? {
            title: ctx.node.metadata?.freeResize ? "切换为等比缩放" : "切换为自由比例",
            label: ctx.node.metadata?.freeResize ? "自由比例" : "锁比例",
            icon: ctx.node.metadata?.freeResize ? <LockOpen className="size-4" /> : <Lock className="size-4" />,
            active: Boolean(ctx.node.metadata?.freeResize), defaultVisible: false,
            run: () => hostActions.nodeSetImageFreeResize({ nodeId: ctx.node.id, freeResize: !ctx.node.metadata?.freeResize }),
        } : null],
        ["mask", (ctx) => readNodeResource(ctx.node, "render", ctx.scope)?.kind === "image" ? { title: "添加蒙版遮罩后局部修改", label: "局部编辑", icon: <Brush className="size-4" />, run: () => hostActions.nodeOpenImageEditor({ nodeId: ctx.node.id, tool: "mask" }) } : null],
        ["crop", (ctx) => readNodeResource(ctx.node, "render", ctx.scope)?.kind === "image" ? { title: "裁剪并生成新节点", label: "裁剪", icon: <Scissors className="size-4" />, run: () => hostActions.nodeOpenImageEditor({ nodeId: ctx.node.id, tool: "crop" }) } : null],
        ["split", (ctx) => readNodeResource(ctx.node, "render", ctx.scope)?.kind === "image" ? { title: "按行列切分图片", label: "切图", icon: <Grid2x2 className="size-4" />, run: () => hostActions.nodeOpenImageEditor({ nodeId: ctx.node.id, tool: "split" }) } : null],
        ["upscale", (ctx) => readNodeResource(ctx.node, "render", ctx.scope)?.kind === "image" ? { title: "放大图片分辨率", label: "放大", icon: <ZoomIn className="size-4" />, run: () => hostActions.nodeOpenImageEditor({ nodeId: ctx.node.id, tool: "upscale" }) } : null],
        ["angle", (ctx) => readNodeResource(ctx.node, "render", ctx.scope)?.kind === "image" ? { title: "生成角度", label: "多角度", icon: <Camera className="size-4" />, defaultVisible: false, run: () => hostActions.nodeOpenImageEditor({ nodeId: ctx.node.id, tool: "angle" }) } : null],
        ["view", (ctx) => readNodeResource(ctx.node, "render", ctx.scope)?.kind === "image" ? { title: "查看图片详情", label: "查看大图", icon: <Maximize2 className="size-4" />, run: runNodeCommand(ctx, nodePreviewImage, { nodeId: ctx.node.id }) } : null],
    ];
    const disposers = tools.map(([id, resolve]) => builtinPlugin.extensions.contribute(nodeTools, {
        id: `builtin:image-${id}`,
        value: { resolve: (ctx) => ctx.node.type === CanvasNodeType.Image ? resolve(ctx) : null },
    }));
    return () => { for (const dispose of disposers) dispose(); };
}
