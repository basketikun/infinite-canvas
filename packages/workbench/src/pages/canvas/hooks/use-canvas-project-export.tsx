import { useLayoutEffect } from "react";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { Download } from "lucide-react";
import { menus } from "@infinite-canvas/plugin-sdk/builtin";
import type { CanvasSession } from "@workbench/lib/canvas/canvas-session";
import { hostActions } from "@workbench/lib/canvas/host-actions";
import { registerCanvasProjectExport } from "@workbench/lib/canvas/project-export";
import { builtinPlugin } from "@workbench/lib/plugins/registry";

export function registerCanvasProjectExportView(session: CanvasSession, feedback: Pick<typeof toast, "loading" | "success" | "error" | "dismiss"> = toast) {
    const releaseCommand = registerCanvasProjectExport(session);
    const releaseMenu = builtinPlugin.extensions.contribute(menus, {
        id: "builtin:canvas-project-export",
        value: {
            id: "builtin:canvas-project-export",
            locations: ["canvas.projectMenu"],
            transform: ({ ctx, canvas, target, items }) => {
                if (target.location !== "canvas.projectMenu" || session.signal.aborted || canvas.projectId !== session.projectId) return items;
                const next = [...items];
                const index = next.findIndex((item) => item.id === "builtin:history:separator");
                next.splice(index < 0 ? next.length : index, 0, {
                    id: "builtin:export", type: "action", title: "导出当前画布", icon: <Download />,
                    run: async () => {
                        ctx.signal.throwIfAborted();
                        canvas.signal.throwIfAborted();
                        const notice = feedback.loading("正在导出当前画布…", { duration: Infinity });
                        try {
                            await hostActions.canvasExportProject(undefined, canvas.signal);
                            if (!ctx.signal.aborted && !canvas.signal.aborted) feedback.success("已导出当前画布", workbenchMessageOptions.success);
                        } catch (error) {
                            console.error("[canvas] project export", error);
                            if (!ctx.signal.aborted && !canvas.signal.aborted) feedback.error("导出失败，请重试。", workbenchMessageOptions.error);
                        } finally {
                            feedback.dismiss(notice);
                        }
                    },
                });
                return next;
            },
        },
    });
    return () => { releaseMenu(); releaseCommand(); };
}

export function useCanvasProjectExport(session: CanvasSession) {
    useLayoutEffect(() => registerCanvasProjectExportView(session), [session]);
}
