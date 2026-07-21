import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import { CloudRevisionConflict, type CloudProjectResponse, downloadCloudMedia, saveCloudProject, uploadCloudMedia } from "./client";
import { createCloudMediaManifest, createCloudProjectPayload, createProjectSnapshot, parseCloudProjectPayload, restoreProjectMedia, type CloudProjectPayload } from "./project";

export type CloudProjectState = { revision: number };
export type CloudSyncConflict = { project: CanvasProject; currentRevision: number };

export async function restoreCloudProject(remote: CloudProjectResponse<unknown>, token: string, baseUrl: string, download = downloadCloudMedia, restore = restoreProjectMedia): Promise<{ project: CanvasProject; revision: number }> {
    const payload = parseCloudProjectPayload(remote.payload) as CloudProjectPayload;
    await Promise.all(
        payload.media.map(async (item) => {
            const blob = await download(item.storageKey, item.sha256, token, baseUrl);
            await restore(item.storageKey, blob);
        }),
    );
    return { project: payload.project, revision: remote.currentRevision };
}

export function createCloudConflictCopy(project: CanvasProject): CanvasProject {
    const now = new Date().toISOString();
    return { ...createProjectSnapshot(project), id: `${project.id}-local-${Date.now()}`, title: `${project.title}（本地冲突副本）`, createdAt: now, updatedAt: now };
}

export async function syncCloudProject(project: CanvasProject, state: CloudProjectState, token: string, baseUrl: string): Promise<{ revision: number } | CloudSyncConflict> {
    try {
        const media = await createCloudMediaManifest(project, readProjectBlob);
        const saved = await saveCloudProject(project.id, state.revision, { title: project.title, payload: createCloudProjectPayload(project, media) }, token, baseUrl);
        await Promise.all(
            media.map(async (item) => {
                const blob = await readProjectBlob(item.storageKey);
                if (!blob) throw new Error(`本地媒体缺失：${item.storageKey}`);
                const uploaded = await uploadCloudMedia(item.storageKey, blob, token, baseUrl);
                if (uploaded.sha256 !== item.sha256) throw new Error(`媒体校验失败：${item.storageKey}`);
            }),
        );
        return { revision: saved.currentRevision || state.revision + 1 };
    } catch (error) {
        if (error instanceof CloudRevisionConflict) return { project, currentRevision: error.currentRevision };
        throw error;
    }
}

function readProjectBlob(storageKey: string) {
    return storageKey.startsWith("image:") ? getImageBlob(storageKey) : getMediaBlob(storageKey);
}
