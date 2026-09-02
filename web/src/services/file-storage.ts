import { nanoid } from "nanoid";
import { uploadBackendMedia, deleteBackendMedia, backendMediaUrl } from "@/services/backend-api";
import { useBackendStore } from "@/stores/use-backend-store";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

export async function uploadMediaFile(input: string | Blob, prefix = "file"): Promise<UploadedFile> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    if (!useBackendStore.getState().connected) throw new Error("总后台未连接，无法上传媒体");
    const url = URL.createObjectURL(blob);
    const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {} as { width?: number; height?: number; durationMs?: number };
    const videoMeta = meta as { width?: number; height?: number; durationMs?: number };

    URL.revokeObjectURL(url);
    const result = await uploadBackendMedia({ name: `${prefix}-${nanoid()}`, blob, mimeType: blob.type || "application/octet-stream", width: videoMeta.width, height: videoMeta.height, durationMs: videoMeta.durationMs });
    return { url: result.url, storageKey: result.storageKey, bytes: blob.size, mimeType: result.mimeType, ...videoMeta };
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    if (!useBackendStore.getState().connected) return fallback;
    return backendMediaUrl(storageKey);
}

export async function getMediaBlob(storageKey: string) {
    if (!useBackendStore.getState().connected) return null;
    const response = await fetch(backendMediaUrl(storageKey));
    return response.ok ? response.blob() : null;
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    if (!useBackendStore.getState().connected) throw new Error("总后台未连接，无法写入媒体");
    const result = await uploadBackendMedia({ name: storageKey, storageKey, blob, mimeType: blob.type || "application/octet-stream" });
    return backendMediaUrl(result.storageKey);
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            await deleteBackendMedia(key);
        }),
    );
}

export async function cleanupUnusedMedia(usedData: unknown) {
    void usedData;
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
