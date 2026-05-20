"use client";

import { Check, Download, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { App, Button, Input } from "antd";

import { fetchCanvas, saveCanvas } from "@/services/api/canvases";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasStore, type CanvasProject } from "../stores/use-canvas-store";
import { useCanvasUiStore } from "../stores/use-canvas-ui-store";

export function CanvasProjectCard({ project }: { project: CanvasProject }) {
  const { message } = App.useApp();
  const router = useRouter();
  const token = useUserStore((state) => state.token);
  const renameProject = useCanvasStore((state) => state.renameProject);
  const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
  const editingId = useCanvasUiStore((state) => state.editingProjectId);
  const editingTitle = useCanvasUiStore((state) => state.editingProjectTitle);
  const startEditing = useCanvasUiStore((state) => state.startEditingProject);
  const setEditingTitle = useCanvasUiStore((state) => state.setEditingProjectTitle);
  const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
  const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
  const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
  const editing = editingId === project.id;
  const selected = selectedIds.includes(project.id);
  const open = () => router.push(`/canvas/${project.id}`);
  const saveTitle = async () => {
    const nextTitle = editingTitle.trim() || project.title;
    renameProject(project.id, nextTitle);
    stopEditing();
    if (!token || nextTitle === project.title) return;
    try {
      const record = await fetchCanvas(token, project.id);
      await saveCanvas(token, { id: project.id, title: nextTitle, coverUrl: record.coverUrl, data: record.data });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "重命名保存失败");
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
          <Input className="min-w-0" value={editingTitle} onClick={(event) => event.stopPropagation()} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveTitle()} autoFocus />
        ) : (
          <button type="button" className="min-w-0 cursor-pointer text-left" onClick={(event) => { event.stopPropagation(); open(); }}>
            <h2 className="truncate text-xl font-semibold">{project.title}</h2>
            <p className="mt-3 text-sm leading-6 text-stone-600 dark:text-stone-400">{project.nodes.length} 个节点 · {project.connections.length} 条连线</p>
          </button>
        )}
      </div>
      <div className="mt-8 flex items-end justify-between gap-3">
        <p className="text-xs text-stone-500">更新于 {new Date(project.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
        <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
          {editing ? (
            <>
              <Button type="text" size="small" shape="circle" icon={<Check className="size-4" />} onClick={saveTitle} aria-label="保存名称" />
              <Button type="text" size="small" shape="circle" icon={<X className="size-4" />} onClick={stopEditing} aria-label="取消重命名" />
            </>
          ) : (
            <>
              <Button type="text" size="small" shape="circle" icon={<Download className="size-4" />} onClick={() => exportProject(project)} aria-label="导出" />
              <Button type="text" size="small" shape="circle" icon={<Pencil className="size-4" />} onClick={() => startEditing(project.id, project.title)} aria-label="重命名" />
              <Button type="text" size="small" shape="circle" icon={<Trash2 className="size-4" />} onClick={() => setDeleteIds([project.id])} aria-label="删除" />
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function exportProject(project: CanvasProject) {
  const data = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), project };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(project.title || "无限画布").replace(/[\\/:*?"<>|]/g, "_")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
