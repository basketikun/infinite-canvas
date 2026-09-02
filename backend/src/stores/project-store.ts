import type { BackendDatabase, CanvasProject } from "../db.js";
import type { CanvasProjectStore } from "./types.js";

/** 画布项目 store。 */
export function createProjectStore(db: BackendDatabase): CanvasProjectStore {
    return {
        list: () => db.listCanvasProjects(),
        get: (id) => db.getCanvasProject(id),
        upsert: (project) => db.upsertCanvasProject(project),
        replaceAll: (projects) => db.replaceCanvasProjects(projects),
        delete: (id) => db.deleteCanvasProject(id),
    };
}
