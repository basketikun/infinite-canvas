import localforage from "localforage";

export const IMAGE_GENERATION_LOG_STORE_NAME = "image_generation_logs";
export const VIDEO_GENERATION_LOG_STORE_NAME = "video_generation_logs";

export type WorkbenchLog = {
    id: string;
    createdAt?: number | string;
};

export function createWorkbenchLogStore<T extends WorkbenchLog>(storeName: string) {
    const store = localforage.createInstance({ name: "infinite-canvas", storeName });

    return {
        async list() {
            const logs: T[] = [];
            await store.iterate<T, void>((value) => {
                if (value && typeof value === "object") logs.push(value);
            });
            return logs.sort((a, b) => Number(new Date(b.createdAt || 0)) - Number(new Date(a.createdAt || 0)));
        },
        async save(log: T) {
            await store.setItem(log.id, log);
        },
        async remove(id: string) {
            await store.removeItem(id);
        },
        async replace(logs: T[]) {
            await store.clear();
            await Promise.all(logs.map((log) => store.setItem(log.id, log)));
        },
    };
}
