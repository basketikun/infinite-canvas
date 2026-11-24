import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Download, FileUp, LoaderCircle, Plus } from "lucide-react";
import { toast } from "sonner";

import { ArchivePublishError, importProjectArchive } from "@workbench/lib/canvas/work-archive";
import { CanvasDeleteProjectsDialog } from "@workbench/components/canvas/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "@workbench/components/canvas/canvas-project-card";
import { useCanvasStore } from "@workbench/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@workbench/stores/canvas/use-canvas-ui-store";
import { useProjectExport } from "@workbench/hooks/use-project-export";
import { useCanvasProjectActions } from "@workbench/hooks/use-canvas-project-actions";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import "./canvas-library.css";

export default function CanvasPage() {
    const exportProjects = useProjectExport();

    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { scope, createProject, creating } = useCanvasProjectActions(`canvas-library:${searchParams.toString()}`);
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef<ScopeBinding | null>(null);
    const [failedAutoScope, setFailedAutoScope] = useState<ScopeBinding | null>(null);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const createAndEnter = useCallback(async () => {
        if (!scope || scope.signal.aborted) return;
        const query = agentQuery;
        const id = await createProject(`无限画布 ${useCanvasStore.getState().projects.length + 1}`);
        if (id && !scope.signal.aborted) navigate(`/canvas/${id}${query}`);
    }, [agentQuery, createProject, navigate, scope]);
    const importCanvas = async (file?: File) => {
        if (!file || !scope || scope.signal.aborted) return;
        try {
            const ids = await importProjectArchive(file, scope.signal);
            if (!scope.signal.aborted) toast.success(`已导入 ${ids.length} 个画布`, workbenchMessageOptions.success);
        } catch (error) {
            if (!scope.signal.aborted) toast.error(error instanceof ArchivePublishError ? error.message : "导入失败，请选择包含完整文件的画布作品包。", workbenchMessageOptions.error);
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    useEffect(() => {
        if (!hydrated || !scope || autoOpenRef.current === scope || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = scope;
        const recent = mode === "recent" ? projects[0]?.id : undefined;
        const query = agentQuery;
        void Promise.resolve().then(async () => {
            if (scope.signal.aborted) return;
            const id = recent ?? await createProject(`无限画布 ${useCanvasStore.getState().projects.length + 1}`);
            if (scope.signal.aborted) return;
            if (id) navigate(`/canvas/${id}${query}`);
            else setFailedAutoScope(scope);
        });
    }, [agentQuery, createProject, hydrated, mode, navigate, projects, scope]);

    if (hydrated && (mode === "new" || mode === "recent") && (!scope || failedAutoScope !== scope)) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">正在打开画布...</main>;

    return (
        <main className="canvas-library generation-workspace-controls h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-stone-800">
                    <div>
                        <p className="text-xs text-stone-500">画布库</p>
                        <h1 className="mt-3 text-3xl font-semibold">无限画布</h1>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {selectedIds.length ? (
                            <>
                                <Button variant="outline" disabled={!hydrated} onClick={() => void exportProjects(projects.filter((project) => selectedIds.includes(project.id)), `无限画布-${selectedIds.length}`)}>
                                    <Download className="size-4" />导出选中
                                </Button>
                                <Button variant="outline" disabled={!hydrated} onClick={() => setDeleteIds(selectedIds)}>
                                    删除选中
                                </Button>
                            </>
                        ) : null}
                        {projects.length ? (
                            <Button variant="outline" disabled={!hydrated} onClick={() => setDeleteIds(projects.map((project) => project.id))}>
                                删除全部
                            </Button>
                        ) : null}
                        <Button variant="outline" disabled={!hydrated} onClick={() => inputRef.current?.click()}>
                            <FileUp className="size-4" />导入画布
                        </Button>
                        <Button disabled={!hydrated || creating} aria-busy={creating} onClick={createAndEnter}>
                            {creating ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}新建画布
                        </Button>
                    </div>
                </header>

                {!hydrated ? (
                    <section className="flex min-h-[360px] items-center justify-center border-y border-stone-200 text-sm text-stone-500 dark:border-stone-800">正在加载画布...</section>
                ) : projects.length ? (
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {projects.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} />
                        ))}
                    </div>
                ) : (
                    <section className="flex min-h-[360px] flex-col items-center justify-center border-y border-stone-200 text-center dark:border-stone-800">
                        <h2 className="text-xl font-medium">还没有画布</h2>
                        <p className="mt-3 text-sm text-stone-500">新建一个画布后，就可以独立保存节点、连线和画布外观。</p>
                        <Button disabled={creating} aria-busy={creating} className="mt-6" onClick={createAndEnter}>
                            {creating ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}新建画布
                        </Button>
                    </section>
                )}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
        </main>
    );
}
