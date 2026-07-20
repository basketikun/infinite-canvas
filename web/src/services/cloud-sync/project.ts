import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { setImageBlob } from "@/services/image-storage";
import { setMediaBlob } from "@/services/file-storage";

const storageKeyPattern = /^(image|video|audio|file|video-reference|audio-reference):/;

export function createProjectSnapshot(project: CanvasProject): CanvasProject {
    return structuredClone(project);
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
