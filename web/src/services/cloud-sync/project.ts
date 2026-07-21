import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { setImageBlob } from "@/services/image-storage";
import { setMediaBlob } from "@/services/file-storage";

const storageKeyPattern = /^(image|video|audio|file|video-reference|audio-reference):/;

export type CloudMediaManifest = { storageKey: string; sha256: string; mimeType: string; bytes: number };
export type CloudProjectPayload = { project: CanvasProject; media: CloudMediaManifest[] };

export function createProjectSnapshot(project: CanvasProject): CanvasProject {
    return structuredClone(project);
}

export function createCloudProjectPayload(project: CanvasProject, media: CloudMediaManifest[] = []): CloudProjectPayload {
    return { project: createProjectSnapshot(project), media };
}

export function parseCloudProjectPayload(value: unknown): CloudProjectPayload {
    if (value && typeof value === "object" && "project" in value) {
        const payload = value as Partial<CloudProjectPayload>;
        return { project: payload.project as CanvasProject, media: Array.isArray(payload.media) ? payload.media : [] };
    }
    return { project: value as CanvasProject, media: [] };
}

export async function createCloudMediaManifest(project: CanvasProject, readBlob: (storageKey: string) => Promise<Blob | null>): Promise<CloudMediaManifest[]> {
    const keys = collectProjectStorageKeys(project);
    const media = await Promise.all(
        keys.map(async (storageKey) => {
            const blob = await readBlob(storageKey);
            if (!blob) throw new Error(`本地媒体缺失：${storageKey}`);
            return {
                storageKey,
                sha256: await sha256(blob),
                mimeType: blob.type || "application/octet-stream",
                bytes: blob.size,
            };
        }),
    );
    return media;
}

export function collectProjectStorageKeys(project: CanvasProject) {
    const keys = new Set<string>();
    const visit = (value: unknown): void => {
        if (!value || typeof value !== "object") return;
        if ("storageKey" in value && typeof value.storageKey === "string" && storageKeyPattern.test(value.storageKey)) keys.add(value.storageKey);
        Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach(visit) : visit(item)));
    };
    visit(project);
    return [...keys];
}

export async function restoreProjectMedia(storageKey: string, blob: Blob) {
    return storageKey.startsWith("image:") ? setImageBlob(storageKey, blob) : setMediaBlob(storageKey, blob);
}

async function sha256(blob: Blob) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
    return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
}
