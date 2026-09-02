import { create } from "zustand";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import { createBackendGenerationLog, fetchBackendProjects, saveBackendProjects } from "@/services/backend-api";
import { useBackendStore } from "@/stores/use-backend-store";

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
    showImageInfo: boolean;
    globalPrompt: string;
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
    replaceProjects: (projects: CanvasProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "globalPrompt" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function syncCanvasProjects(projects: CanvasProject[]) {
    if (!useBackendStore.getState().connected) return;
    try { await saveBackendProjects(projects as unknown as Record<string, unknown>[]); } catch { /* Backend 是唯一写入目标，失败由下一次同步重试 */ }
}

async function hydrateCanvasProjectsFromBackend() {
    const backendConnected = useBackendStore.getState().connected;
    if (!backendConnected) return false;
    try {
        const response = await fetchBackendProjects();
        const remoteProjects = Array.isArray(response.projects) ? response.projects as unknown as CanvasProject[] : [];
        useCanvasStore.setState({ projects: remoteProjects });
        return true;
    } catch {
        return false;
    }
}

async function hydrateCanvasProjects() {
    await hydrateCanvasProjectsFromBackend();
    useCanvasStore.setState({ hydrated: true });
}

export const useCanvasStore = create<CanvasStore>()((set, get) => ({
            hydrated: false,
            projects: [],
            createProject: (title = i18n.t("canvas.project.untitled")) => {
                const now = new Date().toISOString();
                const id = nanoid();
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
                    showImageInfo: false,
                    globalPrompt: "",
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                scheduleCanvasSync();
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: source.title || i18n.t("canvas.project.imported"),
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    globalPrompt: source.globalPrompt || "",
                    viewport: source.viewport || initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                scheduleCanvasSync();
                void importLegacyGenerationLogs(project.id, (source as Partial<CanvasProject> & { logs?: unknown[] }).logs);
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) => {
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                }));
                scheduleCanvasSync();
            },
            deleteProjects: (ids) => {
                set((state) => {
                    const projects = state.projects.filter((project) => !ids.includes(project.id));
                    return { projects };
                });
                scheduleCanvasSync();
            },
            replaceProjects: (projects) => { set({ projects }); scheduleCanvasSync(); },
            updateProject: (id, patch) => {
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                }));
                scheduleCanvasSync();
            },
        }));

function scheduleCanvasSync() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        void syncCanvasProjects(useCanvasStore.getState().projects);
    }, 400);
}

if (typeof window !== "undefined") {
    window.addEventListener("backend-connected", () => { void hydrateCanvasProjects(); });
}

async function importLegacyGenerationLogs(projectId: string, value: unknown) {
    if (!Array.isArray(value) || !useBackendStore.getState().connected) return;
    for (const item of value.slice(0, 500)) {
        if (!item || typeof item !== "object") continue;
        const log = item as Record<string, unknown>;
        const request = log.request && typeof log.request === "object" ? log.request as Record<string, unknown> : {};
        const media = (input: unknown) => Array.isArray(input) ? input.filter((entry) => entry && typeof entry === "object").map((entry) => {
            const copy = { ...(entry as Record<string, unknown>) };
            if (typeof copy.dataUrl === "string" && copy.dataUrl.startsWith("data:")) delete copy.dataUrl;
            return copy;
        }) : [];
        try {
            await createBackendGenerationLog({
                projectId, nodeId: typeof log.nodeId === "string" ? log.nodeId : undefined, status: log.status === "failed" ? "failed" : "success",
                platform: String(log.platform || "Generate"), workflow: typeof request.workflow_json === "string" ? request.workflow_json : undefined,
                model: typeof log.model === "string" ? log.model : undefined, prompt: typeof log.prompt === "string" ? log.prompt : "",
                references: media(log.refs), inputCounts: {}, runtimeTaskId: String(request.task_id || request.taskId || "") || undefined,
                startedAt: new Date(Number(log.createdAt) || Date.now()).toISOString(), durationMs: Number(log.runMs || 0), outputs: media(log.outputs),
                error: typeof log.error === "string" ? log.error : undefined, params: { ...request, legacyLogId: typeof log.id === "string" ? log.id : undefined },
            });
        } catch { /* imported logs are best-effort and must not block project import */ }
    }
}
