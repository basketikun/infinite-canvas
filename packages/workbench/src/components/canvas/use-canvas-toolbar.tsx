import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { Hand, LocateFixed, MousePointer2, Palette, Puzzle, Redo2, Trash2, Undo2, Upload } from "lucide-react";
import type { PluginMenu, PluginMenuItem } from "@infinite-canvas/plugin-sdk";
import { canvasDeleteNodes, canvasFocusNode, canvasRedo, canvasUndo, commands, menus, panels } from "@infinite-canvas/plugin-sdk/builtin";
import { PluginError } from "@infinite-canvas/shared/plugins";
import type { CanvasSession } from "@workbench/lib/canvas/canvas-session";
import type { CanvasViewController } from "@workbench/lib/canvas/canvas-view";
import { getNodePluginId, listNodeDefinitions } from "@workbench/lib/canvas/node-registry";
import { builtinPlugin } from "@workbench/lib/plugins/registry";
import { hostActions } from "@workbench/lib/canvas/host-actions";
import { getPluginContributions } from "@workbench/lib/plugins/runtime";

export type CanvasToolbarPanel = "appearance" | "extensions" | null;

export function registerCanvasToolbar(session: CanvasSession, view: CanvasViewController, getPanel: () => CanvasToolbarPanel, setPanel: (panel: CanvasToolbarPanel) => void, reportError: (text: string) => void) {
    const signal = AbortSignal.any([session.signal, view.scope.signal]);
    signal.throwIfAborted();
    if (view.scope.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
    const disposers: (() => void)[] = [];
    const release = () => {
        signal.removeEventListener("abort", release);
        for (const dispose of disposers.splice(0).reverse()) dispose();
    };
    const menu: PluginMenu = {
        id: "builtin:canvas-toolbar",
        locations: ["canvas.toolbar"],
        transform: ({ ctx, canvas, target, items }) => {
            if (target.location !== "canvas.toolbar" || session.signal.aborted || view.scope.signal.aborted || canvas.projectId !== session.projectId) return items;
            const snapshot = canvas.getSnapshot();
            const tool = view.getSnapshot().tool;
            const panel = getPanel();
            const options = { scope: canvas.scope, signal: canvas.signal };
            const hasExtensions = listNodeDefinitions().some((definition) => getNodePluginId(definition.type) !== "builtin" && definition.showInCreateMenu !== false)
                || getPluginContributions(panels, ctx.scope).length > 0
                || getPluginContributions(commands, ctx.scope).some(({ item }) => item.locations?.includes("canvas.extensions"))
                || getPluginContributions(menus, ctx.scope).some(({ item, entry }) => !["builtin:canvas-create", "builtin:canvas-command-menus"].includes(entry.id) && item.locations.includes("canvas.extensions"));
            const failed = (error: unknown, text: string) => {
                console.error("[canvas] toolbar", error);
                if (session.signal.aborted || view.scope.signal.aborted || ctx.signal.aborted || canvas.signal.aborted || error instanceof PluginError && ["PLUGIN_INACTIVE", "PLUGIN_SCOPE_CLOSED", "PLUGIN_PROJECT_CHANGED"].includes(error.code)) return;
                reportError(text);
            };
            const defaults: PluginMenuItem[] = [
                { id: "builtin:tool", type: "action", title: tool === "select" ? "选择" : "移动", active: true, icon: tool === "select" ? <MousePointer2 /> : <Hand />, run: () => view.setTool(view.getSnapshot().tool === "select" ? "pan" : "select") },
                { id: "builtin:undo", type: "action", title: "撤销", disabled: !snapshot.canUndo, icon: <Undo2 />, run: () => ctx.commands.execute(canvasUndo, undefined, options).catch((error) => failed(error, "暂时无法撤销，请重试。")) },
                { id: "builtin:redo", type: "action", title: "重做", disabled: !snapshot.canRedo, icon: <Redo2 />, run: () => ctx.commands.execute(canvasRedo, undefined, options).catch((error) => failed(error, "暂时无法重做，请重试。")) },
                { id: "builtin:focus", type: "action", title: "居中聚焦", disabled: !snapshot.selection.nodeIds.length, icon: <LocateFixed />, run: () => {
                    const nodeId = canvas.getSelectedIds()[0];
                    if (nodeId) return ctx.commands.execute(canvasFocusNode, { nodeId }, options).catch((error) => failed(error, "暂时无法定位节点，请重试。"));
                } },
                { id: "builtin:upload", type: "action", title: "上传资产", icon: <Upload />, run: () => hostActions.canvasOpenMediaPicker({ position: view.getCenter() }).catch((error) => failed(error, "暂时无法选择媒体文件，请重试。")) },
                { id: "builtin:create:separator", type: "separator" },
                { id: "builtin:extensions", type: "action", title: "扩展节点与工具", icon: <Puzzle />, hidden: !hasExtensions, active: panel === "extensions", run: () => setPanel(getPanel() === "extensions" ? null : "extensions") },
            ];
            const trailing: PluginMenuItem[] = [
                { id: "builtin:appearance:separator", type: "separator" },
                { id: "builtin:appearance", type: "action", title: "画布外观", icon: <Palette />, active: panel === "appearance", run: () => setPanel(getPanel() === "appearance" ? null : "appearance") },
                { id: "builtin:selection:separator", type: "separator", hidden: !snapshot.selection.nodeIds.length },
                { id: "builtin:delete", type: "action", title: "删除选中", icon: <Trash2 />, hidden: !snapshot.selection.nodeIds.length, disabled: !snapshot.selection.nodeIds.length, danger: true, run: () => ctx.commands.execute(canvasDeleteNodes, { nodeIds: [...canvas.getSelectedIds()] }, options).catch((error) => failed(error, "暂时无法删除选中内容，请重试。")) },
            ];
            return [...defaults, ...items, ...trailing];
        },
    };
    try {
        disposers.push(builtinPlugin.extensions.contribute(menus, { id: menu.id, value: menu }));
        signal.addEventListener("abort", release, { once: true });
        if (signal.aborted) release();
    } catch (error) {
        release();
        throw error;
    }
    return release;
}

export function useCanvasToolbar(session: CanvasSession, view: CanvasViewController, getPanel: () => CanvasToolbarPanel, setPanel: (panel: CanvasToolbarPanel) => void) {
    const current = useRef({ getPanel, setPanel });
    useSyncExternalStore(view.subscribe, view.getSnapshot);
    useLayoutEffect(() => { current.current = { getPanel, setPanel }; });
    useLayoutEffect(() => registerCanvasToolbar(session, view, () => current.current.getPanel(), (panel) => current.current.setPanel(panel), (text) => { toast.error(text, workbenchMessageOptions.error); }), [session, view]);
}
