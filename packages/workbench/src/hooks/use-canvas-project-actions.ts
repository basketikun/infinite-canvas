import { useCallback, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { createProject as createCanvasProject, deleteProjects as deleteCanvasProjects, renameProject as renameCanvasProject } from "@workbench/lib/canvas/project-actions";
import { useCanvasStore } from "@workbench/stores/canvas/use-canvas-store";
import { ArchivePublishError, copyCanvasProject } from "@workbench/lib/canvas/work-archive";
import { usePluginViewScope } from "./use-plugin-view-scope";

export function useCanvasProjectActions(viewKey: string, parentSignal?: AbortSignal) {
    const viewId = useId();
    const scope = usePluginViewScope(`project-actions:${viewId}:${viewKey}`, undefined, parentSignal);
    const pending = useRef<{ scope: ScopeBinding } | null>(null);
    const [creatingScope, setCreatingScope] = useState<ScopeBinding | null>(null);
    const reportFailure = useCallback((error: unknown, binding: ScopeBinding, text: string) => {
        console.error("[canvas] project action", error);
        if (!binding.signal.aborted && !(error instanceof PluginError && ["PLUGIN_INACTIVE", "PLUGIN_SCOPE_CLOSED", "PLUGIN_PROJECT_CHANGED"].includes(error.code))) toast.error(text, workbenchMessageOptions.error);
    }, []);
    const createProject = useCallback(async (title: string) => {
        if (!scope || scope.signal.aborted || pending.current?.scope === scope) return null;
        const request = { scope };
        pending.current = request;
        setCreatingScope(scope);
        try {
            const projectId = await createCanvasProject(title);
            return scope.signal.aborted ? null : projectId;
        } catch (error) {
            reportFailure(error, scope, "暂时无法保存画布，请重试。");
            return null;
        } finally {
            if (pending.current === request) {
                pending.current = null;
                if (!scope.signal.aborted) setCreatingScope(null);
            }
        }
    }, [reportFailure, scope]);
    const renameProject = useCallback(async (projectId: string, title: string) => {
        if (!scope || scope.signal.aborted) return false;
        try {
            await renameCanvasProject(projectId, title);
            return !scope.signal.aborted;
        } catch (error) {
            reportFailure(error, scope, "暂时无法保存画布，请重试。");
            return false;
        }
    }, [reportFailure, scope]);
    const copyProject = useCallback(async (projectId: string) => {
        if (!scope || scope.signal.aborted || pending.current?.scope === scope) return null;
        const request = { scope };
        pending.current = request;
        setCreatingScope(scope);
        try {
            const store = useCanvasStore.getState();
            const project = store.openProject(projectId);
            if (!project) throw new PluginError("PLUGIN_NOT_FOUND");
            const id = await copyCanvasProject(project, `${project.title}（副本）`, scope.signal);
            return scope.signal.aborted ? null : id;
        } catch (error) {
            reportFailure(error, scope, error instanceof ArchivePublishError ? error.message : "画布副本未能保存，请检查原文件后重试。");
            return null;
        } finally {
            if (pending.current === request) {
                pending.current = null;
                if (!scope.signal.aborted) setCreatingScope(null);
            }
        }
    }, [reportFailure, scope]);
    const deleteProjects = useCallback(async (projectIds: string[]) => {
        if (!scope || scope.signal.aborted) return false;
        try {
            await deleteCanvasProjects(projectIds);
            return !scope.signal.aborted;
        } catch (error) {
            reportFailure(error, scope, "画布尚未删除完成，请重试。");
            return false;
        }
    }, [reportFailure, scope]);
    return { scope, createProject, renameProject, copyProject, deleteProjects, creating: Boolean(scope && !scope.signal.aborted && creatingScope === scope) };
}
