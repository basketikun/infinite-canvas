"use client";

import { useRouter } from "next/navigation";
import { App, Button } from "antd";
import { Plus } from "lucide-react";

import { RequireAuth } from "@/components/require-auth";
import { saveCanvas } from "@/services/api/canvases";
import { createId } from "@/lib/id";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasDeleteProjectsDialog } from "./components/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "./components/canvas-project-card";
import { useCanvasListSync } from "./hooks/use-canvas-cloud-sync";
import { useCanvasStore, type CanvasProject } from "./stores/use-canvas-store";
import { useCanvasUiStore } from "./stores/use-canvas-ui-store";

const initialViewport = { x: 0, y: 0, k: 1 } as const;

export default function CanvasPage() {
  return (
    <RequireAuth>
      <CanvasLibrary />
    </RequireAuth>
  );
}

function CanvasLibrary() {
  useCanvasListSync();
  const { message } = App.useApp();
  const router = useRouter();
  const token = useUserStore((state) => state.token);
  const hydrated = useCanvasStore((state) => state.hydrated);
  const projects = useCanvasStore((state) => state.projects);
  const upsertProject = useCanvasStore((state) => state.upsertProject);
  const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
  const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);

  const createAndEnter = async () => {
    if (!token) {
      message.error("请先登录");
      return;
    }
    const id = createId();
    const now = new Date().toISOString();
    const title = `无限画布 ${projects.length + 1}`;
    const project: CanvasProject = {
      id,
      title,
      createdAt: now,
      updatedAt: now,
      nodes: [],
      connections: [],
      chatSessions: [],
      activeChatId: null,
      backgroundMode: "lines",
      viewport: { ...initialViewport },
    };
    try {
      await saveCanvas(token, {
        id,
        title,
        data: {
          nodes: project.nodes,
          connections: project.connections,
          chatSessions: project.chatSessions,
          activeChatId: project.activeChatId,
          backgroundMode: project.backgroundMode,
          viewport: project.viewport,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        },
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "新建画布失败");
      return;
    }
    upsertProject(project);
    router.push(`/canvas/${id}`);
  };

  return (
    <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-stone-800">
          <div>
            <p className="text-xs text-stone-500">画布库</p>
            <h1 className="mt-3 text-3xl font-semibold">无限画布</h1>
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.length ? <Button disabled={!hydrated} onClick={() => setDeleteIds(selectedIds)}>删除选中</Button> : null}
            {projects.length ? <Button disabled={!hydrated} onClick={() => setDeleteIds(projects.map((project) => project.id))}>删除全部</Button> : null}
            <Button disabled={!hydrated} type="primary" icon={<Plus className="size-4" />} onClick={() => void createAndEnter()}>新建画布</Button>
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
            <Button type="primary" className="mt-6" icon={<Plus className="size-4" />} onClick={() => void createAndEnter()}>新建画布</Button>
          </section>
        )}
      </div>

      <CanvasDeleteProjectsDialog />
    </main>
  );
}
