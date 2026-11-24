import { useRef } from "react";
import { Check, Download, LoaderCircle, Pencil, Trash2, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";

import { useCanvasStore, type CanvasProject } from "@workbench/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@workbench/stores/canvas/use-canvas-ui-store";
import { useProjectExport } from "@workbench/hooks/use-project-export";
import { useCanvasProjectActions } from "@workbench/hooks/use-canvas-project-actions";

export function CanvasProjectCard({ project }: { project: CanvasProject }) {
    const exportProjects = useProjectExport();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { scope, renameProject } = useCanvasProjectActions(`project-card:${project.id}`);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const editingId = useCanvasUiStore((state) => state.editingProjectId);
    const editingTitle = useCanvasUiStore((state) => state.editingProjectTitle);
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const setEditingTitle = useCanvasUiStore((state) => state.setEditingProjectTitle);
    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const deletionStatus = useCanvasStore((state) => state.projectDeletions[project.id]);
    const editing = editingId === project.id && !deletionStatus;
    const titleEdit = useRef<{ title: string; pending: boolean } | null>(editing ? { title: editingTitle, pending: false } : null);
    const selected = selectedIds.includes(project.id);
    const open = () => {
        navigate(`/canvas/${project.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`);
    };
    const beginTitleEditing = () => {
        titleEdit.current = { title: project.title, pending: false };
        startEditing(project.id, project.title);
    };
    const changeTitle = (title: string) => {
        titleEdit.current = { title, pending: false };
        setEditingTitle(title);
    };
    const cancelTitleEditing = () => {
        titleEdit.current = null;
        stopEditing();
    };
    const saveTitle = async () => {
        const record = titleEdit.current;
        if (!record || record.pending || useCanvasUiStore.getState().editingProjectId !== project.id) return;
        record.pending = true;
        const saved = await renameProject(project.id, record.title);
        if (titleEdit.current !== record || scope?.signal.aborted) return;
        record.pending = false;
        const current = useCanvasUiStore.getState();
        if (saved && current.editingProjectId === project.id && current.editingProjectTitle === record.title) {
            titleEdit.current = null;
            stopEditing();
        }
    };

    return (
        <article className="group flex min-h-44 cursor-pointer flex-col justify-between rounded-2xl bg-[#f1eee8] p-5 transition hover:bg-[#ebe6dc] dark:bg-white/5 dark:hover:bg-white/10" onClick={() => !editing && open()}>
            <div className="flex items-start gap-3">
                <input
                    type="checkbox"
                    checked={selected}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => toggleSelected(project.id, event.target.checked)}
                    className="mt-1 size-4 accent-stone-950 dark:accent-stone-100"
                    aria-label={`选择 ${project.title}`}
                />
                {editing ? (
                    <Input aria-label="画布名称" value={editingTitle} onClick={(event) => event.stopPropagation()} onChange={(event) => changeTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && !event.nativeEvent.isComposing && saveTitle()} autoFocus />
                ) : (
                    <button
                        type="button"
                        className="min-w-0 cursor-pointer text-left"
                        onClick={(event) => {
                            event.stopPropagation();
                            open();
                        }}
                    >
                        <h2 className="truncate text-xl font-semibold">{project.title}</h2>
                        <p className="mt-3 text-sm leading-6 text-stone-600 dark:text-stone-400">
                            {deletionStatus === "pending" ? "正在删除画布…" : deletionStatus === "error" ? "删除未完成，请重试" : `${project.nodes.length} 个节点 · ${project.connections.length} 条连线`}
                        </p>
                    </button>
                )}
            </div>
            <div className="mt-8 flex items-end justify-between gap-3">
                <p className="text-xs text-stone-500">{`更新于 ${new Date(project.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`}</p>
                <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                    {editing ? (
                        <>
                            <Button variant="ghost" size="icon-xs" onClick={saveTitle} aria-label="保存名称"><Check className="size-4" /></Button>
                            <Button variant="ghost" size="icon-xs" onClick={cancelTitleEditing} aria-label="取消重命名"><X className="size-4" /></Button>
                        </>
                    ) : (
                        <>
                            <Button variant="ghost" size="icon-xs" disabled={Boolean(deletionStatus)} onClick={() => void exportProjects([project], project.title || "无限画布")} aria-label="导出"><Download className="size-4" /></Button>
                            <Button variant="ghost" size="icon-xs" disabled={Boolean(deletionStatus)} onClick={beginTitleEditing} aria-label="重命名"><Pencil className="size-4" /></Button>
                            <Button variant="ghost" size="icon-xs" disabled={deletionStatus === "pending"} aria-busy={deletionStatus === "pending"} onClick={() => setDeleteIds([project.id])} aria-label={deletionStatus === "error" ? "重试删除" : "删除"}>
                                {deletionStatus === "pending" ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                            </Button>
                        </>
                    )}
                </div>
            </div>
        </article>
    );
}
