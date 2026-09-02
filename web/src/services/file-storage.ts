import localforage from "localforage";
import { nanoid } from "nanoid";
import { uploadBackendMedia, deleteBackendMedia, backendMediaUrl } from "@/services/backend-api";
import { useBackendStore } from "@/stores/use-backend-store";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const objectUrls = new Map<string, string>();

export async function uploadMediaFile(input: string | Blob, prefix = "file"): Promise<UploadedFile> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const localKey = `${prefix}:${nanoid()}`;
    await store.setItem(localKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(localKey, url);
    const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {} as { width?: number; height?: number; durationMs?: number };
    const videoMeta = meta as { width?: number; height?: number; durationMs?: number };

    // 同步上传到总后台（连接时）
    if (useBackendStore.getState().connected) {
        try {
            const result = await uploadBackendMedia({
                name: `${localKey}`,
                blob,
                mimeType: blob.type || "application/octet-stream",
                width: videoMeta.width,
                height: videoMeta.height,
                durationMs: videoMeta.durationMs,
            });
            return { url: result.url, storageKey: result.storageKey, bytes: blob.size, mimeType: result.mimeType, ...videoMeta };
        } catch { /* backend offline — fall through */ }
    }
    return { url, storageKey: localKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...videoMeta };
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    // 尝试从总后台代理地址解析
    if (useBackendStore.getState().connected) {
        return backendMediaUrl(storageKey);
    }
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getMediaBlob(storageKey: string) {
    return store.getItem<Blob>(storageKey);
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(key);
            // 同步删除总后台媒体
            if (useBackendStore.getState().connected) {
                await deleteBackendMedia(key).catch(() => undefined);
            }
        }),
    );
}

export async function cleanupUnusedMedia(usedData: unknown) {
    const usedKeys = collectMediaStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await Promise.all(unused.map((key) => store.removeItem(key)));
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        const done = () => resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}
