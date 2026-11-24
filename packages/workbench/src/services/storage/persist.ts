import type { StateStorage } from "zustand/middleware";
import { storage } from "./runtime";
import { reportStorageError } from "./status";

export const appStateStorage: StateStorage = {
    getItem: storage.state.getItem.bind(storage.state),
    setItem: (key, value) => storage.state.setItem(key, value).catch(reportStorageError),
    removeItem: (key) => storage.state.removeItem(key).catch(reportStorageError),
};
