import type { BackendDatabase } from "../db.js";
import type { GenerationLogStore, GenerationLogInput } from "./types.js";

/** 生成日志 store。 */
export function createLogStore(db: BackendDatabase): GenerationLogStore {
    return {
        create: (input: GenerationLogInput) => db.createGenerationLog(input),
        get: (id) => db.getGenerationLog(id),
        update: (id, patch) => db.updateGenerationLog(id, patch),
        list: (filter) => db.listGenerationLogs(filter ?? {}),
        delete: (scope) => db.deleteGenerationLogs(scope),
    };
}
