import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { Music2, RefreshCw, Video } from "lucide-react";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";
import { nodeRetry } from "@infinite-canvas/plugin-sdk/builtin";
import { CanvasNodeType } from "@infinite-canvas/shared/canvas/schema/canvas";
import { getPluginErrorMessage } from "@infinite-canvas/shared/plugins";
import { MediaPlayer } from "@workbench/components/media-player";
import { readNodeResource } from "@workbench/lib/canvas/node-registry";

export function MediaContent({ ctx }: CanvasNodeContentProps) {
    const { node, theme } = ctx;
    if (node.metadata?.status === "loading") return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.activeStroke }}>
            <div className="size-10 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />
            <span className="text-[10px] tracking-[0.2em]">生成中</span>
        </div>
    );
    if (node.metadata?.status === "error") return (
        <div className="flex max-w-[260px] flex-col items-center gap-3 px-5 text-center">
            <div className="text-xs leading-5 text-red-300">{node.metadata.errorDetails || "生成失败"}</div>
            <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onClick={(event) => {
                    event.stopPropagation();
                    void ctx.commands.execute(nodeRetry, { nodeId: node.id }, { scope: ctx.scope }).catch((error) => {
                        if (!ctx.scope.signal.aborted) toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error);
                    });
                }}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <RefreshCw className="size-3.5" />
                {node.metadata.tasks?.length ? "查询原任务" : "重试"}
            </button>
        </div>
    );
    const video = node.type === CanvasNodeType.Video;
    const resource = readNodeResource(node, "render", ctx.scope);
    if (!resource || (resource.kind !== "video" && resource.kind !== "audio") || !(resource.storageKey || resource.url)) return (
        <div className={`flex h-full w-full flex-col items-center justify-center ${video ? "gap-3" : "gap-2"}`} style={{ color: theme.node.placeholder }}>
            {video ? <Video className="size-7 opacity-35" /> : <Music2 className="size-7 opacity-35" />}
            <span className="text-sm">{video ? "空视频节点" : "空音频节点"}</span>
        </div>
    );
    const source = { kind: resource.kind, storageKey: resource.storageKey, url: resource.url, signal: resource.signal };
    const canvas = { projectId: ctx.getSnapshot().projectId, nodeId: node.id, contributionId: resource.contributionId };
    if (resource.kind === "video") return <MediaPlayer source={source} read={ctx.media.read} canvas={canvas} className="h-full w-full rounded-[18px] bg-black object-contain" />;
    return (
        <div className="flex h-full w-full flex-col justify-center gap-3 px-4" style={{ background: theme.node.fill, color: theme.node.text }}>
            <div className="flex min-w-0 items-center gap-2 text-sm opacity-70">
                <Music2 className="size-4 shrink-0" />
                <span className="truncate">音频</span>
            </div>
            <MediaPlayer source={source} read={ctx.media.read} canvas={canvas} className="w-full" />
        </div>
    );
}
