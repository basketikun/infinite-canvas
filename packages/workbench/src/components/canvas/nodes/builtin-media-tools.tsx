import { Download, FolderPlus, Info, Music2, RefreshCw, Trash2, Video } from "lucide-react";
import type { NodeToolContribution } from "@infinite-canvas/plugin-sdk";
import { canvasApply, nodeRetry, nodeTools } from "@infinite-canvas/plugin-sdk/builtin";
import { CanvasNodeType, isWebVideoTaskOwner } from "@infinite-canvas/shared/canvas/schema/canvas";
import { builtinPlugin } from "@workbench/lib/plugins/registry";
import { hostActions, runNodeCommand } from "@workbench/lib/canvas/host-actions";
import { hasNodeMedia } from "@workbench/lib/media-source";
import { models } from "@workbench/services/api/models/runtime";

export function registerBuiltinMediaTools() {
    const disposers = [CanvasNodeType.Video, CanvasNodeType.Audio].flatMap((kind) => {
        const tools: Array<[string, NodeToolContribution["resolve"]]> = [
            ["info", (ctx) => ({ title: "查看节点信息", label: "信息", icon: <Info className="size-4" />, run: () => hostActions.nodeOpenInfo({ nodeId: ctx.node.id }) })],
            ["delete", (ctx) => ({ title: "移除节点", label: "删除", icon: <Trash2 className="size-4" />, danger: true, run: runNodeCommand(ctx, canvasApply, { ops: [{ type: "delete_node", ids: [ctx.node.id] }] }) })],
        ];
        if (kind === CanvasNodeType.Video) tools.push(["query-task", (ctx) => {
            const task = ctx.node.metadata?.webVideoTask;
            if (!task || models.tasks || !ctx.scope.projectId || !isWebVideoTaskOwner(ctx.scope.projectId, ctx.node, task) || (!task.paused && ctx.node.metadata?.status === "loading")) return null;
            return { title: "使用任务 ID 查询视频生成状态", label: "获取任务状态", icon: <RefreshCw className="size-4" />, run: runNodeCommand(ctx, nodeRetry, { nodeId: ctx.node.id }) };
        }]);
        tools.push(["retry", (ctx) => ctx.node.metadata?.status === "error" && !ctx.node.metadata.webVideoTask
            ? { title: "重新生成", label: "重试", icon: <RefreshCw className="size-4" />, run: runNodeCommand(ctx, nodeRetry, { nodeId: ctx.node.id }) } : null]);
        if (kind === CanvasNodeType.Video) tools.push(["save-asset", (ctx) => hasNodeMedia(ctx.node)
            ? { title: "加入我的资产", label: "存资产", icon: <FolderPlus className="size-4" />, run: () => hostActions.nodeSaveAsset({ nodeId: ctx.node.id }) } : null]);
        tools.push(["download", (ctx) => hasNodeMedia(ctx.node)
            ? { title: kind === CanvasNodeType.Audio ? "下载音频" : "下载视频", label: "下载", icon: <Download className="size-4" />, run: () => hostActions.nodeDownloadResource({ nodeId: ctx.node.id }) } : null]);
        const name = kind === CanvasNodeType.Audio ? "音频" : "视频";
        tools.push(["replace", (ctx) => ({ title: `${hasNodeMedia(ctx.node) ? "替换" : "上传"}${name}`, label: `${hasNodeMedia(ctx.node) ? "替换" : "上传"}${name}`, icon: kind === CanvasNodeType.Audio ? <Music2 className="size-4" /> : <Video className="size-4" />, run: () => hostActions.canvasOpenMediaPicker({ nodeId: ctx.node.id }) })]);
        return tools.map(([id, resolve]) => builtinPlugin.extensions.contribute(nodeTools, {
            id: `builtin:${kind}-${id}`,
            value: { resolve: (ctx) => ctx.node.type === kind ? resolve(ctx) : null },
        }));
    });
    return () => { for (const dispose of disposers) dispose(); };
}
