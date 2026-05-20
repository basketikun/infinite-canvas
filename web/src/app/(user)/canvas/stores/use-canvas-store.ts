import { create } from "zustand";

import { createId } from "@/lib/id";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "../types";

export type CanvasProject = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
  chatSessions: CanvasAssistantSession[];
  activeChatId: string | null;
  backgroundMode: CanvasBackgroundMode;
  viewport: ViewportTransform;
};

type CanvasStore = {
  hydrated: boolean;
  projects: CanvasProject[];
  createProject: (title?: string) => string;
  importProject: (project: Partial<CanvasProject>) => string;
  openProject: (id: string) => CanvasProject | null;
  renameProject: (id: string, title: string) => void;
  deleteProjects: (ids: string[]) => void;
  updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "viewport">>) => void;
  replaceProjects: (list: CanvasProject[]) => void;
  upsertProject: (project: CanvasProject) => void;
  markHydrated: (value: boolean) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };

export const useCanvasStore = create<CanvasStore>()((set, get) => ({
  hydrated: false,
  projects: [],
  createProject: (title = "未命名画布") => {
    const now = new Date().toISOString();
    const id = createId();
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
      viewport: initialViewport,
    };
    set((state) => ({ projects: [project, ...state.projects] }));
    return id;
  },
  importProject: (source) => {
    const now = new Date().toISOString();
    const project: CanvasProject = {
      id: createId(),
      title: source.title || "导入画布",
      createdAt: source.createdAt || now,
      updatedAt: now,
      nodes: source.nodes || [],
      connections: source.connections || [],
      chatSessions: source.chatSessions || [],
      activeChatId: source.activeChatId || null,
      backgroundMode: source.backgroundMode || "lines",
      viewport: source.viewport || initialViewport,
    };
    set((state) => ({ projects: [project, ...state.projects] }));
    return project.id;
  },
  openProject: (id) => {
    return get().projects.find((item) => item.id === id) || null;
  },
  renameProject: (id, title) => set((state) => ({
    projects: state.projects.map((project) => project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project),
  })),
  deleteProjects: (ids) => set((state) => {
    const projects = state.projects.filter((project) => !ids.includes(project.id));
    return { projects };
  }),
  updateProject: (id, patch) => set((state) => ({
    projects: state.projects.map((project) => project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project),
  })),
  replaceProjects: (list) => set({ projects: list }),
  upsertProject: (project) => set((state) => {
    const exists = state.projects.some((item) => item.id === project.id);
    if (exists) {
      return { projects: state.projects.map((item) => item.id === project.id ? project : item) };
    }
    return { projects: [project, ...state.projects] };
  }),
  markHydrated: (value) => set({ hydrated: value }),
}));
