"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App } from "antd";

import { fetchCanvas, fetchCanvases, saveCanvas, type CanvasRecord } from "@/services/api/canvases";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasStore, type CanvasProject } from "../stores/use-canvas-store";

const initialViewport = { x: 0, y: 0, k: 1 } as const;

function emptyProjectFromSummary(summary: { id: string; title: string; createdAt: string; updatedAt: string }): CanvasProject {
  return {
    id: summary.id,
    title: summary.title || "未命名画布",
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    nodes: [],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "lines",
    viewport: { ...initialViewport },
  };
}

function recordToProject(record: CanvasRecord): CanvasProject {
  const data = (record.data || {}) as Partial<CanvasProject>;
  return {
    id: record.id,
    title: record.title || data.title || "未命名画布",
    createdAt: record.createdAt || data.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || data.updatedAt || new Date().toISOString(),
    nodes: data.nodes || [],
    connections: data.connections || [],
    chatSessions: data.chatSessions || [],
    activeChatId: data.activeChatId || null,
    backgroundMode: data.backgroundMode || "lines",
    viewport: data.viewport || { ...initialViewport },
  };
}

function projectToData(project: CanvasProject): Record<string, unknown> {
  return {
    nodes: project.nodes,
    connections: project.connections,
    chatSessions: project.chatSessions,
    activeChatId: project.activeChatId,
    backgroundMode: project.backgroundMode,
    viewport: project.viewport,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export function useCanvasListSync(): void {
  const { message } = App.useApp();
  const token = useUserStore((state) => state.token);
  const userId = useUserStore((state) => state.user?.id || "");
  const replaceProjects = useCanvasStore((state) => state.replaceProjects);
  const markHydrated = useCanvasStore((state) => state.markHydrated);

  // 切换账号 / 退出登录时，立即清掉上一个用户残留的画布列表并切回 loading 状态，
  // 否则新账号的 React Query 还在 pending，UI 会先短暂展示上一个用户的画布。
  useEffect(() => {
    replaceProjects([]);
    markHydrated(false);
  }, [markHydrated, replaceProjects, userId]);

  const query = useQuery({
    queryKey: ["canvases", "list", userId],
    queryFn: () => fetchCanvases(token),
    enabled: Boolean(token),
    retry: false,
  });

  useEffect(() => {
    if (!query.data) return;
    const projects = (query.data.items || []).map((item) => emptyProjectFromSummary(item));
    replaceProjects(projects);
    markHydrated(true);
  }, [markHydrated, query.data, replaceProjects]);

  useEffect(() => {
    if (!query.isError) return;
    message.error(query.error instanceof Error ? query.error.message : "读取画布列表失败");
    markHydrated(true);
  }, [markHydrated, message, query.error, query.isError]);
}

type DetailStatus = "loading" | "ready" | "error";
type SaveStatus = "idle" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 800;

export function useCanvasDetailSync(id: string): { status: DetailStatus; saveStatus: SaveStatus } {
  const { message } = App.useApp();
  const token = useUserStore((state) => state.token);
  const upsertProject = useCanvasStore((state) => state.upsertProject);
  const markHydrated = useCanvasStore((state) => state.markHydrated);
  const [status, setStatus] = useState<DetailStatus>("loading");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const readyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const pendingDataRef = useRef<CanvasProject | null>(null);
  const lastSerializedRef = useRef<string>("");
  const tokenRef = useRef(token);
  const idRef = useRef(id);

  useEffect(() => {
    tokenRef.current = token;
    idRef.current = id;
  }, [id, token]);

  const query = useQuery({
    queryKey: ["canvases", "detail", token, id],
    queryFn: () => fetchCanvas(token, id),
    enabled: Boolean(token && id),
    retry: false,
  });

  useEffect(() => {
    if (!query.data) return;
    const project = recordToProject(query.data);
    upsertProject(project);
    markHydrated(true);
    lastSerializedRef.current = JSON.stringify({ title: project.title, data: projectToData(project) });
    readyRef.current = true;
    setStatus("ready");
  }, [markHydrated, query.data, upsertProject]);

  useEffect(() => {
    if (!query.isError) return;
    message.error(query.error instanceof Error ? query.error.message : "读取画布失败");
    setStatus("error");
  }, [message, query.error, query.isError]);

  const runSave = async (project: CanvasProject) => {
    if (!tokenRef.current) return;
    inFlightRef.current = true;
    setSaveStatus("saving");
    let attempt = 0;
    while (attempt < 2) {
      try {
        await saveCanvas(tokenRef.current, {
          id: project.id,
          title: project.title,
          data: projectToData(project),
        });
        inFlightRef.current = false;
        if (pendingDataRef.current) {
          const next = pendingDataRef.current;
          pendingDataRef.current = null;
          await runSave(next);
          return;
        }
        setSaveStatus("saved");
        return;
      } catch (error) {
        attempt += 1;
        if (attempt >= 2) {
          inFlightRef.current = false;
          setSaveStatus("error");
          message.error(error instanceof Error ? error.message : "保存失败");
          return;
        }
      }
    }
  };

  const scheduleSave = (project: CanvasProject) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (inFlightRef.current) {
        pendingDataRef.current = project;
        return;
      }
      void runSave(project);
    }, DEBOUNCE_MS);
  };

  useEffect(() => {
    if (!readyRef.current) return;
    const unsubscribe = useCanvasStore.subscribe((state, prevState) => {
      if (!readyRef.current) return;
      const project = state.projects.find((item) => item.id === idRef.current);
      if (!project) {
        const previous = prevState.projects.find((item) => item.id === idRef.current);
        if (previous) {
          // project was deleted locally; do not auto-save
          readyRef.current = false;
        }
        return;
      }
      const serialized = JSON.stringify({ title: project.title, data: projectToData(project) });
      if (serialized === lastSerializedRef.current) return;
      lastSerializedRef.current = serialized;
      scheduleSave(project);
    });
    return () => {
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        const project = useCanvasStore.getState().projects.find((item) => item.id === idRef.current);
        if (project && tokenRef.current) {
          // best-effort final flush (fire and forget)
          void saveCanvas(tokenRef.current, {
            id: project.id,
            title: project.title,
            data: projectToData(project),
          }).catch(() => {});
        }
      }
    };
  }, []);

  return { status, saveStatus };
}
