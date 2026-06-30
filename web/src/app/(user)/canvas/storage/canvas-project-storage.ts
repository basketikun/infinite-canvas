import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasProject } from "../stores/use-canvas-store";

export const CANVAS_PROJECT_INDEX_KEY = "infinite-canvas:canvas_project_index";
export const CANVAS_PROJECT_KEY_PREFIX = "infinite-canvas:canvas_project:";
export const LEGACY_CANVAS_STORE_KEY = "infinite-canvas:canvas_store";

export type CanvasProjectIndexItem = Pick<CanvasProject, "id" | "title" | "createdAt" | "updatedAt">;

export async function saveCanvasProject(project: CanvasProject) {
    await localForageStorage.setItem(`${CANVAS_PROJECT_KEY_PREFIX}${project.id}`, JSON.stringify(project));
}

export async function loadCanvasProject(id: string) {
    const value = await localForageStorage.getItem(`${CANVAS_PROJECT_KEY_PREFIX}${id}`);
    return value ? (JSON.parse(value) as CanvasProject) : null;
}

export async function removeCanvasProject(id: string) {
    await localForageStorage.removeItem(`${CANVAS_PROJECT_KEY_PREFIX}${id}`);
}

export async function saveCanvasProjectIndex(projects: CanvasProjectIndexItem[]) {
    await localForageStorage.setItem(CANVAS_PROJECT_INDEX_KEY, JSON.stringify({ version: 1, projects }));
}

async function loadCanvasProjectIndexRecord() {
    const value = await localForageStorage.getItem(CANVAS_PROJECT_INDEX_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as { projects?: CanvasProjectIndexItem[] };
    return Array.isArray(parsed.projects) ? parsed.projects : [];
}

export async function loadCanvasProjectIndex() {
    return (await loadCanvasProjectIndexRecord()) || [];
}

export async function loadLegacyCanvasProjects() {
    const value = await localForageStorage.getItem(LEGACY_CANVAS_STORE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as { state?: { projects?: CanvasProject[] } };
    return Array.isArray(parsed.state?.projects) ? parsed.state.projects : [];
}

export async function loadCanvasProjects() {
    const index = await loadCanvasProjectIndexRecord();
    if (index) {
        const projects = await Promise.all(index.map((item) => loadCanvasProject(item.id)));
        return projects.filter((project): project is CanvasProject => Boolean(project));
    }

    const legacyProjects = await loadLegacyCanvasProjects();
    if (legacyProjects.length) await replaceCanvasProjects(legacyProjects);
    return legacyProjects;
}

export async function replaceCanvasProjects(projects: CanvasProject[]) {
    const previousIndex = await loadCanvasProjectIndex();
    const nextIds = new Set(projects.map((project) => project.id));
    await Promise.all(previousIndex.filter((item) => !nextIds.has(item.id)).map((item) => removeCanvasProject(item.id)));
    await Promise.all(projects.map(saveCanvasProject));
    await saveCanvasProjectIndex(toCanvasProjectIndex(projects));
}

export async function saveCanvasProjects(nextProjects: CanvasProject[], previousProjects: CanvasProject[] = []) {
    const nextById = new Map(nextProjects.map((project) => [project.id, project]));
    const previousById = new Map(previousProjects.map((project) => [project.id, project]));
    const removedIds = previousProjects.map((project) => project.id).filter((id) => !nextById.has(id));
    const changedProjects = nextProjects.filter((project) => previousById.get(project.id) !== project);

    await Promise.all(removedIds.map(removeCanvasProject));
    await Promise.all(changedProjects.map(saveCanvasProject));
    await saveCanvasProjectIndex(toCanvasProjectIndex(nextProjects));
}

export function toCanvasProjectIndex(projects: CanvasProject[]): CanvasProjectIndexItem[] {
    return projects.map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }));
}
