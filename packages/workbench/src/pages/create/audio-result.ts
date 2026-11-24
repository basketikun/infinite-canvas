import type { StoredOutputAudio } from "@infinite-canvas/shared/sync-records";
import { storedAssetFromUrl } from "@workbench/lib/media-source";
import { uploadMediaFile } from "@workbench/services/file-storage";
import { updateGenerationRecord } from "@workbench/services/generation-records";
import type { AudioLog } from "@workbench/services/create/logs";

/** 先把原件写入新键，再由调用方写入生成记录。 */
export async function prepareAudioResult(id: string, result: Blob | string): Promise<StoredOutputAudio> {
    if (typeof result === "string" && !storedAssetFromUrl(result)) return { id, url: result, bytes: 0, mimeType: "", width: 0, height: 0, durationMs: 0 };
    const file = await uploadMediaFile(result, "audio");
    return { id, storageKey: file.storageKey, bytes: file.bytes, mimeType: file.mimeType === "application/octet-stream" ? "audio/mpeg" : file.mimeType, width: 0, height: 0, durationMs: 0 };
}

export function saveAudioChange(id: string, generationId: string, durationMs: number, change: { status: "failed"; error: string } | { status: "success"; audio: StoredOutputAudio }) {
    return updateGenerationRecord<AudioLog>("audio", id, generationId, (row) => change.status === "failed"
        ? { ...row, status: "failed", error: change.error, durationMs }
        : { ...row, status: "success", audio: change.audio, durationMs });
}
