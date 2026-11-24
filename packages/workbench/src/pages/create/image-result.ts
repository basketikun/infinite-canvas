import type { StoredOutputImage } from "@infinite-canvas/shared/sync-records";
import { imageBlobDimensions, readImageBlob, resolveImageInput, saveImageBlob } from "@workbench/services/image-storage";

/** 先把原件写入新键，再由调用方写入生成记录。 */
export async function prepareImageResult(id: string, url: string, startedAt: number, signal?: AbortSignal): Promise<StoredOutputImage> {
    const source = await resolveImageInput(url, { signal });
    if ("external" in source) {
        const { url: dataUrl, ...meta } = source.external;
        return { ...meta, dataUrl, id, durationMs: performance.now() - startedAt };
    }
    const file = "blob" in source ? source.blob : await readImageBlob(source.storageKey, source.url, { signal });
    const { width, height } = await imageBlobDimensions(file, signal);
    const meta = { id, width, height, bytes: file.size, mimeType: file.type.startsWith("image/") ? file.type : "", durationMs: performance.now() - startedAt };
    return { ...meta, storageKey: "storageKey" in source ? source.storageKey : await saveImageBlob(file) };
}
