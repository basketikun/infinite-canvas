import type { StateStorage } from "zustand/middleware";
import { getSharedStore } from "@/lib/shared-storage";

const store = getSharedStore("app_state");

export const localForageStorage: StateStorage = {
    getItem: (name) => store.getItem<string>(name),
    setItem: (name, value) => store.setItem(name, value).then(() => undefined),
    removeItem: (name) => store.removeItem(name),
};
