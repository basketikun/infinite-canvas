import type { StoredOutputVideo, WorkbenchVideoTask } from "@infinite-canvas/shared/sync-records";
import { resolveGeneratedVideo } from "@workbench/services/api/video";
import type { VideoGenerationResult } from "@workbench/services/api/models/types";
import { uploadMediaFile } from "@workbench/services/file-storage";
import { updateGenerationRecord } from "@workbench/services/generation-records";
import type { VideoLog } from "@workbench/services/create/logs";

export type VideoChange = { status: "submitted"; task: WorkbenchVideoTask } | { status: "waiting"; error: string } | { status: "failed"; error: string } | { status: "success"; video: StoredOutputVideo };
export type VideoDelivery = { id: string; generationId: string; durationMs: number; change: VideoChange };

/** 先把原件写入新键，再由调用方写入生成记录。 */
export async function prepareVideoResult(id: string, result: VideoGenerationResult, createdAt: number): Promise<StoredOutputVideo> {
    const source = await resolveGeneratedVideo(result);
    if ("external" in source) return { ...source.external, id, width: 1280, height: 720, durationMs: Date.now() - createdAt };
    const file = await uploadMediaFile(source.input, "video");
    return { id, storageKey: file.storageKey, bytes: file.bytes, mimeType: file.mimeType, width: file.width || 1280, height: file.height || 720, durationMs: Date.now() - createdAt };
}

/** 记录已被删除或不属于这次生成时返回 false。 */
export function saveVideoChange({ id, generationId, durationMs, change }: VideoDelivery) {
    return updateGenerationRecord<VideoLog>("video", id, generationId, (row) => {
        if (change.status === "submitted") return { ...row, task: change.task };
        if (change.status === "waiting") return { ...row, error: change.error, durationMs };
        const { task, error, ...history } = row;
        return change.status === "failed" ? { ...history, status: "failed", error: change.error, durationMs } : { ...history, status: "success", video: change.video, durationMs };
    });
}
