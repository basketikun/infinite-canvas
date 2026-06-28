"use client";

import localforage from "localforage";

const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });

export async function readGenerationLogReferences() {
    const [imageLogs, videoLogs] = await Promise.all([readLogs(imageLogStore), readLogs(videoLogStore)]);
    return { imageLogs, videoLogs };
}

async function readLogs(store: LocalForage) {
    const logs: unknown[] = [];
    await store.iterate((value) => {
        if (value && typeof value === "object") logs.push(value);
    });
    return logs;
}
