import { useLayoutEffect } from "react";
import { useNavigate, type NavigateFunction } from "react-router-dom";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { Home, Images, Redo2, Undo2 } from "lucide-react";
import type { PluginMenuItem } from "@infinite-canvas/plugin-sdk";
import { canvasUndo, canvasRedo, menus } from "@infinite-canvas/plugin-sdk/builtin";
import { PluginError } from "@infinite-canvas/shared/plugins";
import type { CanvasSession } from "@workbench/lib/canvas/canvas-session";
import { builtinPlugin } from "@workbench/lib/plugins/registry";

export function registerCanvasProjectMenu(session: CanvasSession, navigate: NavigateFunction, feedback: Pick<typeof toast, "error"> = toast) {
    let active = true;
    const release = builtinPlugin.extensions.contribute(menus, {
        id: "builtin:canvas-project-menu",
        value: {
            id: "builtin:canvas-project-menu",
            locations: ["canvas.projectMenu"],
            transform: ({ ctx, canvas, target, items }) => {
                if (target.location !== "canvas.projectMenu" || session.signal.aborted || canvas.projectId !== session.projectId) return items;
                const snapshot = canvas.getSnapshot();
                const options = { scope: canvas.scope };
                const report = (error: unknown, text: string) => {
                    console.error("[canvas] project menu", error);
                    if (!active || ctx.signal.aborted || canvas.signal.aborted || session.signal.aborted || error instanceof PluginError && ["PLUGIN_INACTIVE", "PLUGIN_SCOPE_CLOSED", "PLUGIN_PROJECT_CHANGED"].includes(error.code)) return;
                    feedback.error(text, workbenchMessageOptions.error);
                };
                const defaults: PluginMenuItem[] = [
                    { id: "builtin:home", type: "action", icon: <Home />, title: "主页", run: () => navigate("/") },
                    { id: "builtin:projects", type: "action", icon: <Images />, title: "我的画布", run: () => navigate("/canvas") },
                    { id: "builtin:project:separator", type: "separator" },
                    { id: "builtin:history:separator", type: "separator" },
                    {
                        id: "builtin:undo", type: "action", disabled: !snapshot.canUndo || !ctx.commands.canExecute(canvasUndo, undefined, options), icon: <Undo2 />, title: "撤销", shortcut: "⌘ Z",
                        run: async () => {
                            try { await ctx.commands.execute(canvasUndo, undefined, options); }
                            catch (error) { report(error, "暂时无法撤销，请重试。"); }
                        },
                    },
                    {
                        id: "builtin:redo", type: "action", disabled: !snapshot.canRedo || !ctx.commands.canExecute(canvasRedo, undefined, options), icon: <Redo2 />, title: "重做", shortcut: "⌘ ⇧ Z / ⌘ Y",
                        run: async () => {
                            try { await ctx.commands.execute(canvasRedo, undefined, options); }
                            catch (error) { report(error, "暂时无法重做，请重试。"); }
                        },
                    },
                ];
                return [...defaults, ...items];
            },
        },
    });
    return () => { active = false; release(); };
}

export function useCanvasProjectMenu(session: CanvasSession) {
    const navigate = useNavigate();
    useLayoutEffect(() => registerCanvasProjectMenu(session, navigate), [session, navigate]);
}
