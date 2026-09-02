import type { BackendDatabase } from "../db.js";
import type { Stores } from "./types.js";
import { createAssetStore } from "./asset-store.js";
import { createLogStore } from "./log-store.js";
import { createMediaStore } from "./media-store.js";
import { createProjectStore } from "./project-store.js";
import { createSettingStore } from "./setting-store.js";
import { createTaskStore } from "./task-store.js";

/** 基于 BackendDatabase 构建总后台全部 store。 */
export function createStores(db: BackendDatabase): Stores {
    return {
        projects: createProjectStore(db),
        assets: createAssetStore(db),
        media: createMediaStore(db),
        tasks: createTaskStore(db),
        logs: createLogStore(db),
        settings: createSettingStore(db),
    };
}

export type { Stores } from "./types.js";
