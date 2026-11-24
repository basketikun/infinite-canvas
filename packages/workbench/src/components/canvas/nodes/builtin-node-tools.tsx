import { Hand, Info, MousePointerClick, RefreshCw, Trash2, Ungroup } from "lucide-react";
import type { NodeToolContribution } from "@infinite-canvas/plugin-sdk";
import { canvasApply, canvasDeleteNodes, canvasUngroupNodes, nodeRetry, nodeTools } from "@infinite-canvas/plugin-sdk/builtin";
import { CanvasNodeType } from "@infinite-canvas/shared/canvas/schema/canvas";
import { getNodeDefinition } from "@workbench/lib/canvas/node-registry";
import { hostActions, runNodeCommand } from "@workbench/lib/canvas/host-actions";
import { builtinPlugin } from "@workbench/lib/plugins/registry";

export function registerBuiltinNodeTools() {
    const tools: Array<[string, NodeToolContribution["resolve"]]> = [
        ["info", (ctx) => ({ title: "查看节点信息", label: "信息", icon: <Info className="size-4" />, run: () => hostActions.nodeOpenInfo({ nodeId: ctx.node.id }) })],
        ["ungroup", (ctx) => ctx.node.type === CanvasNodeType.Group && getNodeDefinition(ctx.node.type) ? { title: "取消节点分组", label: "解散组", icon: <Ungroup className="size-4" />, run: runNodeCommand(ctx, canvasUngroupNodes, { nodeIds: [ctx.node.id] }) } : null],
        ["delete", (ctx) => ({ title: "移除节点", label: "删除", icon: <Trash2 className="size-4" />, danger: true, run: runNodeCommand(ctx, canvasDeleteNodes, { nodeIds: [ctx.node.id] }) })],
        ["retry", (ctx) => ctx.node.metadata?.status === "error" && getNodeDefinition(ctx.node.type) ? { title: "重新生成", label: "重试", icon: <RefreshCw className="size-4" />, run: runNodeCommand(ctx, nodeRetry, { nodeId: ctx.node.id }) } : null],
        ["interaction-toggle", (ctx) => {
            const definition = getNodeDefinition(ctx.node.type);
            if (!definition?.interactionToggle || !ctx.node.metadata?.content || definition.forceInteractive?.(ctx.node)) return null;
            const interactive = Boolean(ctx.node.metadata.interactive);
            return {
                title: interactive ? "当前：交互中。点击切回「移动」——拖动可移动节点" : "当前：可移动。点击切到「交互」——可操作节点内容（如转动全景）",
                label: interactive ? "移动" : "交互",
                icon: interactive ? <Hand className="size-4" /> : <MousePointerClick className="size-4" />,
                active: interactive,
                run: runNodeCommand(ctx, canvasApply, { ops: [{ type: "update_node", id: ctx.node.id, metadata: { interactive: !interactive } }] }),
            };
        }],
    ];
    const disposers = tools.map(([id, resolve]) => builtinPlugin.extensions.contribute(nodeTools, {
        id: `builtin:${id}`,
        value: { resolve: (ctx) => ctx.node.type === CanvasNodeType.Image || ctx.node.type === CanvasNodeType.Video || ctx.node.type === CanvasNodeType.Audio ? null : resolve(ctx) },
    }));
    return () => { for (const dispose of disposers) dispose(); };
}
