import { useCallback, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { exportCanvasProjects } from "@workbench/lib/canvas/canvas-export";
import type { CanvasProject } from "@workbench/stores/canvas/use-canvas-store";

export function useProjectExport() {
    const current = useRef<AbortController | null>(null);
    useLayoutEffect(() => {
        const controller = new AbortController();
        current.current = controller;
        return () => {
            controller.abort();
            if (current.current === controller) current.current = null;
        };
    }, []);
    return useCallback(async (projects: CanvasProject[], fileName: string) => {
        const signal = current.current?.signal;
        if (!signal || signal.aborted) return;
        try {
            await exportCanvasProjects(projects, fileName, signal);
        } catch (error) {
            console.error("[canvas] project export", error);
            if (!signal.aborted) toast.error("导出失败，请重试。", workbenchMessageOptions.error);
        }
    }, []);
}
