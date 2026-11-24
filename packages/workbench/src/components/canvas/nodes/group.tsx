import { useSyncExternalStore } from "react";
import { Group } from "lucide-react";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";

export function GroupContent({ ctx }: CanvasNodeContentProps) {
    const { node, theme } = ctx;
    const snapshot = useSyncExternalStore(ctx.subscribe, ctx.getSnapshot);
    const childCount = snapshot.nodes.filter((item) => item.metadata?.groupId === node.id).length;
    return (
        <div className="pointer-events-none flex h-full w-full p-3">
            <div className="flex h-7 max-w-full items-center gap-2 px-1 text-xs font-medium" style={{ color: theme.node.text }}>
                <Group className="size-3.5 shrink-0" style={{ color: theme.node.muted }} />
                <span className="truncate">{node.title || "组"}</span>
                <span className="shrink-0 text-[11px] font-normal" style={{ color: theme.node.muted }}>
                    {`${childCount} 个节点`}
                </span>
            </div>
        </div>
    );
}
