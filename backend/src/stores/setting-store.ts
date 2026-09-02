import type { BackendDatabase } from "../db.js";
import type { SettingStore } from "./types.js";

/** 运行时设置 store（runtime_settings 表）。 */
export function createSettingStore(db: BackendDatabase): SettingStore {
    return {
        get: (key) => db.getSetting(key),
        set: (key, value) => db.setSetting(key, value),
    };
}
