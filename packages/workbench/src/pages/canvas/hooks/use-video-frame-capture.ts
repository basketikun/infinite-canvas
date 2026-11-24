import { createElement, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { BetweenHorizontalStart, GalleryHorizontalEnd, GalleryHorizontal } from "lucide-react";
import { menus } from "@infinite-canvas/plugin-sdk/builtin";
import type { CanvasSession } from "@workbench/lib/canvas/canvas-session";
import { readNodeResource } from "@workbench/lib/canvas/node-registry";
import { hostActions } from "@workbench/lib/canvas/host-actions";
import { registerVideoFrameCommand, requireVideoFrameSource } from "@workbench/lib/canvas/video-frame-command";
import { builtinPlugin } from "@workbench/lib/plugins/registry";
import { registerChangedCanvasAssets } from "@workbench/lib/canvas/register-canvas-asset";

type ReadPlayhead = (nodeId: string, resource: { storageKey?: string; url?: string; contributionId: string }) => number;

export function registerVideoFrameCapture(session: CanvasSession, getCurrentTime: ReadPlayhead, reportSuccess: () => void, registerAssets = false) {
    const disposeCommand = registerVideoFrameCommand(session);
    const disposeMenu = builtinPlugin.extensions.contribute(menus, {
        id: "builtin:video-capture",
        value: {
            id: "builtin:video-capture",
            locations: ["canvas.nodeContext"],
            transform: ({ ctx, canvas, target, items }) => {
                if (target.location !== "canvas.nodeContext" || session.signal.aborted || canvas.projectId !== session.projectId) return items;
                const node = canvas.getNodes().find((item) => item.id === target.nodeId);
                const resource = node && readNodeResource(node, "render", ctx.scope);
                if (resource?.kind !== "video" || !(resource.storageKey || resource.url)) return items;
                return [
                    ...([["first", "截取首帧", BetweenHorizontalStart], ["last", "截取尾帧", GalleryHorizontalEnd], ["current", "截取当前帧", GalleryHorizontal]] as const).map(([position, title, icon]) => ({
                        id: `builtin:capture:${position}`,
                        type: "action" as const,
                        title,
                        icon: createElement(icon),
                        run: async () => {
                            requireVideoFrameSource(resource);
                            const current = canvas.getNodes().find((item) => item.id === target.nodeId);
                            const video = requireVideoFrameSource(current ? readNodeResource(current, "execute", ctx.scope) : null, resource);
                            const input = position === "current"
                                ? { nodeId: target.nodeId, position, currentTime: getCurrentTime(target.nodeId, video) }
                                : { nodeId: target.nodeId, position };
                            const before = registerAssets ? canvas.getNodes() : undefined;
                            const snapshot = await hostActions.nodeCaptureVideoFrame(input, resource.signal);
                            requireVideoFrameSource(resource);
                            if (before) registerChangedCanvasAssets(before, snapshot.nodes);
                            reportSuccess();
                        },
                    })),
                    { id: "builtin:capture:separator", type: "separator" },
                    ...items,
                ];
            },
        },
    });
    return () => { disposeMenu(); disposeCommand(); };
}

export function useVideoFrameCapture(session: CanvasSession, getCurrentTime: ReadPlayhead) {
    const current = useRef(getCurrentTime);
    useLayoutEffect(() => { current.current = getCurrentTime; });
    useLayoutEffect(() => registerVideoFrameCapture(session, (nodeId, resource) => current.current(nodeId, resource), () => { toast.success("已生成图片节点", workbenchMessageOptions.success); }), [session]);
}
