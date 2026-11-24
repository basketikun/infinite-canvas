import { useSyncExternalStore } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@infinite-canvas/plugin-sdk/ui/tooltip";
import { toast } from "sonner";
import { Compass, Focus, HelpCircle } from "lucide-react";
import type { PluginMenu, PluginMenuItemContentProps } from "@infinite-canvas/plugin-sdk";
import { menus } from "@infinite-canvas/plugin-sdk/builtin";
import { PluginError } from "@infinite-canvas/shared/plugins";
import type { CanvasSession } from "@workbench/lib/canvas/canvas-session";
import type { CanvasViewController } from "@workbench/lib/canvas/canvas-view";
import { builtinPlugin } from "@workbench/lib/plugins/registry";
import { hostActions, hostContext } from "@workbench/lib/canvas/host-actions";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";

function CanvasZoomScale({ ctx, canvas, theme, setZoom }: PluginMenuItemContentProps & { setZoom: (scale: number) => void }) {
    const scale = useSyncExternalStore(canvas.subscribe, canvas.getSnapshot).viewport.k;
    const failed = (error: unknown) => {
        console.error("[canvas] viewport controls", error);
        if (!ctx.signal.aborted && !canvas.signal.aborted && !(error instanceof PluginError && ["PLUGIN_INACTIVE", "PLUGIN_SCOPE_CLOSED", "PLUGIN_PROJECT_CHANGED"].includes(error.code))) toast.error("暂时无法调整画布视图，请重试。", workbenchMessageOptions.error);
    };
    return <>
        <Tooltip>
            <TooltipTrigger asChild data-canvas-no-zoom><input
                type="range"
                min="5"
                max="500"
                step="1"
                value={Math.round(scale * 100)}
                className="w-24"
                style={{ accentColor: theme.node.activeStroke }}
                onChange={(event) => { try { setZoom(Number(event.target.value) / 100); } catch (error) { failed(error); } }}
                aria-label="放大/缩小画布"
            /></TooltipTrigger>
            <TooltipContent side="top" className="z-[1100]" data-canvas-no-zoom>放大/缩小画布</TooltipContent>
        </Tooltip>
        <span className="w-10 text-right text-xs tabular-nums" style={{ color: theme.node.muted }}>{Math.round(scale * 100)}%</span>
    </>;
}

export function registerCanvasZoomControls(session: CanvasSession, view: CanvasViewController, getShortcutsOpen: () => boolean) {
    const signal = AbortSignal.any([session.signal, view.scope.signal]);
    signal.throwIfAborted();
    if (view.scope.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
    const setZoom = (scale: number) => view.setZoom(scale, hostContext(session).canvas!);
    const Scale = (props: PluginMenuItemContentProps) => <CanvasZoomScale {...props} setZoom={setZoom} />;
    const menu: PluginMenu = {
        id: "builtin:canvas-zoom-controls",
        locations: ["canvas.zoomControls"],
        transform: ({ canvas, items }) => {
            if (signal.aborted || canvas.projectId !== session.projectId) return items;
            const { miniMapOpen } = view.getSnapshot();
            return [
                { id: "builtin:zoom:minimap", type: "action", title: miniMapOpen ? "关闭小地图" : "打开小地图", active: miniMapOpen, icon: <Compass className="size-4" />, run: () => view.setMiniMap(!view.getSnapshot().miniMapOpen) },
                { id: "builtin:zoom:reset", type: "action", title: "重置视图", icon: <Focus className="size-4" />, run: () => view.resetViewport(hostContext(session).canvas!) },
                { id: "builtin:zoom:scale", type: "content", title: "画布缩放", Content: Scale },
                { id: "builtin:zoom:shortcuts", type: "action", title: "快捷键", active: getShortcutsOpen(), icon: <HelpCircle className="size-4" />, run: () => hostActions.canvasOpenShortcuts() },
                ...items,
            ];
        },
    };
    const dispose = builtinPlugin.extensions.contribute(menus, { id: menu.id, value: menu });
    const release = () => {
        signal.removeEventListener("abort", release);
        dispose();
    };
    signal.addEventListener("abort", release, { once: true });
    if (signal.aborted) release();
    return release;
}
