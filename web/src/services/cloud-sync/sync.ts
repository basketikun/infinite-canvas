import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CloudRevisionConflict, saveCloudProject } from "./client";
import { createProjectSnapshot } from "./project";

export type CloudProjectState = { revision: number };
export type CloudSyncConflict = { project: CanvasProject; currentRevision: number };

export async function syncCloudProject(project: CanvasProject, state: CloudProjectState, token: string, baseUrl: string): Promise<{ revision: number } | CloudSyncConflict> {
    try {
        const saved = await saveCloudProject(project.id, state.revision, { title: project.title, payload: createProjectSnapshot(project) }, token, baseUrl);
        return { revision: saved.currentRevision || state.revision + 1 };
    } catch (error) {
        if (error instanceof CloudRevisionConflict) return { project, currentRevision: error.currentRevision };
        throw error;
    }
}
